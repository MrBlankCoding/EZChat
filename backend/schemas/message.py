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

    model_config = {"populate_by_name": True, "from_attributes": True}


class MessageUpdate(BaseModel):
    status: Optional[MessageStatus] = None
    delivered_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
