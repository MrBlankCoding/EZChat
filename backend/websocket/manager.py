import json
import logging
import asyncio
import time
import os
from typing import Dict, Optional, List, Any, Tuple
from datetime import datetime
from functools import lru_cache
from cachetools import TTLCache
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException
from starlette.websockets import WebSocketState
from websockets.exceptions import ConnectionClosed

from db.mongodb import get_messages_collection, get_users_collection
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
    ReactionMessage,
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


def debug_log(message, force=False):
    if DEBUG or force:
        logger.debug(message)


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
    required_fields = [
        "_id",
        "sender_id",
        "recipient_id",
        "text",
        "timestamp",
        "conversation_id",
    ]

    for field in required_fields:
        if not message_data.get(field):
            return False, f"Missing required field: {field}"

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
                debug_log(f"Flushing {len(messages_to_flush)} messages to database")
                messages_collection = get_messages_collection()
                result = await messages_collection.insert_many(messages_to_flush)
                debug_log(
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
            logger.error("Cannot update message status: Missing message_id")
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
                debug_log(f"Message {message_id_str} not found for status update")
            return False

        async with db_semaphore:
            messages_collection = get_messages_collection()
            update_data = _get_status_update_query(status, update_fields)

            result = await messages_collection.update_one(
                {"_id": message_id_str}, update_data
            )

            if result.matched_count == 0:
                if DEBUG:
                    debug_log(f"Message {message_id_str} not matched for status update")
                return False

            debug_log(f"Updated message {message_id_str} status to {status}")

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
        logger.error(f"Error updating message {message_id} status: {e}")
        return False


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_statuses: Dict[str, str] = {}
        self.typing_status: Dict[Tuple[str, str], datetime] = {}
        self.user_timezones: Dict[str, str] = {}
        self.last_heartbeat: Dict[str, float] = {}
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

                for user_id, receipts in pending_receipts.items():
                    if receipts:
                        try:
                            by_recipient = {}
                            for receipt in receipts:
                                recipient = receipt.get("to_user")
                                if recipient not in by_recipient:
                                    by_recipient[recipient] = []
                                by_recipient[recipient].append(receipt)

                            for recipient, batch in by_recipient.items():
                                message_ids = [r.get("message_id") for r in batch]
                                batch_receipt = ReadReceiptBatchMessage(
                                    from_user=user_id,
                                    to_user=recipient,
                                    message_ids=message_ids,
                                    contact_id=batch[0].get("contact_id"),
                                    timestamp=datetime.utcnow().isoformat(),
                                )
                                await self.send_personal_message(
                                    batch_receipt, recipient
                                )
                        except Exception as e:
                            logger.error(f"Error processing read receipt batch: {e}")

                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error(f"Error in read receipt processor: {e}")
                await asyncio.sleep(5)

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_statuses[user_id] = "online"
        self.last_heartbeat[user_id] = time.time()
        debug_log(
            f"User {user_id} connected. Total active connections: {len(self.active_connections)}"
        )
        await self.broadcast_presence(user_id, "online")

        if self.batch_processing_task is None or self.batch_processing_task.done():
            await self.start_background_tasks()

    async def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            self.user_statuses[user_id] = "offline"
            if user_id in self.last_heartbeat:
                del self.last_heartbeat[user_id]
            debug_log(
                f"User {user_id} disconnected. Remaining connections: {len(self.active_connections)}"
            )
            await self.broadcast_presence(user_id, "offline")

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
        try:
            if connection.client_state == WebSocketState.CONNECTED:
                await connection.send_text(message_text)
                return True
            else:
                await self.disconnect(recipient_id)
                return False
        except Exception as e:
            logger.error(f"Error sending message to {recipient_id}: {e}")
            await self.disconnect(recipient_id)
            return False

    async def send_personal_message(
        self, message: WebSocketMessage, recipient_id: str
    ) -> bool:
        if recipient_id in self.active_connections:
            try:
                connection = self.active_connections[recipient_id]
                if connection.client_state == WebSocketState.CONNECTED:
                    await connection.send_text(message.json())
                    return True
                else:
                    await self.disconnect(recipient_id)
            except Exception as e:
                logger.error(f"Error sending message to {recipient_id}: {e}")
                await self.disconnect(recipient_id)
        return False

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
            debug_log(f"Timezone unchanged for user {user_id}: {timezone}")
            return

        try:
            async with db_semaphore:
                users_collection = get_users_collection()

                user = await users_collection.find_one(
                    {"_id": user_id}, {"timezone": 1}
                )

                if user and user.get("timezone") == timezone:
                    debug_log(
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


connection_manager = ConnectionManager()


async def handle_text_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    debug_log(f"Handling text message from {from_user} to {to_user}")

    sender_timezone = connection_manager.get_user_timezone(from_user)
    recipient_timezone = connection_manager.get_user_timezone(to_user)

    message_obj = TextMessage(
        from_user=from_user,
        to_user=to_user,
        message_id=payload.get("id"),
        text=payload.get("text", ""),
        timestamp=payload.get("timestamp") or datetime.utcnow().isoformat(),
        attachments=payload.get("attachments", []),
        reply_to=payload.get("reply_to"),
        status=payload.get("status", "sent"),
    )

    conversation_id = f"{min(from_user, to_user)}_{max(from_user, to_user)}"

    message_doc = {
        "_id": message_obj.message_id,
        "conversation_id": conversation_id,
        "sender_id": from_user,
        "recipient_id": to_user,
        "text": message_obj.text,
        "timestamp": message_obj.timestamp,
        "status": MessageStatus.SENT,
        "attachments": message_obj.attachments or [],
        "reply_to": message_obj.reply_to,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "type": "message",
        "sender_timezone": sender_timezone,
        "recipient_timezone": recipient_timezone,
    }

    await schedule_message_storage(message_doc)

    delivered = await connection_manager.send_personal_message(message_obj, to_user)
    status = MessageStatus.DELIVERED if delivered else MessageStatus.SENT

    await update_message_status(message_obj.message_id, status)

    delivery_receipt = DeliveryReceiptMessage(
        from_user=to_user,
        to_user=from_user,
        message_id=message_obj.message_id,
        status=status,
        timestamp=datetime.utcnow().isoformat(),
    )
    await connection_manager.send_personal_message(delivery_receipt, from_user)

    active_connections = connection_manager.active_connections
    sender_base_id = from_user.split(":")[0]
    recipient_base_id = to_user.split(":")[0]

    coroutines = []

    for conn_id, conn in active_connections.items():
        if conn_id == from_user or conn_id == to_user:
            continue

        if conn_id.startswith(sender_base_id):
            sender_message_obj = TextMessage(
                from_user=from_user,
                to_user=to_user,
                message_id=message_obj.message_id,
                text=message_obj.text,
                timestamp=message_obj.timestamp,
                attachments=message_obj.attachments,
                reply_to=message_obj.reply_to,
                status=status,
            )
            coroutines.append(
                connection_manager.send_personal_message(sender_message_obj, conn_id)
            )

        elif conn_id.startswith(recipient_base_id):
            recipient_message_obj = TextMessage(
                from_user=from_user,
                to_user=conn_id,
                message_id=message_obj.message_id,
                text=message_obj.text,
                timestamp=message_obj.timestamp,
                attachments=message_obj.attachments,
                reply_to=message_obj.reply_to,
                status=status,
            )
            coroutines.append(
                connection_manager.send_personal_message(recipient_message_obj, conn_id)
            )

    if coroutines:
        await asyncio.gather(*coroutines, return_exceptions=True)

    if not delivered:
        try:
            recipient = await get_cached_user(to_user)
            sender = await get_cached_user(from_user)

            if recipient and recipient.get("fcm_token"):
                sender_name = sender.get("display_name") if sender else "Someone"
                await send_new_message_notification(
                    recipient["fcm_token"],
                    sender_name,
                    message_obj.text,
                    message_obj.message_id,
                    from_user,
                )
        except Exception as e:
            logger.error(f"Error sending notification: {e}")

    debug_log(f"Text message handling complete for message {message_obj.message_id}")


async def handle_reply_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    sender_timezone = connection_manager.get_user_timezone(from_user)
    recipient_timezone = connection_manager.get_user_timezone(to_user)

    reply_obj = ReplyMessage(
        from_user=from_user,
        to_user=to_user,
        message_id=payload.get("id"),
        text=payload.get("text", ""),
        timestamp=payload.get("timestamp") or datetime.utcnow().isoformat(),
        status=payload.get("status", "sent"),
        attachments=payload.get("attachments", []),
        reply_to=payload.get("reply_to"),
    )

    conversation_id = f"{min(from_user, to_user)}_{max(from_user, to_user)}"
    message_doc = {
        "_id": reply_obj.message_id,
        "conversation_id": conversation_id,
        "sender_id": from_user,
        "recipient_id": to_user,
        "text": reply_obj.text,
        "timestamp": reply_obj.timestamp,
        "status": MessageStatus.SENT,
        "attachments": reply_obj.attachments or [],
        "reply_to": reply_obj.reply_to,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "type": "reply",
        "sender_timezone": sender_timezone,
        "recipient_timezone": recipient_timezone,
    }

    await schedule_message_storage(message_doc)
    delivered = await connection_manager.send_personal_message(reply_obj, to_user)

    status = MessageStatus.DELIVERED if delivered else MessageStatus.SENT
    await update_message_status(reply_obj.message_id, status)


async def handle_reaction_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    reaction_obj = ReactionMessage(
        from_user=from_user,
        to_user=to_user,
        message_id=payload.get("messageId"),
        reaction=payload.get("reaction"),
        action=payload.get("action"),
    )

    try:
        messages_collection = get_messages_collection()
        message_id = payload.get("messageId")

        original_message = await messages_collection.find_one({"_id": message_id})
        if not original_message:
            error = ErrorMessage(code=404, message="Message not found")
            await websocket.send_text(error.json())
            return

        if payload.get("action") == "add":
            await messages_collection.update_one(
                {"_id": message_id},
                {
                    "$addToSet": {
                        "reactions": {
                            "user_id": from_user,
                            "reaction": payload.get("reaction"),
                            "created_at": datetime.utcnow(),
                        }
                    }
                },
            )
        else:
            await messages_collection.update_one(
                {"_id": message_id},
                {
                    "$pull": {
                        "reactions": {
                            "user_id": from_user,
                            "reaction": payload.get("reaction"),
                        }
                    }
                },
            )

        if to_user != from_user:
            await connection_manager.send_personal_message(reaction_obj, to_user)

    except Exception as e:
        logger.error(f"Error handling reaction: {e}")
        error = ErrorMessage(code=500, message="Failed to process reaction")
        await websocket.send_text(error.json())


async def handle_edit_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    try:
        message_id = str(payload.get("messageId", ""))
        new_text = payload.get("text", "")

        if not message_id or not new_text:
            error_message = "Missing " + ("messageId" if not message_id else "text")
            error = ErrorMessage(code=400, message=error_message)
            await websocket.send_text(error.json())
            return

        messages_collection = get_messages_collection()
        message = await messages_collection.find_one(
            {"_id": message_id, "sender_id": from_user}
        )

        if not message:
            error = ErrorMessage(code=403, message="Cannot edit this message")
            await websocket.send_text(error.json())
            return

        edited_timestamp = datetime.utcnow()

        update_fields = {
            "text": new_text,
            "is_edited": True,
            "edited_at": edited_timestamp,
            "updated_at": edited_timestamp,
        }

        update_success = await update_message_status(
            message_id, message["status"], update_fields
        )
        if not update_success:
            error = ErrorMessage(
                code=500, message="Failed to update message in database"
            )
            await websocket.send_text(error.json())
            return

        edit_obj = EditMessage(
            from_user=from_user,
            to_user=to_user,
            message_id=message_id,
            text=new_text,
            edited_at=edited_timestamp.isoformat(),
        )

        ack = StatusMessage(
            from_user="system",
            to_user=from_user,
            status="ok",
            message="Message edited successfully",
            payload={"messageId": message_id},
        )
        await websocket.send_text(ack.json())

        await connection_manager.send_personal_message(edit_obj, to_user)

        # Broadcast to other relevant connections
        for uid, connection in connection_manager.active_connections.items():
            if uid != from_user and uid != to_user:
                try:
                    recipient_edit_obj = EditMessage(
                        from_user=from_user,
                        to_user=uid,
                        message_id=message_id,
                        text=new_text,
                        edited_at=edited_timestamp.isoformat(),
                    )
                    await connection_manager.send_personal_message(
                        recipient_edit_obj, uid
                    )
                except Exception as e:
                    logger.error(f"Error sending edit notification to {uid}: {e}")

    except Exception as e:
        logger.error(f"Error editing message: {e}")
        error = ErrorMessage(code=500, message="Failed to edit message")
        await websocket.send_text(error.json())


async def handle_delete_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    try:
        message_id = str(payload.get("messageId", ""))

        if not message_id:
            error = ErrorMessage(code=400, message="Missing messageId")
            await websocket.send_text(error.json())
            return

        messages_collection = get_messages_collection()
        message = await messages_collection.find_one(
            {"_id": message_id, "sender_id": from_user}
        )

        if not message:
            error = ErrorMessage(code=403, message="Cannot delete this message")
            await websocket.send_text(error.json())
            return

        deleted_timestamp = datetime.utcnow()

        update_fields = {
            "is_deleted": True,
            "deleted_at": deleted_timestamp,
            "updated_at": deleted_timestamp,
        }

        update_success = await update_message_status(
            message_id, message["status"], update_fields
        )
        if not update_success:
            error = ErrorMessage(
                code=500, message="Failed to update message in database"
            )
            await websocket.send_text(error.json())
            return

        delete_obj = DeleteMessage(
            from_user=from_user,
            to_user=to_user,
            message_id=message_id,
            deleted_at=deleted_timestamp.isoformat(),
        )

        ack = StatusMessage(
            from_user="system",
            to_user=from_user,
            status="ok",
            message="Message deleted successfully",
            payload={"messageId": message_id},
        )
        await websocket.send_text(ack.json())

        await connection_manager.send_personal_message(delete_obj, to_user)

        # Broadcast to other relevant connections
        for uid, connection in connection_manager.active_connections.items():
            if uid != from_user and uid != to_user:
                try:
                    recipient_delete_obj = DeleteMessage(
                        from_user=from_user,
                        to_user=uid,
                        message_id=message_id,
                        deleted_at=deleted_timestamp.isoformat(),
                    )
                    await connection_manager.send_personal_message(
                        recipient_delete_obj, uid
                    )
                except Exception as e:
                    logger.error(f"Error sending delete notification to {uid}: {e}")

    except Exception as e:
        logger.error(f"Error deleting message: {e}")
        error = ErrorMessage(code=500, message="Failed to delete message")
        await websocket.send_text(error.json())


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
                debug_log(f"Read receipt for non-existent message: {message_id}")
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
        if should_log_read_receipt(from_user, message_id):
            debug_log(
                f"Queued read receipt for {message_id} from {from_user} to {to_user}"
            )
    except Exception as e:
        logger.error(f"Error handling read receipt: {e}")


async def handle_read_receipt_batch(payload: Dict, from_user: str, to_user: str):
    """
    Process a batch of read receipts efficiently
    """
    message_ids = payload.get("messageIds", [])
    contact_id = payload.get("contactId")

    if not message_ids:
        return

    if DEBUG:
        debug_log(
            f"Processing batch of {len(message_ids)} read receipts from {from_user}"
        )

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
                    {"_id": {"$in": chunk}}
                ).to_list(length=None)

                # Extract IDs of messages that actually exist
                existing_ids = [msg["_id"] for msg in existing_messages]

                # Log any missing messages at debug level only
                missing_ids = [msg_id for msg_id in chunk if msg_id not in existing_ids]
                if missing_ids and DEBUG:
                    debug_log(f"Read receipt for non-existent messages: {missing_ids}")

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
            logger.error(f"Error processing read receipt chunk: {e}")

    if DEBUG and total_updated > 0:
        debug_log(
            f"Updated {total_updated} of {len(message_ids)} messages to read status"
        )

    # Only continue with notification if we have valid messages
    if not valid_messages:
        return

    # Create a batch notification for the original sender but only for valid messages
    batch_receipt = ReadReceiptBatchMessage(
        from_user=from_user,
        to_user=to_user,
        message_ids=valid_messages,  # Only include valid message IDs
        contact_id=contact_id,
        timestamp=datetime.utcnow().isoformat(),
    )

    # Send to the original sender
    await connection_manager.send_personal_message(batch_receipt, to_user)

    # Find client IDs that need to be notified
    notification_targets = set()

    # Only add clients that share the conversation
    sender_base_id = from_user.split(":")[0]
    recipient_base_id = to_user.split(":")[0]

    for uid in connection_manager.active_connections:
        # Skip the current user and original sender
        if uid == from_user or uid == to_user:
            continue

        # Add all related devices (more efficient than checking one by one)
        if uid.startswith(sender_base_id) or uid.startswith(recipient_base_id):
            notification_targets.add(uid)

    # Send notifications concurrently
    if notification_targets:
        coroutines = [
            connection_manager.send_personal_message(batch_receipt, uid)
            for uid in notification_targets
        ]
        await asyncio.gather(*coroutines, return_exceptions=True)


@websocket_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    user_id = None
    heartbeat_task = None  # Define heartbeat_task at the start to avoid linter error

    try:
        debug_log(f"WebSocket connection attempt")

        try:
            firebase_token = await verify_token(token)
            user_id = firebase_token.firebase_uid
            debug_log(f"WebSocket token verified for user: {user_id}")
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

                elif message_type == WebSocketMessageType.REACTION:
                    await handle_reaction_message(
                        payload, from_user, to_user, websocket
                    )

                elif message_type == WebSocketMessageType.EDIT:
                    await handle_edit_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.DELETE:
                    await handle_delete_message(payload, from_user, to_user, websocket)

                elif message_type == WebSocketMessageType.TYPING:
                    is_typing = payload.get("is_typing", False)
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
        debug_log(f"WebSocket client disconnected: {user_id}")
        if user_id:
            await connection_manager.disconnect(user_id)

    except ConnectionClosed:
        debug_log(f"WebSocket connection closed: {user_id}")
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
