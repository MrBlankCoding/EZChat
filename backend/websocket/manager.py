import json
import logging
import asyncio
from typing import Dict, Set, Optional, List, Any
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
from schemas.message import MessageStatus, MessageResponse
from utils.rate_limiter import RateLimiter
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
)
from utils.notifications import send_new_message_notification

# Configure logging
logger = logging.getLogger(__name__)

# WebSocket router
websocket_router = APIRouter()

# Rate limiter for messages (100 messages per minute)
message_rate_limiter = RateLimiter(limit=100, window=60)


class ConnectionManager:
    """
    Manages active WebSocket connections and message broadcasting.
    """

    def __init__(self):
        # Map of user_id to WebSocket connection
        self.active_connections: Dict[str, WebSocket] = {}
        # Map of user_id to user status
        self.user_statuses: Dict[str, str] = {}
        # User typing status: Map of (user_id, recipient_id) to last typing timestamp
        self.typing_status: Dict[tuple, datetime] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        """
        Connect a new WebSocket client and store the connection.
        """
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_statuses[user_id] = "online"
        logger.info(
            f"User {user_id} connected. Total active connections: {len(self.active_connections)}"
        )

        # Broadcast presence update
        await self.broadcast_presence(user_id, "online")

    def disconnect(self, user_id: str):
        """
        Remove a disconnected WebSocket client.
        """
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            self.user_statuses[user_id] = "offline"
            logger.info(
                f"User {user_id} disconnected. Remaining connections: {len(self.active_connections)}"
            )

            # Schedule presence update
            asyncio.create_task(self.broadcast_presence(user_id, "offline"))

    async def broadcast_presence(self, user_id: str, status: str):
        """
        Broadcast user presence update to all connected clients.
        """
        message = PresenceMessage(
            from_user=user_id,
            to_user=None,
            status=status,
            last_seen=datetime.utcnow().isoformat(),
        )

        for recipient_id, connection in self.active_connections.items():
            if recipient_id != user_id:  # Don't send to self
                try:
                    await connection.send_text(message.json())
                except Exception as e:
                    logger.error(f"Error broadcasting presence to {recipient_id}: {e}")

    async def send_personal_message(self, message: WebSocketMessage, recipient_id: str):
        """
        Send a message to a specific connected client.
        """
        # Check if recipient is connected
        if recipient_id in self.active_connections:
            try:
                connection = self.active_connections[recipient_id]

                # Check if connection is still open
                if connection.client_state == WebSocketState.CONNECTED:
                    await connection.send_text(message.json())
                    return True
                else:
                    logger.warning(
                        f"WebSocket for user {recipient_id} is in state {connection.client_state}"
                    )
                    self.disconnect(recipient_id)
                    return False
            except Exception as e:
                logger.error(f"Error sending message to {recipient_id}: {e}")
                self.disconnect(recipient_id)
                return False
        return False

    async def update_typing_status(self, from_user: str, to_user: str, is_typing: bool):
        """
        Update typing status and broadcast to recipient.
        """
        key = (from_user, to_user)
        now = datetime.utcnow()

        # Update typing status
        if is_typing:
            self.typing_status[key] = now
        elif key in self.typing_status:
            del self.typing_status[key]

        # Create typing message
        message = TypingMessage(
            from_user=from_user, to_user=to_user, is_typing=is_typing
        )

        # Send typing indication to recipient
        return await self.send_personal_message(message, to_user)

    def get_connected_users(self) -> List[str]:
        """
        Get a list of all connected user IDs.
        """
        return list(self.active_connections.keys())

    def is_user_online(self, user_id: str) -> bool:
        """
        Check if a user is currently online.
        """
        return user_id in self.active_connections

    def get_user_status(self, user_id: str) -> str:
        """
        Get a user's current status.
        """
        return self.user_statuses.get(user_id, "offline")


# Create global connection manager
connection_manager = ConnectionManager()


async def verify_token(token: str) -> FirebaseToken:
    """
    Verify Firebase token for WebSocket authentication.
    """
    firebase_token = FirebaseToken(token)
    await firebase_token.verify()
    return firebase_token


