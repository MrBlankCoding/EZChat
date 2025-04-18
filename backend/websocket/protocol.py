from enum import Enum, auto
from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel, Field, model_validator
import uuid
from datetime import datetime
import json


class WebSocketMessageType(str, Enum):
    """
    Types of WebSocket messages in the protocol.
    """

    MESSAGE = "message"
    TYPING = "typing"
    STATUS = "status"
    READ_RECEIPT = "read_receipt"
    READ_RECEIPT_BATCH = "read_receipt_batch"
    DELIVERY_RECEIPT = "delivery_receipt"
    PRESENCE = "presence"
    ERROR = "error"
    REACTION = "reaction"
    REPLY = "reply"
    EDIT = "edit"
    DELETE = "delete"
    TIMEZONE = "timezone"
    PING = "ping"
    PONG = "pong"


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


class EditMessage(WebSocketMessage):
    """
    Edit an existing message.
    """

    type: WebSocketMessageType = WebSocketMessageType.EDIT
    message_id: str
    text: str
    edited_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    model_config = {"populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def extract_payload_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            payload = data.get("payload")
            if isinstance(payload, dict):
                # Extract fields from payload if they exist and aren't already at root
                if "messageId" in payload and "message_id" not in data:
                    data["message_id"] = payload.get("messageId")
                elif "message_id" in payload and "message_id" not in data:
                    data["message_id"] = payload.get("message_id")

                if "text" in payload and "text" not in data:
                    data["text"] = payload.get("text")

                if "editedAt" in payload and "edited_at" not in data:
                    data["edited_at"] = payload.get("editedAt")
                elif "edited_at" in payload and "edited_at" not in data:
                    data["edited_at"] = payload.get("edited_at")

            # Ensure edited_at is set if missing after potential extraction
            if "edited_at" not in data:
                data["edited_at"] = datetime.utcnow().isoformat()

        # Allow 'id' as an alias for 'message_id' at the root
        if isinstance(data, dict) and "id" in data and "message_id" not in data:
            data["message_id"] = data["id"]

        # Let Pydantic's validation handle missing required fields like message_id or text
        return data

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        payload = {
            "messageId": self.message_id,  # Use validated self attributes
            "text": self.text,
            "editedAt": self.edited_at,
        }
        d["payload"] = payload
        return d


class DeleteMessage(WebSocketMessage):
    """
    Delete a message.
    """

    type: WebSocketMessageType = WebSocketMessageType.DELETE
    message_id: str
    deleted_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    model_config = {"populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def extract_payload_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            payload = data.get("payload")
            if isinstance(payload, dict):
                # Extract fields from payload if they exist and aren't already at root
                if "messageId" in payload and "message_id" not in data:
                    data["message_id"] = payload.get("messageId")
                elif "message_id" in payload and "message_id" not in data:
                    data["message_id"] = payload.get("message_id")

                if "deletedAt" in payload and "deleted_at" not in data:
                    data["deleted_at"] = payload.get("deletedAt")
                elif "deleted_at" in payload and "deleted_at" not in data:
                    data["deleted_at"] = payload.get("deleted_at")

            # Also allow 'id' as an alias for 'message_id' at the root
            if "id" in data and "message_id" not in data:
                data["message_id"] = data["id"]

            # Ensure deleted_at is set if missing after potential extraction
            if "deleted_at" not in data:
                data["deleted_at"] = datetime.utcnow().isoformat()

        # We let Pydantic's main validation handle the missing 'message_id' error
        # if it's still not present after this pre-processing.
        # Adding a check here would be redundant.

        return data

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        # Ensure we access the validated attributes from self
        payload = {
            "messageId": self.message_id,
            "deletedAt": self.deleted_at,
        }
        d["payload"] = payload
        return d


class ErrorMessage(BaseModel):
    """
    Error message.
    """

    type: WebSocketMessageType = WebSocketMessageType.ERROR
    code: int
    message: str

    def dict(self, *args, **kwargs):
        # Pydantic v2 automatically handles aliases in dict if populate_by_name is True
        # Let's simplify to rely on Pydantic's dict() and structure manually for JSON
        base_dict = super().model_dump(*args, **kwargs)  # Use model_dump in Pydantic v2
        return {
            "type": self.type,
            "payload": {
                "code": base_dict.get("code"),
                "message": base_dict.get("message"),
            },
        }

    def json(self, *args, **kwargs):
        """
        Generate JSON representation making sure to include the type and payload correctly.
        """
        # Use the custom dict method to get the desired structure
        data = self.dict(*args, **kwargs)
        # Use standard json.dumps
        return json.dumps(data)


class TimezoneMessage(WebSocketMessage):
    """
    Message to inform the server about a user's timezone.
    """

    type: WebSocketMessageType = WebSocketMessageType.TIMEZONE
    timezone: Optional[str] = None
    verify_only: bool = False

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        payload = {}
        if "timezone" in d:
            payload["timezone"] = d.pop("timezone")
        if "verify_only" in d:
            payload["verify_only"] = d.pop("verify_only")
        d["payload"] = payload
        return d


class StatusMessage(WebSocketMessage):
    """
    Status message for acknowledgements.
    """

    type: WebSocketMessageType = WebSocketMessageType.STATUS
    status: str = "ok"
    message: str = ""
    payload: Optional[Dict[str, Any]] = None

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Create the payload dictionary
        payload_dict = {"status": d.pop("status"), "message": d.pop("message")}

        # Add custom payload fields if provided
        custom_payload = d.pop("payload", None)
        if custom_payload:
            payload_dict.update(custom_payload)

        d["payload"] = payload_dict
        return d


class PingMessage(BaseModel):
    """
    Ping message to check connection status.
    """

    type: str = "ping"
    timestamp: int = Field(
        default_factory=lambda: int(datetime.utcnow().timestamp() * 1000)
    )

    def dict(self, *args, **kwargs):
        return {"type": self.type, "timestamp": self.timestamp}


class PongMessage(BaseModel):
    """
    Pong response to a ping message.
    """

    type: str = "pong"
    timestamp: int

    def dict(self, *args, **kwargs):
        return {"type": self.type, "timestamp": self.timestamp}


class ReadReceiptBatchMessage(WebSocketMessage):
    """
    Batch of read receipt messages.
    """

    type: WebSocketMessageType = WebSocketMessageType.READ_RECEIPT_BATCH
    message_ids: List[str]
    contact_id: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    def dict(self, *args, **kwargs):
        d = super().dict(*args, **kwargs)
        # Move payload-related fields under payload
        d["payload"] = {
            "messageIds": d.pop("message_ids"),
            "contactId": d.pop("contact_id"),
            "timestamp": d.pop("timestamp"),
        }
        return d
