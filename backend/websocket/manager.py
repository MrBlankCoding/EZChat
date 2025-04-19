import json
import logging
import asyncio
import time
import os
import uuid
from typing import Dict, Optional, List, Any, Tuple, Set
from datetime import datetime
from functools import lru_cache
from cachetools import TTLCache
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from starlette.websockets import WebSocketState
from websockets.exceptions import ConnectionClosed

from db.mongodb import (
    get_messages_collection,
    get_users_collection,
    get_user_groups,
    get_group_members,
    is_user_group_member,
)
from auth.firebase import FirebaseToken
from schemas.message import MessageStatus
from utils.rate_limiter import RateLimiter
from utils.notifications import send_new_message_notification
from .protocol import (
    WebSocketMessage,
    WebSocketMessageType,
    TypingMessage,
    TextMessage,
    ReadReceiptMessage,
    ReadReceiptBatchMessage,
    DeliveryReceiptMessage,
    PresenceMessage,
    ErrorMessage,
    ReplyMessage,
    EditMessage,
    DeleteMessage,
    StatusMessage,
    PongMessage,
)

# Configure logging and environment settings
logger = logging.getLogger(__name__)
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# WebSocket router
websocket_router = APIRouter()

# Rate limiting and caching configuration
message_rate_limiter = RateLimiter(limit=100, window=60)
READ_RECEIPT_BATCH_SIZE = 50
read_receipt_buffer = {}
read_receipt_last_log = {}

# Configure caches
USER_CACHE_SIZE = int(os.getenv("USER_CACHE_SIZE", "1000"))
USER_CACHE_TTL = int(os.getenv("USER_CACHE_TTL", "300"))
user_cache = TTLCache(maxsize=USER_CACHE_SIZE, ttl=USER_CACHE_TTL)

MESSAGE_CACHE_SIZE = int(os.getenv("MESSAGE_CACHE_SIZE", "5000"))
MESSAGE_CACHE_TTL = int(os.getenv("MESSAGE_CACHE_TTL", "60"))
message_cache = TTLCache(maxsize=MESSAGE_CACHE_SIZE, ttl=MESSAGE_CACHE_TTL)

# Database access control
DB_CONCURRENCY_LIMIT = int(os.getenv("DB_CONCURRENCY_LIMIT", "20"))
db_semaphore = asyncio.Semaphore(DB_CONCURRENCY_LIMIT)

# Batch message storage variables
messages_to_store = []
last_db_flush = time.time()
db_flush_lock = asyncio.Lock()


# Helper function for conversation IDs
def generate_conversation_id(user1: str, user2: str) -> str:
    """Generates a consistent conversation ID for two users."""
    return f"{min(user1, user2)}_{max(user1, user2)}"


def logger_info(message, force=False):
    if DEBUG or force:
        # Restore original logger.debug
        # logger.info(f"[logger.info] {message}")
        logger.debug(message)  # Original line


def should_log_read_receipt(user_id, message_id):
    current_time = time.time()
    last_log_time = read_receipt_last_log.get(user_id, 0)

    if current_time - last_log_time > 10:
        read_receipt_last_log[user_id] = current_time
        return True
    return False


async def get_cached_user(user_id: str) -> Optional[Dict]:
    if user_id in user_cache:
        return user_cache[user_id]

    async with db_semaphore:
        users_collection = get_users_collection()
        user = await users_collection.find_one({"_id": user_id})
        if user:
            user_cache[user_id] = user
        return user


async def get_cached_message(message_id: str) -> Optional[Dict]:
    message_id_str = str(message_id)

    if message_id_str in message_cache:
        return message_cache[message_id_str]

    async with db_semaphore:
        messages_collection = get_messages_collection()
        message = await messages_collection.find_one({"_id": message_id})
        if message:
            message_cache[message_id_str] = message
        return message


def _get_status_update_query(status: str, update_fields: Optional[Dict] = None):
    if not update_fields:
        return {"$set": {"status": status}}

    update_data = {"$set": {"status": status}}
    update_data["$set"].update(update_fields)
    return update_data


async def verify_token(token: str) -> FirebaseToken:
    firebase_token = FirebaseToken(token)
    await firebase_token.verify()
    return firebase_token


