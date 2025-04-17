from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
from enum import Enum


class UserStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    AWAY = "away"


class UserBase(BaseModel):
    email: EmailStr
    display_name: str
    status: UserStatus = UserStatus.OFFLINE
    avatar_url: Optional[str] = None


class UserCreate(UserBase):
    firebase_uid: str


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    status: Optional[UserStatus] = None
    avatar_url: Optional[str] = None


class UserInDB(UserBase):
    id: str = Field(..., alias="_id")
    firebase_uid: str
    created_at: datetime
    updated_at: datetime
    last_seen: Optional[datetime] = None

    model_config = {"populate_by_name": True}


class UserResponse(UserBase):
    id: str = Field(..., alias="_id")
    created_at: datetime
    updated_at: datetime
    last_seen: Optional[datetime] = None

    model_config = {"populate_by_name": True, "from_attributes": True}


class UserProfile(BaseModel):
    id: str = Field(..., alias="_id")
    email: EmailStr
    display_name: str
    status: UserStatus
    avatar_url: Optional[str] = None
    last_seen: Optional[datetime] = None
    firebase_uid: str

    model_config = {"populate_by_name": True, "from_attributes": True}
