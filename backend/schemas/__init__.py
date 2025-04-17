from .user import (
    UserBase,
    UserCreate,
    UserUpdate,
    UserInDB,
    UserResponse,
    UserProfile,
    UserStatus,
)
from .message import (
    MessageBase,
    MessageCreate,
    MessageInDB,
    MessageResponse,
    MessageUpdate,
    MessageStatus,
    Attachment,
    AttachmentType,
)
from .conversation import (
    ConversationBase,
    ConversationCreate,
    ConversationInDB,
    ConversationResponse,
    ConversationUpdate,
    ConversationWithMessages,
)
from .contact import (
    ContactBase,
    ContactCreate,
    ContactInDB,
    ContactResponse,
    ContactUpdate,
    ContactStatus,
    ContactWithUserInfo,
)

# Export all schemas
__all__ = [
    # User schemas
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserInDB",
    "UserResponse",
    "UserProfile",
    "UserStatus",
    # Message schemas
    "MessageBase",
    "MessageCreate",
    "MessageInDB",
    "MessageResponse",
    "MessageUpdate",
    "MessageStatus",
    "Attachment",
    "AttachmentType",
    # Conversation schemas
    "ConversationBase",
    "ConversationCreate",
    "ConversationInDB",
    "ConversationResponse",
    "ConversationUpdate",
    "ConversationWithMessages",
    # Contact schemas
    "ContactBase",
    "ContactCreate",
    "ContactInDB",
    "ContactResponse",
    "ContactUpdate",
    "ContactStatus",
    "ContactWithUserInfo",
]
