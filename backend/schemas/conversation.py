from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from .message import MessageResponse


class ConversationBase(BaseModel):
    user_id_1: str
    user_id_2: str
    is_pinned: bool = False
    is_unread: bool = False


class ConversationCreate(ConversationBase):
    pass


class ConversationInDB(ConversationBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime] = None

    model_config = {"populate_by_name": True}


class ConversationResponse(ConversationBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime] = None
    other_user_id: Optional[str] = None

    model_config = {"populate_by_name": True, "from_attributes": True}


class ConversationUpdate(BaseModel):
    last_message_at: Optional[datetime] = None
    is_pinned: Optional[bool] = None
    is_unread: Optional[bool] = None


class ConversationWithMessages(ConversationResponse):
    messages: List[MessageResponse]
