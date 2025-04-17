from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class ContactStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"


class ContactBase(BaseModel):
    user_id: str
    contact_id: str
    status: ContactStatus = ContactStatus.PENDING


class ContactCreate(ContactBase):
    pass


class ContactInDB(ContactBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


class ContactResponse(ContactBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class ContactUpdate(BaseModel):
    status: ContactStatus


class ContactWithUserInfo(ContactResponse):
    contact_email: str
    contact_display_name: str
    contact_avatar_url: Optional[str] = None
    contact_status: str