def validate_message(message_data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Validates required fields for a message document before DB insertion."""
    # Common required fields
    required_fields = [
        "_id",
        "sender_id",
        "timestamp",
        "created_at",
        "updated_at",
        "type",
        # Conversation ID is now always required (can be group_id for group chats)
        "conversation_id",
    ]

    for field in required_fields:
        if message_data.get(field) is None:  # Check for None explicitly
            return False, f"Missing required field: {field}"

    # Specific validation for direct vs group messages
    recipient_id = message_data.get("recipient_id")
    group_id = message_data.get("group_id")

    if recipient_id is not None and group_id is not None:
        return False, "Message cannot have both recipient_id and group_id"

    if recipient_id is None and group_id is None:
        return False, "Message must have either recipient_id or group_id"

    # Text or attachments check (depending on your message types)
    # if message_data.get("type") == WebSocketMessageType.MESSAGE.value:
    #     if not message_data.get("text") and not message_data.get("attachments"):
    #         return False, "Text message must contain text or attachments"

    return True, None


async def flush_messages_to_db():
    async with db_flush_lock:
        global messages_to_store, last_db_flush

        if not messages_to_store:
            return

        messages_to_flush = messages_to_store.copy()
        messages_to_store = []
        last_db_flush = time.time()

        try:
            if messages_to_flush:
                logger.info(f"Flushing {len(messages_to_flush)} messages to database")
                messages_collection = get_messages_collection()
                result = await messages_collection.insert_many(messages_to_flush)
                logger.info(
                    f"Bulk insert completed, inserted: {len(result.inserted_ids)}"
                )
        except Exception as e:
            logger.error(f"Error in bulk message insert: {e}")
            messages_to_store.extend(messages_to_flush)


async def schedule_message_storage(message_doc: Dict):
    global messages_to_store, last_db_flush

    messages_to_store.append(message_doc)

    current_time = time.time()
    should_flush = len(messages_to_store) >= 20 or (
        messages_to_store and current_time - last_db_flush > 2
    )

    if should_flush:
        asyncio.create_task(flush_messages_to_db())


async def update_message_status(
    message_id: str, status: str, update_fields: Optional[Dict] = None
):
    try:
        if not message_id:
            # logger.error("Cannot update message status: Missing message_id")
            return False

        message_id_str = str(message_id)

        # Check if the message exists
        message_exists = message_id_str in message_cache
        if not message_exists:
            async with db_semaphore:
                messages_collection = get_messages_collection()
                message = await messages_collection.find_one(
                    {"_id": message_id_str}, {"_id": 1}
                )
                message_exists = message is not None

        if not message_exists:
            if DEBUG:
                # logger.info(f"Message {message_id_str} not found for status update")
                pass  # Removed logging
            return False

        async with db_semaphore:
            messages_collection = get_messages_collection()
            update_data = _get_status_update_query(status, update_fields)

            result = await messages_collection.update_one(
                {"_id": message_id_str}, update_data
            )

            if result.matched_count == 0:
                if DEBUG:
                    # logger.info(
                    #     f"Message {message_id_str} not matched for status update"
                    # )
                    pass  # Removed logging
                return False

            # logger.info(f"Updated message {message_id_str} status to {status}")

            # Update cache if message is cached
            if message_id_str in message_cache:
                cached_msg = message_cache[message_id_str].copy()
                cached_msg["status"] = status
                if update_fields:
                    for key, value in update_fields.items():
                        if key != "_id":
                            cached_msg[key] = value
                message_cache[message_id_str] = cached_msg

            return True
    except Exception as e:
        # logger.error(f"Error updating message {message_id} status: {e}")
        return False


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_statuses: Dict[str, str] = {}
        self.typing_status: Dict[Tuple[str, str], datetime] = {}
        self.user_timezones: Dict[str, str] = {}
        self.last_heartbeat: Dict[str, float] = {}
        self.group_subscriptions: Dict[str, Set[str]] = (
            {}
        )  # Maps user_id to Set[group_id]
        self.batch_processing_event = asyncio.Event()
        self.batch_processing_task = None

    async def start_background_tasks(self):
        self.batch_processing_task = asyncio.create_task(self.process_read_receipts())
        asyncio.create_task(self.check_connections_health())

    async def check_connections_health(self):
        while True:
            try:
                current_time = time.time()
                stale_connections = [
                    user_id
                    for user_id, last_time in self.last_heartbeat.items()
                    if current_time - last_time > 60
                ]

                for user_id in stale_connections:
                    logger.warning(
                        f"Connection for {user_id} appears stale, disconnecting"
                    )
                    await self.disconnect(user_id)

                await asyncio.sleep(30)
            except Exception as e:
                logger.error(f"Error in connection health check: {e}")
                await asyncio.sleep(30)

    async def process_read_receipts(self):
        while True:
            try:
                try:
                    await asyncio.wait_for(self.batch_processing_event.wait(), 5)
                except asyncio.TimeoutError:
                    pass

                self.batch_processing_event.clear()

                pending_receipts = {}
                for user_id, receipts in read_receipt_buffer.items():
                    if receipts:
                        pending_receipts[user_id] = receipts.copy()
                        read_receipt_buffer[user_id] = []

                # Process receipts grouped by the user who sent them (user_id)
                for user_id, receipts in pending_receipts.items():
                    if not receipts:
                        continue

                    try:
                        # Group the receipts by the original sender of the messages (recipient)
                        by_recipient = {}
                        for receipt in receipts:
                            recipient = receipt.get("to_user")
                            if recipient not in by_recipient:
                                by_recipient[recipient] = []
                            by_recipient[recipient].append(receipt)

                        # Send batch notification to each original sender (recipient)
                        # Also broadcast to all connections of the user who sent the read receipt (user_id)
                        broadcast_targets = set()
                        # Extract base user ID (without device identifier) for broadcasting
                        user_base_id = user_id.split(":")[0]
                        for conn_id in self.active_connections:
                            if conn_id.startswith(user_base_id):
                                broadcast_targets.add(conn_id)

                        coroutines = []
                        for recipient, batch in by_recipient.items():
                            if not batch:
                                continue

                            message_ids = [
                                r.get("message_id")
                                for r in batch
                                if r.get("message_id")
                            ]
                            if not message_ids:
                                continue

                            batch_receipt = ReadReceiptBatchMessage(
                                from_user=user_id,  # User who read the messages
                                to_user=recipient,  # User who originally sent the messages
                                message_ids=message_ids,
                                contact_id=batch[0].get("contact_id"),
                                timestamp=datetime.utcnow().isoformat(),
                            )

                            # Send to the original message sender
                            if recipient in self.active_connections:
                                coroutines.append(
                                    self.send_personal_message(batch_receipt, recipient)
                                )

                            # Send to all connections of the user who marked messages as read
                            for target_conn_id in broadcast_targets:
                                # Avoid sending to self if it's the same connection that triggered (though unlikely in batch)
                                # Also avoid sending back to the original sender if they are the same as the reader
                                if target_conn_id != recipient:
                                    # Clone message but adjust 'to_user' for the context of the reader's client
                                    # The reader's client needs to know *who* the message was originally for
                                    reader_context_receipt = ReadReceiptBatchMessage(
                                        from_user=user_id,
                                        to_user=target_conn_id,  # Target this specific connection
                                        message_ids=message_ids,
                                        contact_id=recipient,  # For the reader, contact_id is the original sender
                                        timestamp=batch_receipt.timestamp,
                                    )
                                    coroutines.append(
                                        self.send_personal_message(
                                            reader_context_receipt, target_conn_id
                                        )
                                    )

                        if coroutines:
                            results = await asyncio.gather(
                                *coroutines, return_exceptions=True
                            )
                            for i, result in enumerate(results):
                                if isinstance(result, Exception):
                                    # logger.error(
                                    #     f"Error sending batch receipt notification ({i}): {result}"
                                    # )
                                    pass  # Removed logging

                    except Exception as e:
                        # logger.error(
                        #     f"Error processing read receipt batch for user {user_id}: {e}"
                        # )
                        pass  # Removed logging

                await asyncio.sleep(0.1)
            except Exception as e:
                # logger.error(f"Error in read receipt processor: {e}")
                await asyncio.sleep(5)

    async def connect(self, websocket: WebSocket, user_id: str):
        """Connects a user and subscribes them to their groups."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.update_heartbeat(user_id)
        logger.info(
            f"User {user_id} connected. Total connections: {len(self.active_connections)}"
        )

        # Fetch user's groups and subscribe
        try:
            user_groups = await get_user_groups(user_id)
            self.group_subscriptions[user_id] = {group.id for group in user_groups}
            logger.info(
                f"User {user_id} subscribed to {len(self.group_subscriptions.get(user_id, set()))} groups."
            )
        except Exception as e:
            logger.error(f"Failed to fetch or subscribe groups for user {user_id}: {e}")
            self.group_subscriptions[user_id] = set()  # Ensure entry exists

        # Set initial status and broadcast presence
        self.user_statuses[user_id] = "online"  # Set status directly
        await self.broadcast_presence(user_id, "online")  # Broadcast presence

        # Start batch processing task if not already running
        if self.batch_processing_task is None:
            self.batch_processing_task = asyncio.create_task(
                self.process_read_receipts()
            )

    async def disconnect(self, user_id: str):
        """Disconnects a user and cleans up their subscriptions."""
        if user_id in self.active_connections:
            connection = self.active_connections.pop(user_id, None)
            self.group_subscriptions.pop(user_id, None)  # Remove group subscriptions
            self.last_heartbeat.pop(user_id, None)
            self.user_statuses.pop(user_id, None)
            self.user_timezones.pop(user_id, None)
            # Clear typing status involving this user
            keys_to_remove = [k for k in self.typing_status if user_id in k]
            for key in keys_to_remove:
                self.typing_status.pop(key, None)

            logger.info(
                f"User {user_id} disconnected. Remaining connections: {len(self.active_connections)}"
            )
            await self.broadcast_presence(user_id, "offline")

            # Close the WebSocket connection if it's still open
            if connection and connection.client_state != WebSocketState.DISCONNECTED:
                try:
                    await connection.close()
                    logger.info(f"Closed WebSocket connection for user {user_id}")
                except RuntimeError as e:
                    # This can happen if the connection is already closing
                    logger.warning(f"Error closing WebSocket for {user_id}: {e}")

            # Stop batch processing if no connections left
            if not self.active_connections and self.batch_processing_task:
                self.batch_processing_event.set()
                self.batch_processing_task.cancel()
                try:
                    await self.batch_processing_task
                except asyncio.CancelledError:
                    pass
                self.batch_processing_task = None
                logger.info("Stopped batch processing task.")

    async def broadcast_presence(self, user_id: str, status: str):
        message = PresenceMessage(
            from_user=user_id,
            to_user=None,
            status=status,
            last_seen=datetime.utcnow().isoformat(),
        )

        coroutines = []
        for recipient_id, connection in self.active_connections.items():
            if recipient_id != user_id:
                coroutines.append(
                    self._send_message_to_connection(
                        connection, message.json(), recipient_id
                    )
                )

        if coroutines:
            await asyncio.gather(*coroutines, return_exceptions=True)

    async def _send_message_to_connection(
        self, connection: WebSocket, message_text: str, recipient_id: str
    ):
        """Internal helper to send a raw message string to a WebSocket connection."""
        if connection.client_state == WebSocketState.CONNECTED:
            try:
                await connection.send_text(message_text)
                # logger_info(f"Sent message to {recipient_id}") # Reduced logging
            except (ConnectionClosed, RuntimeError) as e:
                # logger_info(f"Failed to send message to {recipient_id}: Connection closed or error: {e}")
                # Schedule disconnection for this user if connection is broken
                asyncio.create_task(self.disconnect(recipient_id))
            except Exception as e:
                logger.error(f"Unexpected error sending message to {recipient_id}: {e}")
                asyncio.create_task(self.disconnect(recipient_id))
        # else:
        # logger_info(f"Skipped sending to {recipient_id}: WebSocket not connected.")

    async def send_personal_message(
        self, message: WebSocketMessage, recipient_id: str
    ) -> bool:
        """Sends a message to a specific user if they are connected."""
        connection = self.active_connections.get(recipient_id)
        if connection:
            try:
                message_str = (
                    message.model_dump_json()
                )  # Use model_dump_json for Pydantic v2
                await self._send_message_to_connection(
                    connection, message_str, recipient_id
                )
                return True
            except Exception as e:
                logger.error(
                    f"Error serializing/sending personal message to {recipient_id}: {e}"
                )
                return False
        else:
            # logger_info(f"User {recipient_id} not connected for personal message.")
            return False

    async def send_json_to_user(self, user_id: str, json_data: dict) -> bool:
        """Sends a JSON message to a specific user if they are connected."""
        connection = self.active_connections.get(user_id)
        if connection:
            try:
                message_str = json.dumps(json_data)
                await self._send_message_to_connection(connection, message_str, user_id)
                return True
            except Exception as e:
                logger.error(f"Error serializing/sending JSON to {user_id}: {e}")
                return False
        return False

    async def send_group_message(
        self, message: WebSocketMessage, group_id: str, sender_id: str
    ):
        """Sends a message to all connected members of a group, except the sender."""
        logger.info(
            f"Attempting to send group message to group {group_id} from {sender_id}"
        )
        try:
            # Fetch group members (consider caching this if groups are large/static)
            members = await get_group_members(group_id)
            if not members:
                logger.warning(
                    f"No members found for group {group_id} or group doesn't exist."
                )
                return

            member_ids = {member.user_id for member in members}
            logger.info(f"Group {group_id} has members: {member_ids}")

            message_str = message.model_dump_json()  # Serialize once
            send_tasks = []

            for member_id in member_ids:
                if member_id == sender_id:
                    continue  # Don't send back to sender

                connection = self.active_connections.get(member_id)
                if connection:
                    # logger.info(f"Queueing send to group member: {member_id}")
                    # Use the internal helper which handles exceptions
                    send_tasks.append(
                        self._send_message_to_connection(
                            connection, message_str, member_id
                        )
                    )
                # else:
                # logger_info(f"Group member {member_id} is offline.")

            if send_tasks:
                logger.info(
                    f"Sending message to {len(send_tasks)} online members of group {group_id}"
                )
                await asyncio.gather(*send_tasks)  # Send concurrently
            else:
                logger.info(
                    f"No online members (excluding sender) found for group {group_id}"
                )

        except Exception as e:
            logger.error(f"Error sending group message to group {group_id}: {e}")

    async def update_typing_status(
        self, from_user: str, to_user: str, is_typing: bool
    ) -> bool:
        key = (from_user, to_user)
        now = datetime.utcnow()

        if is_typing:
            self.typing_status[key] = now
        elif key in self.typing_status:
            del self.typing_status[key]

        message = TypingMessage(
            from_user=from_user, to_user=to_user, is_typing=is_typing
        )
        return await self.send_personal_message(message, to_user)

    def get_connected_users(self) -> List[str]:
        return list(self.active_connections.keys())

    def is_user_online(self, user_id: str) -> bool:
        return (
            user_id in self.active_connections
            and user_id in self.user_statuses
            and self.user_statuses[user_id] == "online"
        )

    def get_user_status(self, user_id: str) -> str:
        if user_id in self.active_connections:
            return self.user_statuses.get(user_id, "online")
        return "offline"

    def get_user_timezone(self, user_id: str) -> Optional[str]:
        return self.user_timezones.get(user_id)

    def update_heartbeat(self, user_id: str):
        self.last_heartbeat[user_id] = time.time()

    async def update_user_timezone(self, user_id: str, timezone: str):
        current_timezone = self.user_timezones.get(user_id)
        if current_timezone == timezone:
            logger.info(f"Timezone unchanged for user {user_id}: {timezone}")
            return

        try:
            async with db_semaphore:
                users_collection = get_users_collection()

                user = await users_collection.find_one(
                    {"_id": user_id}, {"timezone": 1}
                )

                if user and user.get("timezone") == timezone:
                    logger.info(
                        f"Timezone already up-to-date in database for user {user_id}"
                    )
                    return

                self.user_timezones[user_id] = timezone

                await users_collection.update_one(
                    {"_id": user_id},
                    {"$set": {"timezone": timezone, "updated_at": datetime.utcnow()}},
                )

                logger.info(f"Updated timezone for user {user_id}: {timezone}")
        except Exception as e:
            logger.error(f"Error storing timezone in database: {e}")


async def broadcast_to_related_connections(
    message: WebSocketMessage,
    from_user: str,  # The user ID of the sender of the original message/action
    to_user: str,  # The user ID of the recipient of the original message/action
    originator_connection_id: str,  # The specific connection ID that triggered this broadcast
):
    """Broadcasts a message to all connections related to the sender and recipient,
    excluding the connection that originated the event."""
    active_connections = connection_manager.active_connections
    sender_base_id = originator_connection_id.split(":")[0]
    recipient_base_id = to_user.split(":")[0]
    coroutines = []

    logger.info(
        f"[Broadcast Start] Broadcasting {type(message).__name__} from {originator_connection_id} (orig sender: {from_user}, orig recipient: {to_user})"
    )

    target_connection_ids = set()
    for conn_id in active_connections:
        if conn_id == originator_connection_id:
            continue  # Skip the originator
        if conn_id.startswith(sender_base_id) or conn_id.startswith(recipient_base_id):
            target_connection_ids.add(conn_id)

    logger.info(f"[Broadcast Targets] Identified targets: {target_connection_ids}")

    for conn_id in target_connection_ids:
        try:
            message_copy = message.copy(update={"to_user": conn_id})
            logger.info(
                f"[Broadcast Prep] Prepared copy for {conn_id}: {message_copy.dict()}"
            )  # Log the prepared copy

            coroutines.append(
                connection_manager.send_personal_message(message_copy, conn_id)
            )
        except Exception as e:
            logger.error(f"Error creating message copy for {conn_id}: {e}")
            continue

    if coroutines:
        logger.info(f"[Broadcast Gather] Executing {len(coroutines)} sends.")
        results = await asyncio.gather(*coroutines, return_exceptions=True)
        target_list = list(target_connection_ids)
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                if i < len(target_list):
                    target_conn_id = target_list[i]
                    logger.error(
                        f"Error broadcasting message to potential target {target_conn_id}: {result}"
                    )
                else:
                    logger.error(
                        f"Error broadcasting message (index out of bounds): {result}"
                    )
    else:
        logger.info(
            "[Broadcast End] No coroutines to execute (no targets found or all failed copy)."
        )


# Instantiate the manager *after* the class definition
connection_manager = ConnectionManager()

# --- WebSocket Handlers ---


async def handle_text_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    # Validate payload
    if not payload.get("text"):
        # logger.warning(f"Received text message from {from_user} with no text payload")
        return

    message_id = payload.get("_id", str(uuid.uuid4()))
    conversation_id = payload.get("conversation_id")
    text = payload["text"]
    timestamp_str = payload.get("timestamp", datetime.utcnow().isoformat())
    timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))

    # --- Group Chat Logic --- >
    group_id = payload.get("group_id")
    is_group_message = bool(group_id)

    if is_group_message:
        recipient_id = None
        is_member = await is_user_group_member(group_id, from_user)
        if not is_member:
            logger.warning(f"User {from_user} not member of group {group_id}.")
            error_msg = ErrorMessage(
                error="You are not a member of this group.", code="NOT_MEMBER"
            )
            await connection_manager.send_personal_message(error_msg, from_user)
            return
        logger.info(f"Processing group message from {from_user} to group {group_id}")
        conversation_id = group_id  # Use group_id as conversation_id
    else:
        recipient_id = to_user
        if not recipient_id:
            logger.warning(f"Direct message from {from_user} missing recipient_id")
            error_msg = ErrorMessage(
                error="Recipient ID missing.", code="MISSING_RECIPIENT"
            )
            await connection_manager.send_personal_message(error_msg, from_user)
            return
        if not conversation_id:
            conversation_id = generate_conversation_id(from_user, recipient_id)
        logger.info(f"Processing direct message from {from_user} to {recipient_id}")
    # < --- End Group Chat Logic ---

    # Create message document for DB
    message_doc = {
        "_id": message_id,
        "sender_id": from_user,
        "recipient_id": recipient_id,
        "group_id": group_id,
        "conversation_id": conversation_id,
        "text": text,
        "timestamp": timestamp,  # Datetime object for DB
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "status": MessageStatus.SENT,
        "type": WebSocketMessageType.MESSAGE.value,  # Corrected type
        # attachments? reply_to?
    }

    # Validate required fields (validate_message might need update)
    is_valid, error = validate_message(message_doc)
    if not is_valid:
        logger.error(f"Message validation failed: {error}. Payload: {payload}")
        error_msg = ErrorMessage(
            error=f"Message format invalid: {error}", code="INVALID_FORMAT"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    await schedule_message_storage(message_doc)

    # Prepare WebSocket message object
    ws_message = TextMessage(
        type=WebSocketMessageType.MESSAGE,
        from_user=from_user,
        to_user=recipient_id,
        group_id=group_id,
        message_id=message_id,
        text=text,
        timestamp=timestamp.isoformat(),
        status=MessageStatus.SENT.value,
    )

    if is_group_message:
        await connection_manager.send_group_message(ws_message, group_id, from_user)
    else:
        sent_to_recipient = await connection_manager.send_personal_message(
            ws_message, recipient_id
        )
        await connection_manager.send_personal_message(ws_message, from_user)  # Echo
        if not connection_manager.is_user_online(recipient_id):
            sender_user = await get_cached_user(from_user)
            sender_name = (
                sender_user.get("username", "Someone") if sender_user else "Someone"
            )
            # Correctly call send_new_message_notification with all required args
            asyncio.create_task(
                send_new_message_notification(
                    recipient_id=recipient_id,
                    sender_name=sender_name,
                    message_text=text,
                    message_id=message_id,  # Pass message_id
                    contact_id=from_user,  # Pass sender_id as contact_id for direct messages
                )
            )

    # Ensure broadcast_to_related_connections is commented out
    # await broadcast_to_related_connections(ws_message, from_user, to_user, from_user)

    logger.info(f"Text message handling complete for message {message_id}")


async def handle_reply_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    # Similar validation as handle_text_message for text/attachments
    if not payload.get("text") and not payload.get("attachments"):
        logger.warning(f"Reply message from {from_user} is empty.")
        return
    if not payload.get("reply_to"):
        logger.warning(f"Reply message from {from_user} missing reply_to field.")
        return

    message_id = payload.get("_id", str(uuid.uuid4()))
    conversation_id = payload.get("conversation_id")
    text = payload.get("text", "")
    attachments = payload.get("attachments", [])
    reply_to_id = payload["reply_to"]
    timestamp_str = payload.get("timestamp", datetime.utcnow().isoformat())
    timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))

    # --- Group Chat Logic --- >
    group_id = payload.get("group_id")
    is_group_message = bool(group_id)

    if is_group_message:
        recipient_id = None
        is_member = await is_user_group_member(group_id, from_user)
        if not is_member:
            # Send error
            error_msg = ErrorMessage(
                error="You are not a member of this group.", code="NOT_MEMBER"
            )
            await connection_manager.send_personal_message(error_msg, from_user)
            return
        conversation_id = group_id  # Use group_id as conversation_id
        logger.info(f"Processing group reply from {from_user} to group {group_id}")
    else:
        recipient_id = to_user
        if not recipient_id:
            # Send error
            error_msg = ErrorMessage(
                error="Recipient ID missing for direct reply.", code="MISSING_RECIPIENT"
            )
            await connection_manager.send_personal_message(error_msg, from_user)
            return
        if not conversation_id:
            conversation_id = generate_conversation_id(from_user, recipient_id)
        logger.info(f"Processing direct reply from {from_user} to {recipient_id}")
    # < --- End Group Chat Logic ---

    # Create DB document
    message_doc = {
        "_id": message_id,
        "sender_id": from_user,
        "recipient_id": recipient_id,
        "group_id": group_id,
        "conversation_id": conversation_id,
        "text": text,
        "attachments": attachments,
        "reply_to": reply_to_id,
        "timestamp": timestamp,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "status": MessageStatus.SENT,
        "type": WebSocketMessageType.REPLY.value,
    }

    # Validate (validate_message might need update for reply type)
    is_valid, error = validate_message(message_doc)  # Basic validation
    if not is_valid:
        # Send error
        error_msg = ErrorMessage(
            error=f"Reply format invalid: {error}", code="INVALID_FORMAT"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    await schedule_message_storage(message_doc)

    # Prepare WS Message
    ws_message = ReplyMessage(
        type=WebSocketMessageType.REPLY,
        from_user=from_user,
        to_user=recipient_id,  # None for group
        group_id=group_id,
        message_id=message_id,
        text=text,
        attachments=attachments,
        reply_to=reply_to_id,
        timestamp=timestamp.isoformat(),
        status=MessageStatus.SENT.value,
    )

    # Send via WebSocket
    if is_group_message:
        await connection_manager.send_group_message(ws_message, group_id, from_user)
    else:
        await connection_manager.send_personal_message(ws_message, recipient_id)
        await connection_manager.send_personal_message(ws_message, from_user)  # Echo
        # Push notification logic (similar to handle_text_message)
        if not connection_manager.is_user_online(recipient_id):
            sender_user = await get_cached_user(from_user)
            sender_name = (
                sender_user.get("username", "Someone") if sender_user else "Someone"
            )
            notification_text = (
                f"Replied: {text}" if text else "Replied with attachment"
            )
            asyncio.create_task(
                send_new_message_notification(
                    recipient_id=recipient_id,
                    sender_name=sender_name,
                    message_text=notification_text,
                    message_id=message_id,
                    contact_id=from_user,
                )
            )

    logger.info(f"Reply message handling complete for message {message_id}")


async def handle_edit_message(
    payload: Dict,
    from_user: str,
    to_user: str,
    websocket: WebSocket,  # to_user might be irrelevant here
):
    message_id = payload.get("message_id", payload.get("messageId"))
    new_text = payload.get("text")

    if not message_id or new_text is None:  # Allow empty string for text
        error_msg = ErrorMessage(
            error="Missing message_id or text for edit.", code="INVALID_EDIT"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Fetch the original message from DB
    original_message = await get_cached_message(message_id)
    if not original_message:
        # Potentially check DB directly if not in cache
        messages_collection = get_messages_collection()
        original_message = await messages_collection.find_one({"_id": message_id})

    if not original_message:
        error_msg = ErrorMessage(error="Message not found.", code="NOT_FOUND")
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Authorization: Check if the editor is the original sender
    if original_message.get("sender_id") != from_user:
        error_msg = ErrorMessage(
            error="You cannot edit this message.", code="FORBIDDEN"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Update message in DB
    edited_at = datetime.utcnow()
    update_fields = {
        "text": new_text,
        "is_edited": True,
        "edited_at": edited_at,
        "updated_at": edited_at,
    }
    update_success = await update_message_status(
        message_id, original_message["status"], update_fields
    )
    if not update_success:
        error_msg = ErrorMessage(error="Failed to update message.", code="DB_ERROR")
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Prepare WS Message
    ws_message = EditMessage(
        type=WebSocketMessageType.EDIT,
        from_user=from_user,
        to_user=original_message.get(
            "recipient_id"
        ),  # Keep original recipient/group context
        group_id=original_message.get("group_id"),
        message_id=message_id,
        text=new_text,
        edited_at=edited_at.isoformat(),
    )

    # Send acknowledgement back to sender
    ack = StatusMessage(
        status="ok", message="Message edited", payload={"message_id": message_id}
    )
    await connection_manager.send_personal_message(ack, from_user)

    # Broadcast edit notification
    original_group_id = original_message.get("group_id")
    original_recipient_id = original_message.get("recipient_id")

    if original_group_id:
        await connection_manager.send_group_message(
            ws_message, original_group_id, from_user
        )
    elif original_recipient_id:
        # Send to original recipient and sender's other connections
        await connection_manager.send_personal_message(
            ws_message, original_recipient_id
        )
        await broadcast_to_related_connections(
            ws_message,
            from_user,
            original_recipient_id,
            websocket.headers.get("sec-websocket-key"),
        )  # Assuming websocket has headers

    logger.info(f"Edit message handling complete for message {message_id}")


async def handle_delete_message(
    payload: Dict,
    from_user: str,
    to_user: str,
    websocket: WebSocket,  # to_user might be irrelevant
):
    message_id = payload.get("message_id", payload.get("messageId"))

    if not message_id:
        error_msg = ErrorMessage(
            error="Missing message_id for delete.", code="INVALID_DELETE"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Fetch the original message from DB
    original_message = await get_cached_message(message_id)
    if not original_message:
        messages_collection = get_messages_collection()
        original_message = await messages_collection.find_one({"_id": message_id})

    if not original_message:
        error_msg = ErrorMessage(error="Message not found.", code="NOT_FOUND")
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Authorization: Check if the deleter is the original sender
    if original_message.get("sender_id") != from_user:
        error_msg = ErrorMessage(
            error="You cannot delete this message.", code="FORBIDDEN"
        )
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Update message in DB (soft delete)
    deleted_at = datetime.utcnow()
    update_fields = {
        "text": "",  # Optionally clear text
        "attachments": [],  # Optionally clear attachments
        "is_deleted": True,
        "deleted_at": deleted_at,
        "updated_at": deleted_at,
    }
    # Use specific status or keep last known status?
    # Let's keep the status but mark as deleted
    update_success = await update_message_status(
        message_id, original_message["status"], update_fields
    )
    if not update_success:
        error_msg = ErrorMessage(error="Failed to delete message.", code="DB_ERROR")
        await connection_manager.send_personal_message(error_msg, from_user)
        return

    # Prepare WS Message
    ws_message = DeleteMessage(
        type=WebSocketMessageType.DELETE,
        from_user=from_user,
        to_user=original_message.get("recipient_id"),  # Keep original context
        group_id=original_message.get("group_id"),
        message_id=message_id,
        deleted_at=deleted_at.isoformat(),
    )

    # Send acknowledgement back to sender
    ack = StatusMessage(
        status="ok", message="Message deleted", payload={"message_id": message_id}
    )
    await connection_manager.send_personal_message(ack, from_user)

    # Broadcast delete notification
    original_group_id = original_message.get("group_id")
    original_recipient_id = original_message.get("recipient_id")

    if original_group_id:
        await connection_manager.send_group_message(
            ws_message, original_group_id, from_user
        )
    elif original_recipient_id:
        await connection_manager.send_personal_message(
            ws_message, original_recipient_id
        )
        await broadcast_to_related_connections(
            ws_message,
            from_user,
            original_recipient_id,
            websocket.headers.get("sec-websocket-key"),
        )

    logger.info(f"Delete message handling complete for message {message_id}")


async def handle_read_receipt(payload: Dict, from_user: str, to_user: str):
    """
    Queue a single read receipt for batch processing instead of processing immediately
    """
    message_id = payload.get("messageId")
    contact_id = payload.get("contactId")  # This is important for the frontend

    if not message_id:
        return

    try:
        # Verify the message exists before queueing
        message_exists = False
        message_id_str = str(message_id)

        async with db_semaphore:
            messages_collection = get_messages_collection()
            # Look for the message in the database or cache
            if message_id_str in message_cache:
                message_exists = True
            else:
                message_doc = await messages_collection.find_one({"_id": message_id})
                if message_doc:
                    message_exists = True
                    # Cache the message for future lookups
                    message_cache[message_id_str] = message_doc

        if not message_exists:
            if DEBUG:
                # logger.info(f"Read receipt for non-existent message: {message_id}")
                pass  # Removed logging
            return

        # Queue for batch processing instead of immediate processing
        if from_user not in read_receipt_buffer:
            read_receipt_buffer[from_user] = []

        read_receipt_buffer[from_user].append(
            {"message_id": message_id, "to_user": to_user, "contact_id": contact_id}
        )

        # Trigger batch processing event if enough receipts are queued
        if len(read_receipt_buffer[from_user]) >= READ_RECEIPT_BATCH_SIZE:
            connection_manager.batch_processing_event.set()

        # Only log periodically to avoid flooding logs
        # if should_log_read_receipt(from_user, message_id):
        #     logger.info(
        #         f"Queued read receipt for {message_id} from {from_user} to {to_user}"
        #     )
    except Exception as e:
        # logger.error(f"Error handling read receipt: {e}")
        pass  # Removed logging


async def handle_read_receipt_batch(payload: Dict, from_user: str, to_user: str):
    """
    Process a batch of read receipts efficiently
    """
    message_ids = payload.get("messageIds", [])
    contact_id = payload.get(
        "contactId"
    )  # This is the original sender (recipient of messages)

    if not message_ids or not contact_id:
        # logger.warning("Missing messageIds or contactId in read_receipt_batch")
        return

    if DEBUG:
        # logger.info(
        #     f"Processing batch of {len(message_ids)} read receipts from {from_user} for contact {contact_id}"
        # )
        pass  # Removed logging

    # Process in chunks to avoid overwhelming the database
    chunk_size = 50  # Process 50 messages at a time
    total_updated = 0
    valid_messages = []

    for i in range(0, len(message_ids), chunk_size):
        chunk = message_ids[i : i + chunk_size]

        try:
            # First, verify which messages actually exist in the database
            async with db_semaphore:
                messages_collection = get_messages_collection()
                existing_messages = await messages_collection.find(
                    {
                        "_id": {"$in": chunk},
                        "recipient_id": from_user,
                    }  # Ensure these messages were sent TO the reader
                ).to_list(length=None)

                # Extract IDs of messages that actually exist AND were sent to the reader
                existing_ids = [msg["_id"] for msg in existing_messages]

                # Log any missing messages at debug level only
                missing_ids = [msg_id for msg_id in chunk if msg_id not in existing_ids]
                if missing_ids and DEBUG:
                    # logger.info(
                    #     f"Read receipt batch contained non-existent or incorrect recipient messages: {missing_ids}"
                    # )
                    pass  # Removed logging

                # Only update messages that exist
                if existing_ids:
                    update_fields = {
                        "read_at": datetime.utcnow(),
                    }

                    result = await messages_collection.update_many(
                        {"_id": {"$in": existing_ids}},
                        {"$set": {"status": MessageStatus.READ, **update_fields}},
                    )

                    total_updated += result.modified_count
                    valid_messages.extend(existing_ids)

        except Exception as e:
            # logger.error(f"Error processing read receipt chunk: {e}")
            pass  # Removed logging

    if DEBUG and total_updated > 0:
        # logger.info(
        #     f"Updated {total_updated} of {len(message_ids)} messages to read status for {from_user}"
        # )
        pass  # Removed logging

    # Only continue with notification if we have valid messages
    if not valid_messages:
        # logger.info(f"No valid messages found in read receipt batch from {from_user}")
        return

    # --- Notification Logic ---
    coroutines = []
    current_timestamp = datetime.utcnow().isoformat()

    # 1. Notify the original sender (contact_id) about the read status
    if contact_id in connection_manager.active_connections:
        sender_notification = ReadReceiptBatchMessage(
            from_user=from_user,  # Who read the message
            to_user=contact_id,  # Who gets the notification (original sender)
            message_ids=valid_messages,
            contact_id=from_user,  # For sender's client, contact_id is the reader
            timestamp=current_timestamp,
        )
        coroutines.append(
            connection_manager.send_personal_message(sender_notification, contact_id)
        )

    # 2. Notify the reader's other connected devices
    reader_base_id = from_user.split(":")[0]
    for conn_id in connection_manager.active_connections:
        # Skip the connection that sent this batch and the original sender
        if conn_id == from_user or conn_id == contact_id:
            continue
        # Send only to other connections of the reader
        if conn_id.startswith(reader_base_id):
            reader_notification = ReadReceiptBatchMessage(
                from_user=from_user,  # Who read the message
                to_user=conn_id,  # Target this specific connection
                message_ids=valid_messages,
                contact_id=contact_id,  # For reader's client, contact_id is the original sender
                timestamp=current_timestamp,
            )
            coroutines.append(
                connection_manager.send_personal_message(reader_notification, conn_id)
            )

    # 3. Send notifications concurrently
    if coroutines:
        results = await asyncio.gather(*coroutines, return_exceptions=True)
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                # logger.error(
                #     f"Error sending read receipt batch notification ({i}): {result}"
                # )
                pass  # Removed logging


@websocket_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    print("--- WebSocket Endpoint Entered ---")
    user_id = None
    heartbeat_task = None

    try:
        logger.info(f"WebSocket connection attempt")

        try:
            firebase_token = await verify_token(token)
            user_id = firebase_token.firebase_uid
            logger.info(f"WebSocket token verified for user: {user_id}")
        except Exception as e:
            logger.error(f"WebSocket token verification failed: {str(e)}")
            await websocket.accept()
            error_msg = ErrorMessage(code=401, message="Authentication failed")
            await websocket.send_text(error_msg.json())
            await websocket.close(code=1008)
            return

        await connection_manager.connect(websocket, user_id)

        # Start a keepalive task for this connection
        heartbeat_task = asyncio.create_task(periodic_heartbeat(websocket, user_id))

        while True:
            data = await websocket.receive_text()

            try:
                message_data = json.loads(data)

                if not message_rate_limiter.is_allowed(user_id):
                    error = ErrorMessage(
                        code=429, message="Rate limit exceeded. Please try again later."
                    )
                    await websocket.send_text(error.json())
                    continue

                # Update heartbeat on any message
                connection_manager.update_heartbeat(user_id)

                message_type = message_data.get("type")
                from_user = message_data.get("from")
                to_user = message_data.get("to")
                payload = message_data.get("payload", {})

                if from_user != user_id:
                    error = ErrorMessage(
                        code=403, message="Sender ID does not match authenticated user"
                    )
                    await websocket.send_text(error.json())
                    continue

                if message_type == WebSocketMessageType.MESSAGE:
                    await handle_text_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.REPLY:
                    await handle_reply_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.EDIT:
                    await handle_edit_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.DELETE:
                    await handle_delete_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.TYPING:
                    is_typing = payload.get("is_typing", payload.get("isTyping", False))
                    await connection_manager.update_typing_status(
                        from_user, to_user, is_typing
                    )

                elif message_type == WebSocketMessageType.TIMEZONE:
                    timezone = payload.get("timezone")
                    verify_only = payload.get("verify_only", False)

                    if verify_only:
                        # This is just a verification request, don't update, just send current timezone
                        current_tz = connection_manager.get_user_timezone(from_user)
                        ack = StatusMessage(
                            from_user="system",
                            to_user=from_user,
                            status="ok",
                            message="Timezone verification",
                            payload={"timezone": current_tz},
                        )
                        await websocket.send_text(ack.json())
                    elif timezone:
                        # Normal timezone update
                        await connection_manager.update_user_timezone(
                            from_user, timezone
                        )
                        ack = StatusMessage(
                            from_user="system",
                            to_user=from_user,
                            status="ok",
                            message="Timezone updated",
                        )
                        await websocket.send_text(ack.json())

                elif message_type == WebSocketMessageType.READ_RECEIPT:
                    await handle_read_receipt(payload, from_user, to_user)

                elif message_type == WebSocketMessageType.READ_RECEIPT_BATCH:
                    await handle_read_receipt_batch(payload, from_user, to_user)

                elif message_type == WebSocketMessageType.PRESENCE:
                    status = payload.get("status")
                    if status:
                        connection_manager.user_statuses[from_user] = status
                        await connection_manager.broadcast_presence(from_user, status)

                elif message_type == WebSocketMessageType.PING:
                    # Respond with pong
                    timestamp = message_data.get("timestamp", int(time.time() * 1000))
                    pong = PongMessage(timestamp=timestamp)
                    await websocket.send_text(json.dumps(pong.dict()))
                    continue

                else:
                    error = ErrorMessage(
                        code=400, message=f"Unknown message type: {message_type}"
                    )
                    await websocket.send_text(error.json())

            except json.JSONDecodeError:
                error = ErrorMessage(code=400, message="Invalid JSON format")
                await websocket.send_text(error.json())

            except Exception as e:
                logger.error(f"Error processing message: {e}")
                error = ErrorMessage(code=500, message="Internal server error")
                await websocket.send_text(error.json())

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: {user_id}")
        if user_id:
            await connection_manager.disconnect(user_id)

    except ConnectionClosed:
        logger.info(f"WebSocket connection closed: {user_id}")
        if user_id:
            await connection_manager.disconnect(user_id)

    except HTTPException as http_exc:
        logger.warning(f"WebSocket authentication error: {http_exc.detail}")
        await websocket.close(code=1008)

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if user_id:
            await connection_manager.disconnect(user_id)
        try:
            await websocket.close(code=1011)
        except:
            pass
    finally:
        # Ensure heartbeat task is cancelled
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()


async def periodic_heartbeat(websocket: WebSocket, user_id: str):
    """Periodically send ping messages to keep the connection alive"""
    try:
        while True:
            try:
                # Only send if connection is still active
                if user_id in connection_manager.active_connections:
                    pong = PongMessage(timestamp=int(time.time() * 1000))
                    await websocket.send_text(json.dumps(pong.dict()))
                    connection_manager.update_heartbeat(user_id)
                else:
                    # Exit the heartbeat loop if connection is gone
                    break

                # Wait for 20 seconds before next ping
                await asyncio.sleep(20)
            except Exception as e:
                logger.error(f"Error in heartbeat for {user_id}: {e}")
                break
    except asyncio.CancelledError:
        # Task was cancelled, just exit
        pass