@websocket_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """
    WebSocket endpoint for real-time messaging.
    """
    user_id = None
    try:
        logger.info(f"WebSocket connection attempt with token: {token[:10]}...")

        # Verify token
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

        # Accept connection
        await connection_manager.connect(websocket, user_id)

        # Handle messages
        while True:
            # Receive message from client
            data = await websocket.receive_text()

            try:
                # Parse message data
                message_data = json.loads(data)

                # Apply rate limiting
                if not message_rate_limiter.is_allowed(user_id):
                    # Send rate limit error
                    error = ErrorMessage(
                        code=429, message="Rate limit exceeded. Please try again later."
                    )
                    await websocket.send_text(error.json())
                    continue

                # Process message based on type
                message_type = message_data.get("type")
                from_user = message_data.get("from")
                to_user = message_data.get("to")
                payload = message_data.get("payload", {})

                # Validate sender
                if from_user != user_id:
                    error = ErrorMessage(
                        code=403, message="Sender ID does not match authenticated user"
                    )
                    await websocket.send_text(error.json())
                    continue

                # Process different message types
                if message_type == WebSocketMessageType.MESSAGE:
                    # Text message
                    message_obj = TextMessage(
                        from_user=from_user,
                        to_user=to_user,
                        message_id=payload.get("id"),
                        text=payload.get("text", ""),
                        timestamp=payload.get("timestamp")
                        or datetime.utcnow().isoformat(),
                        status=payload.get("status", "sent"),
                        attachments=payload.get("attachments", []),
                        reply_to=payload.get("reply_to"),
                    )

                    # Store message in database
                    try:
                        messages_collection = get_messages_collection()

                        # Create conversation ID (sort user IDs to ensure consistency)
                        conversation_id = (
                            f"{min(from_user, to_user)}_{max(from_user, to_user)}"
                        )

                        # Convert message to dict for storage
                        message_dict = message_obj.model_dump(by_alias=True)
                        message_dict["conversation_id"] = conversation_id
                        message_dict["sender_id"] = from_user
                        message_dict["recipient_id"] = to_user
                        message_dict["created_at"] = datetime.utcnow()
                        message_dict["updated_at"] = datetime.utcnow()
                        message_dict["type"] = "message"

                        # Store message
                        result = await messages_collection.insert_one(message_dict)
                        message_id = str(result.inserted_id)
                        message_obj.message_id = message_id
                    except Exception as e:
                        logger.error(f"Error storing message: {e}")
                        error = ErrorMessage(
                            code=500, message="Failed to store message"
                        )
                        await websocket.send_text(error.json())
                        continue

                    # Update conversation in database
                    try:
                        # This would be handled by a separate function to update conversation metadata
                        # update_conversation(from_user, to_user, message_obj)
                        pass
                    except Exception as e:
                        logger.warning(f"Error updating conversation: {e}")
                        # Continue anyway as the message is already stored

                    # Send message to recipient
                    recipient_received = False
                    if to_user in connection_manager.active_connections:
                        try:
                            await connection_manager.send_personal_message(
                                message_obj, to_user
                            )
                            recipient_received = True
                        except Exception as e:
                            logger.error(f"Error sending message to recipient: {e}")
                    else:
                        # Recipient is not connected, send a push notification
                        try:
                            # Get recipient information for the notification
                            users_collection = get_users_collection()
                            sender = await users_collection.find_one(
                                {"firebase_uid": from_user}
                            )

                            if sender:
                                sender_name = sender.get("display_name", "Someone")

                                # Send the notification
                                await send_new_message_notification(
                                    to_user,
                                    sender_name,
                                    message_obj.text,
                                    message_id,
                                    from_user,
                                )
                        except Exception as e:
                            logger.error(f"Error sending push notification: {e}")

                    # Send delivery receipt to sender
                    if recipient_received:
                        try:
                            # Update message status in database
                            await messages_collection.update_one(
                                {"_id": result.inserted_id},
                                {"$set": {"status": "delivered"}},
                            )

                            # Send delivery receipt
                            receipt = DeliveryReceiptMessage(
                                from_user=to_user,
                                to_user=from_user,
                                message_id=message_id,
                                status="delivered",
                                timestamp=datetime.utcnow().isoformat(),
                            )
                            await connection_manager.send_personal_message(
                                receipt, from_user
                            )
                        except Exception as e:
                            logger.error(f"Error sending delivery receipt: {e}")

                elif message_type == WebSocketMessageType.REPLY:
                    # Reply message
                    reply_obj = ReplyMessage(
                        from_user=from_user,
                        to_user=to_user,
                        message_id=payload.get("id"),
                        text=payload.get("text", ""),
                        timestamp=payload.get("timestamp")
                        or datetime.utcnow().isoformat(),
                        status=payload.get("status", "sent"),
                        attachments=payload.get("attachments", []),
                        reply_to=payload.get("reply_to"),
                    )

                    # Store reply in database
                    try:
                        messages_collection = get_messages_collection()

                        # Create conversation ID (sort user IDs to ensure consistency)
                        conversation_id = (
                            f"{min(from_user, to_user)}_{max(from_user, to_user)}"
                        )

                        # Convert message to dict for storage
                        message_dict = reply_obj.model_dump(by_alias=True)
                        message_dict["conversation_id"] = conversation_id
                        message_dict["sender_id"] = from_user
                        message_dict["recipient_id"] = to_user
                        message_dict["created_at"] = datetime.utcnow()
                        message_dict["updated_at"] = datetime.utcnow()
                        message_dict["type"] = "reply"

                        # Store message
                        result = await messages_collection.insert_one(message_dict)
                        message_id = str(result.inserted_id)
                        reply_obj.message_id = message_id
                    except Exception as e:
                        logger.error(f"Error storing reply: {e}")
                        error = ErrorMessage(code=500, message="Failed to store reply")
                        await websocket.send_text(error.json())
                        continue

                    # Send reply to recipient if connected
                    if to_user in connection_manager.active_connections:
                        try:
                            await connection_manager.send_personal_message(
                                reply_obj, to_user
                            )
                        except Exception as e:
                            logger.error(f"Error sending reply to recipient: {e}")

                elif message_type == WebSocketMessageType.REACTION:
                    # Message reaction
                    reaction_obj = ReactionMessage(
                        from_user=from_user,
                        to_user=to_user,
                        message_id=payload.get("messageId"),
                        reaction=payload.get("reaction"),
                        action=payload.get("action"),
                    )

                    # Store reaction in database
                    try:
                        messages_collection = get_messages_collection()
                        message_id = payload.get("messageId")

                        # Find the original message
                        original_message = await messages_collection.find_one(
                            {"_id": message_id}
                        )

                        if not original_message:
                            error = ErrorMessage(code=404, message="Message not found")
                            await websocket.send_text(error.json())
                            continue

                        # Update or create reactions array
                        if payload.get("action") == "add":
                            # Add reaction if it doesn't exist
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
                            # Remove reaction
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
                    except Exception as e:
                        logger.error(f"Error handling reaction: {e}")
                        error = ErrorMessage(
                            code=500, message="Failed to process reaction"
                        )
                        await websocket.send_text(error.json())
                        continue

                    # Send reaction to both sender and recipient
                    for user_id in [from_user, to_user]:
                        if (
                            user_id in connection_manager.active_connections
                            and user_id != from_user
                        ):
                            try:
                                await connection_manager.send_personal_message(
                                    reaction_obj, user_id
                                )
                            except Exception as e:
                                logger.error(
                                    f"Error sending reaction to {user_id}: {e}"
                                )

                elif message_type == WebSocketMessageType.EDIT:
                    # Edit message
                    edit_obj = EditMessage(
                        from_user=from_user,
                        to_user=to_user,
                        message_id=payload.get("messageId"),
                        text=payload.get("text"),
                    )

                    # Update message in database
                    try:
                        messages_collection = get_messages_collection()
                        message_id = payload.get("messageId")

                        # Verify the message exists and belongs to the sender
                        message = await messages_collection.find_one(
                            {"_id": message_id, "sender_id": from_user}
                        )

                        if not message:
                            error = ErrorMessage(
                                code=403, message="Cannot edit this message"
                            )
                            await websocket.send_text(error.json())
                            continue

                        # Update message text and mark as edited
                        await messages_collection.update_one(
                            {"_id": message_id},
                            {
                                "$set": {
                                    "text": payload.get("text"),
                                    "is_edited": True,
                                    "edited_at": datetime.utcnow(),
                                    "updated_at": datetime.utcnow(),
                                }
                            },
                        )
                    except Exception as e:
                        logger.error(f"Error editing message: {e}")
                        error = ErrorMessage(code=500, message="Failed to edit message")
                        await websocket.send_text(error.json())
                        continue

                    # Send edit notification to recipient
                    if to_user in connection_manager.active_connections:
                        try:
                            await connection_manager.send_personal_message(
                                edit_obj, to_user
                            )
                        except Exception as e:
                            logger.error(f"Error sending edit notification: {e}")

                elif message_type == WebSocketMessageType.DELETE:
                    # Delete message
                    delete_obj = DeleteMessage(
                        from_user=from_user,
                        to_user=to_user,
                        message_id=payload.get("messageId"),
                    )

                    # Update message in database (soft delete)
                    try:
                        messages_collection = get_messages_collection()
                        message_id = payload.get("messageId")

                        # Verify the message exists and belongs to the sender
                        message = await messages_collection.find_one(
                            {"_id": message_id, "sender_id": from_user}
                        )

                        if not message:
                            error = ErrorMessage(
                                code=403, message="Cannot delete this message"
                            )
                            await websocket.send_text(error.json())
                            continue

                        # Soft delete - mark as deleted but keep the record
                        await messages_collection.update_one(
                            {"_id": message_id},
                            {
                                "$set": {
                                    "is_deleted": True,
                                    "deleted_at": datetime.utcnow(),
                                    "updated_at": datetime.utcnow(),
                                }
                            },
                        )
                    except Exception as e:
                        logger.error(f"Error deleting message: {e}")
                        error = ErrorMessage(
                            code=500, message="Failed to delete message"
                        )
                        await websocket.send_text(error.json())
                        continue

                    # Send delete notification to recipient
                    if to_user in connection_manager.active_connections:
                        try:
                            await connection_manager.send_personal_message(
                                delete_obj, to_user
                            )
                        except Exception as e:
                            logger.error(f"Error sending delete notification: {e}")

                elif message_type == WebSocketMessageType.TYPING:
                    # Typing indicator
                    is_typing = payload.get("isTyping", False)
                    await connection_manager.update_typing_status(
                        from_user, to_user, is_typing
                    )

                elif message_type == WebSocketMessageType.READ_RECEIPT:
                    # Read receipt
                    message_id = payload.get("messageId")

                    if message_id:
                        # Update message status in database
                        messages_collection = get_messages_collection()
                        await messages_collection.update_one(
                            {"_id": message_id, "recipient_id": from_user},
                            {
                                "$set": {
                                    "status": MessageStatus.READ,
                                    "read_at": datetime.utcnow(),
                                }
                            },
                        )

                        # Send read receipt to original sender
                        read_receipt = ReadReceiptMessage(
                            from_user=from_user,
                            to_user=to_user,
                            message_id=message_id,
                            status=MessageStatus.READ,
                            timestamp=datetime.utcnow().isoformat(),
                        )

                        await connection_manager.send_personal_message(
                            read_receipt, to_user
                        )

                elif message_type == WebSocketMessageType.PRESENCE:
                    # Presence update
                    status = payload.get("status")

                    if status:
                        connection_manager.user_statuses[from_user] = status
                        await connection_manager.broadcast_presence(from_user, status)

                else:
                    # Unknown message type
                    error = ErrorMessage(
                        code=400, message=f"Unknown message type: {message_type}"
                    )
                    await websocket.send_text(error.json())

            except json.JSONDecodeError:
                # Invalid JSON
                error = ErrorMessage(code=400, message="Invalid JSON format")
                await websocket.send_text(error.json())

            except Exception as e:
                # General error
                logger.error(f"Error processing message: {e}")
                error = ErrorMessage(code=500, message="Internal server error")
                await websocket.send_text(error.json())

    except WebSocketDisconnect:
        # Client disconnected
        logger.info(f"WebSocket client disconnected: {user_id}")
        if user_id:
            connection_manager.disconnect(user_id)

    except ConnectionClosed:
        # Connection closed
        logger.info(f"WebSocket connection closed: {user_id}")
        if user_id:
            connection_manager.disconnect(user_id)

    except HTTPException as http_exc:
        # Authentication error
        logger.warning(f"WebSocket authentication error: {http_exc.detail}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)

    except Exception as e:
        # Unexpected error
        logger.error(f"WebSocket error: {e}")
        if user_id:
            connection_manager.disconnect(user_id)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except:
            pass
