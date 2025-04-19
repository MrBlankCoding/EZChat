from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class MessageStatus(str, Enum):
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"


class AttachmentType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"


class Attachment(BaseModel):
    type: AttachmentType
    url: str
    name: str
    size: int
    metadata: Optional[Dict[str, Any]] = None


class MessageBase(BaseModel):
    text: str
    attachments: Optional[List[Attachment]] = None


class MessageCreate(MessageBase):
    conversation_id: str
    sender_id: str
    recipient_id: str


class MessageInDB(MessageBase):
    id: str = Field(..., alias="_id")
    conversation_id: str
    sender_id: str
    recipient_id: str
    status: MessageStatus = MessageStatus.SENT
    created_at: datetime
    updated_at: datetime
    delivered_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    reply_to: Optional[str] = None
    is_edited: Optional[bool] = False
    edited_at: Optional[datetime] = None
    is_deleted: Optional[bool] = False
    deleted_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


class MessageResponse(MessageBase):
    id: str = Field(..., alias="_id")
    conversation_id: str
    sender_id: str
    recipient_id: str
    status: MessageStatus
    created_at: datetime
    updated_at: datetime
    delivered_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    reply_to: Optional[str] = None
    is_edited: Optional[bool] = False
    edited_at: Optional[datetime] = None
    is_deleted: Optional[bool] = False
    deleted_at: Optional[datetime] = None
    sender_timezone: Optional[str] = None
    recipient_timezone: Optional[str] = None

    # Add this to ensure text is always included in the response
    text: str

    model_config = {"populate_by_name": True, "from_attributes": True}

    # Custom method to transform database message to response
    @classmethod
    def from_db(cls, db_message):
        # If the message is from WebSocket and has a special format
        if "payload" in db_message and db_message.get("type") == "message":
            payload = db_message["payload"]
            # Extract text from the payload
            if "text" in payload:
                db_message["text"] = payload["text"]

        return cls(**db_message)


class MessageUpdate(BaseModel):
    status: Optional[MessageStatus] = None
    delivered_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    is_edited: Optional[bool] = None
    edited_at: Optional[datetime] = None
    is_deleted: Optional[bool] = None
    deleted_at: Optional[datetime] = None
    text: Optional[str] = None
