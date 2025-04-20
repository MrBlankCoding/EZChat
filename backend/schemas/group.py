from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid

# Assuming user IDs are strings (like MongoDB ObjectIds)
UserId = str


class GroupMember(BaseModel):
    user_id: UserId
    role: str = "member"  # Possible values: "admin", "member"
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class GroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = ""
    avatar_url: Optional[str] = None
    is_public: bool = True


class GroupCreate(GroupBase):
    # When creating, specify initial members (creator is added automatically)
    member_ids: Optional[List[UserId]] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_public: Optional[bool] = None


# Represents the group document stored in MongoDB
class GroupInDB(GroupBase):
    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()), alias="_id"
    )  # Use UUID for group IDs
    creator_id: UserId
    members: List[GroupMember] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Add other metadata as needed, e.g., group picture URL
    # avatar_url: Optional[str] = None

    class Config:
        orm_mode = True
        allow_population_by_field_name = True
        json_encoders = {
            datetime: lambda dt: dt.isoformat(),
            # If using ObjectId directly:
            # ObjectId: str
        }


# Schema for API responses
class Group(GroupInDB):
    pass  # Inherits all fields from GroupInDB for now


class GroupMemberInfo(BaseModel):
    id: UserId
    username: str  # Assuming User schema has a username


class GroupDetails(Group):
    members_details: List[GroupMemberInfo] = []  # Include details in specific endpoints


# Schema for adding a member
class AddGroupMember(BaseModel):
    user_id: UserId
    role: str = "member"  # Default role


# Schema for updating a member's role/status
class UpdateGroupMember(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None

    class Config:
        # Ensure at least one field is provided if used for PATCH
        validate_assignment = True
        # Example validator if needed: ensure role is valid
        # @validator('role')
        # def role_must_be_valid(cls, v):
        #     if v not in ["admin", "member"]:
        #         raise ValueError('Invalid role')
        #     return v
