import json
import logging
from typing import Dict, Optional, List, Any, Tuple
from datetime import datetime
from fastapi import (
    APIRouter,
    WebSocket,
    WebSocketDisconnect,
    Query,
    HTTPException,
    status,
)
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
    DeliveryReceiptMessage,
    PresenceMessage,
    ErrorMessage,
    ReactionMessage,
    ReplyMessage,
    EditMessage,
    DeleteMessage,
    TimezoneMessage,
    StatusMessage,
)

# Configure logging
logger = logging.getLogger(__name__)

# WebSocket router
websocket_router = APIRouter()

# Rate limiter for messages (100 messages per minute)
message_rate_limiter = RateLimiter(limit=100, window=60)


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_statuses: Dict[str, str] = {}
        self.typing_status: Dict[Tuple[str, str], datetime] = {}
        self.user_timezones: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_statuses[user_id] = "online"
        logger.info(
            f"User {user_id} connected. Total active connections: {len(self.active_connections)}"
        )
        await self.broadcast_presence(user_id, "online")

    async def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            self.user_statuses[user_id] = "offline"
            logger.info(
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

        for recipient_id, connection in self.active_connections.items():
            if recipient_id != user_id:
                try:
                    await connection.send_text(message.json())
                except Exception as e:
                    logger.error(f"Error broadcasting presence to {recipient_id}: {e}")

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

    async def update_user_timezone(self, user_id: str, timezone: str):
        self.user_timezones[user_id] = timezone
        logger.info(f"Updated timezone for user {user_id}: {timezone}")

        try:
            users_collection = get_users_collection()
            await users_collection.update_one(
                {"_id": user_id},
                {"$set": {"timezone": timezone, "updated_at": datetime.utcnow()}},
            )
        except Exception as e:
            logger.error(f"Error storing timezone in database: {e}")


# Create global connection manager
connection_manager = ConnectionManager()


async def verify_token(token: str) -> FirebaseToken:
    firebase_token = FirebaseToken(token)
    await firebase_token.verify()
    return firebase_token


def validate_message(message_data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """
    Validate message data to ensure it has all required fields.
    Returns a tuple of (is_valid, error_message)
    """
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


async def store_message_in_db(message_data: Dict[str, Any]) -> bool:
    try:
        # Validate message before storing
        is_valid, error = validate_message(message_data)
        if not is_valid:
            logger.error(f"Cannot store message: {error}")
            return False

        messages_collection = get_messages_collection()
        result = await messages_collection.insert_one(message_data)

        if not result.acknowledged:
            logger.error(
                f"Message {message_data.get('_id')} not acknowledged by MongoDB"
            )
            return False

        logger.debug(
            f"Message {message_data.get('_id')} stored with result: {result.inserted_id}"
        )
        return True
    except Exception as e:
        logger.error(f"Error storing message {message_data.get('_id')}: {e}")
        return False


async def update_message_status(
    message_id: str, status: str, update_fields: Optional[Dict] = None
):
    try:
        if not message_id:
            logger.error("Cannot update message status: Missing message_id")
            return False

        messages_collection = get_messages_collection()
        update_data = {"$set": {"status": status}}

        if update_fields:
            update_data["$set"].update(update_fields)

        result = await messages_collection.update_one({"_id": message_id}, update_data)

        if result.matched_count == 0:
            logger.warning(f"Message {message_id} not found for status update")
            return False

        logger.debug(
            f"Updated message {message_id} status to {status}, modified: {result.modified_count}"
        )
        return True
    except Exception as e:
        logger.error(f"Error updating message {message_id} status: {e}")
        return False


async def handle_text_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
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

    # Generate a consistent conversation ID format
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

    if not await store_message_in_db(message_doc):
        error_message = ErrorMessage(code=500, message="Failed to store message")
        await websocket.send_text(error_message.json())
        logger.error(f"Failed to store message: {message_obj.message_id}")
        return

    # Log successful message storage
    logger.info(
        f"Message {message_obj.message_id} stored in database for conversation {conversation_id}"
    )

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

    if not delivered:
        try:
            users_collection = get_users_collection()
            recipient = await users_collection.find_one({"_id": to_user})
            sender = await users_collection.find_one({"_id": from_user})

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

    if not await store_message_in_db(message_doc):
        error = ErrorMessage(code=500, message="Failed to store reply")
        await websocket.send_text(error.json())
        return

    await connection_manager.send_personal_message(reply_obj, to_user)


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

        # Send reaction to recipient if different from sender
        if to_user != from_user:
            await connection_manager.send_personal_message(reaction_obj, to_user)

    except Exception as e:
        logger.error(f"Error handling reaction: {e}")
        error = ErrorMessage(code=500, message="Failed to process reaction")
        await websocket.send_text(error.json())


async def handle_edit_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    message_id = payload.get("messageId")
    new_text = payload.get("text")

    try:
        messages_collection = get_messages_collection()
        message = await messages_collection.find_one(
            {"_id": message_id, "sender_id": from_user}
        )

        if not message:
            error = ErrorMessage(code=403, message="Cannot edit this message")
            await websocket.send_text(error.json())
            return

        update_fields = {
            "text": new_text,
            "is_edited": True,
            "edited_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        await update_message_status(message_id, message["status"], update_fields)

        edit_obj = EditMessage(
            from_user=from_user,
            to_user=to_user,
            message_id=message_id,
            text=new_text,
        )

        await connection_manager.send_personal_message(edit_obj, to_user)

    except Exception as e:
        logger.error(f"Error editing message: {e}")
        error = ErrorMessage(code=500, message="Failed to edit message")
        await websocket.send_text(error.json())


async def handle_delete_message(
    payload: Dict, from_user: str, to_user: str, websocket: WebSocket
):
    message_id = payload.get("messageId")

    try:
        messages_collection = get_messages_collection()
        message = await messages_collection.find_one(
            {"_id": message_id, "sender_id": from_user}
        )

        if not message:
            error = ErrorMessage(code=403, message="Cannot delete this message")
            await websocket.send_text(error.json())
            return

        update_fields = {
            "is_deleted": True,
            "deleted_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        await update_message_status(message_id, message["status"], update_fields)

        delete_obj = DeleteMessage(
            from_user=from_user,
            to_user=to_user,
            message_id=message_id,
        )

        await connection_manager.send_personal_message(delete_obj, to_user)

    except Exception as e:
        logger.error(f"Error deleting message: {e}")
        error = ErrorMessage(code=500, message="Failed to delete message")
        await websocket.send_text(error.json())


async def handle_read_receipt(payload: Dict, from_user: str, to_user: str):
    message_id = payload.get("messageId")

    if message_id:
        update_fields = {
            "read_at": datetime.utcnow(),
        }

        await update_message_status(message_id, MessageStatus.READ, update_fields)

        read_receipt = ReadReceiptMessage(
            from_user=from_user,
            to_user=to_user,
            message_id=message_id,
            status=MessageStatus.READ,
            timestamp=datetime.utcnow().isoformat(),
        )

        await connection_manager.send_personal_message(read_receipt, to_user)


@websocket_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    user_id = None
    try:
        logger.info(f"WebSocket connection attempt with token: {token[:10]}...")

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
                    if timezone:
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

                elif message_type == WebSocketMessageType.PRESENCE:
                    status = payload.get("status")
                    if status:
                        connection_manager.user_statuses[from_user] = status
                        await connection_manager.broadcast_presence(from_user, status)

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
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if user_id:
            await connection_manager.disconnect(user_id)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except:
            pass
