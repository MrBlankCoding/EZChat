from enum import Enum, auto
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field
import uuid
from datetime import datetime


class WebSocketMessageType(str, Enum):
    """
    Types of WebSocket messages in the protocol.
    """

    MESSAGE = "message"
    TYPING = "typing"
    STATUS = "status"
    READ_RECEIPT = "read_receipt"
    DELIVERY_RECEIPT = "delivery_receipt"
    PRESENCE = "presence"
    ERROR = "error"
    REACTION = "reaction"
    REPLY = "reply"
    EDIT = "edit"
    DELETE = "delete"
    TIMEZONE = "timezone"


class WebSocketMessage(BaseModel):
    """
    Base class for all WebSocket messages.
    """

    type: WebSocketMessageType
    from_user: str = Field(..., alias="from")
    to_user: Optional[str] = Field(None, alias="to")

    model_config = {"populate_by_name": True}


class AttachmentData(BaseModel):
    """
    Attachment data for messages.
    """

    type: str
    url: str
    name: str
    size: int
    metadata: Optional[Dict[str, Any]] = None


class TextMessage(WebSocketMessage):
    """
    Text message with optional attachments.
    """

    type: WebSocketMessageType = WebSocketMessageType.MESSAGE
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="id")
    text: str
    timestamp: str
    status: str = "sent"
    attachments: Optional[List[AttachmentData]] = None
    reply_to: Optional[str] = None

    model_config = {"populate_by_name": True}

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        payload = {
            "id": d.pop("id", None),
            "text": d.pop("text", None),
            "timestamp": d.pop("timestamp", None),
            "status": d.pop("status", None),
        }
        if "attachments" in d:
            payload["attachments"] = d.pop("attachments")
        if "reply_to" in d and d["reply_to"]:
            payload["reply_to"] = d.pop("reply_to")
        d["payload"] = payload
        return d


class TypingMessage(WebSocketMessage):
    """
    Typing indicator message.
    """

    type: WebSocketMessageType = WebSocketMessageType.TYPING
    is_typing: bool

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {"isTyping": d.pop("is_typing")}
        return d


class ReadReceiptMessage(WebSocketMessage):
    """
    Read receipt message.
    """

    type: WebSocketMessageType = WebSocketMessageType.READ_RECEIPT
    message_id: str
    status: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageId": d.pop("message_id"),
            "status": d.pop("status"),
            "timestamp": d.pop("timestamp"),
        }
        return d


class DeliveryReceiptMessage(WebSocketMessage):
    """
    Delivery receipt message.
    """

    type: WebSocketMessageType = WebSocketMessageType.DELIVERY_RECEIPT
    message_id: str
    status: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageId": d.pop("message_id"),
            "status": d.pop("status"),
            "timestamp": d.pop("timestamp"),
        }
        return d


class PresenceMessage(WebSocketMessage):
    """
    Presence update message.
    """

    type: WebSocketMessageType = WebSocketMessageType.PRESENCE
    status: str
    last_seen: str

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {"status": d.pop("status"), "lastSeen": d.pop("last_seen")}
        return d


class ReactionMessage(WebSocketMessage):
    """
    Message reaction.
    """

    type: WebSocketMessageType = WebSocketMessageType.REACTION
    message_id: str
    reaction: str
    action: str  # "add" or "remove"
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageId": d.pop("message_id"),
            "reaction": d.pop("reaction"),
            "action": d.pop("action"),
            "timestamp": d.pop("timestamp"),
        }
        return d


class ReplyMessage(TextMessage):
    """
    Reply to a message.
    """

    type: WebSocketMessageType = WebSocketMessageType.REPLY

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Make sure type is correctly set
        d["type"] = WebSocketMessageType.REPLY
        return d


class EditMessage(WebSocketMessage):
    """
    Edit an existing message.
    """

    type: WebSocketMessageType = WebSocketMessageType.EDIT
    message_id: str
    text: str
    edited_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageId": d.pop("message_id"),
            "text": d.pop("text"),
            "editedAt": d.pop("edited_at"),
        }
        return d


class DeleteMessage(WebSocketMessage):
    """
    Delete a message.
    """

    type: WebSocketMessageType = WebSocketMessageType.DELETE
    message_id: str

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageId": d.pop("message_id"),
        }
        return d


class ErrorMessage(BaseModel):
    """
    Error message.
    """

    type: WebSocketMessageType = WebSocketMessageType.ERROR
    code: int
    message: str

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {"code": d.pop("code"), "message": d.pop("message")}
        return d

    def json(self, *args, **kwargs):
        """
        Generate JSON representation making sure to include the type and payload correctly.
        """
        import json

        data = {
            "type": self.type,
            "payload": {"code": self.code, "message": self.message},
        }
        return json.dumps(data)


class TimezoneMessage(WebSocketMessage):
    """
    Message to inform the server about a user's timezone.
    """

    type: WebSocketMessageType = WebSocketMessageType.TIMEZONE
    timezone: str

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {"timezone": d.pop("timezone")}
        return d


class StatusMessage(WebSocketMessage):
    """
    Status message for acknowledgements.
    """

    type: WebSocketMessageType = WebSocketMessageType.STATUS
    status: str = "ok"
    message: str = ""

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "status": d.pop("status"),
            "message": d.pop("message"),
        }
        return d
