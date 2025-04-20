import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)

# MongoDB connection string and database name
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "ezchat")

# MongoDB connection pool settings
MAX_POOL_SIZE = int(os.getenv("MONGODB_MAX_POOL_SIZE", "100"))
MIN_POOL_SIZE = int(os.getenv("MONGODB_MIN_POOL_SIZE", "10"))
MAX_IDLE_TIME_MS = int(os.getenv("MONGODB_MAX_IDLE_TIME_MS", "60000"))
SOCKET_TIMEOUT_MS = int(os.getenv("MONGODB_SOCKET_TIMEOUT_MS", "5000"))
CONNECT_TIMEOUT_MS = int(os.getenv("MONGODB_CONNECT_TIMEOUT_MS", "5000"))
SERVER_SELECTION_TIMEOUT_MS = int(
    os.getenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "5000")
)

# MongoDB client and database objects
client: AsyncIOMotorClient = None
db = None


async def connect_to_mongodb():
    """
    Connect to MongoDB and verify the connection.
    """
    global client, db

    logger.info("Connecting to MongoDB...")
    try:
        client = AsyncIOMotorClient(
            MONGODB_URI,
            maxPoolSize=MAX_POOL_SIZE,
            minPoolSize=MIN_POOL_SIZE,
            maxIdleTimeMS=MAX_IDLE_TIME_MS,
            socketTimeoutMS=SOCKET_TIMEOUT_MS,
            connectTimeoutMS=CONNECT_TIMEOUT_MS,
            serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS,
            retryWrites=True,
            retryReads=True,
        )
        # Verify the connection
        await client.admin.command("ping")

        db = client[MONGODB_DB_NAME]
        logger.info(f"Connected to MongoDB: {MONGODB_URI}, database: {MONGODB_DB_NAME}")

        # Create indexes for efficient querying
        await create_indexes()
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        raise


async def create_indexes():
    """
    Create indexes for efficient querying.
    """
    try:
        # Create indexes for messages collection
        messages_collection = get_messages_collection()
        await messages_collection.create_index("conversation_id")
        await messages_collection.create_index("sender_id")
        await messages_collection.create_index("recipient_id")
        await messages_collection.create_index("group_id")
        await messages_collection.create_index("created_at")
        await messages_collection.create_index(
            [("conversation_id", 1), ("created_at", -1)]
        )
        await messages_collection.create_index([("group_id", 1), ("created_at", -1)])

        # Index for replies
        await messages_collection.create_index("reply_to")

        # Indexes for edited/deleted messages
        await messages_collection.create_index("is_edited")
        await messages_collection.create_index("is_deleted")

        # Indexes for users collection
        users_collection = get_users_collection()
        await users_collection.create_index("username", unique=True)
        await users_collection.create_index("email", unique=True)

        # Indexes for groups collection
        groups_collection = get_groups_collection()
        await groups_collection.create_index("creator_id")
        await groups_collection.create_index("members.user_id")
        await groups_collection.create_index("created_at")

        logger.info("MongoDB indexes created successfully")
    except Exception as e:
        logger.error(f"Failed to create MongoDB indexes: {e}")


async def close_mongodb_connection():
    """
    Close the MongoDB connection.
    """
    global client

    if client:
        logger.info("Closing MongoDB connection...")
        client.close()
        logger.info("MongoDB connection closed")


def get_database():
    """
    Get the database instance.
    """
    if db is None:
        raise Exception("Database connection not initialized")
    return db


# Collection references
def get_users_collection():
    """
    Get the users collection.
    """
    return get_database().users


def get_conversations_collection():
    """
    Get the conversations collection.
    """
    return get_database().conversations


def get_messages_collection():
    """
    Get the messages collection.
    """
    return get_database().messages


def get_contacts_collection():
    """
    Get the contacts collection.
    """
    return get_database().contacts


def get_groups_collection():
    """
    Get the groups collection.
    """
    return get_database().groups


# --- Group CRUD Operations ---
from schemas.group import GroupInDB, GroupCreate, GroupUpdate, GroupMember
from schemas.user import UserInDB  # Corrected schema name
from typing import List, Optional
from bson import ObjectId  # Import if using ObjectIds directly
from datetime import datetime


async def create_group(
    group_data: GroupCreate,
    creator_id: str,
    initial_member_ids: Optional[List[str]] = None,  # Add the new parameter
) -> Optional[GroupInDB]:
    """Creates a new group in the database."""
    groups_collection = get_groups_collection()
    now = datetime.utcnow()

    # Prepare creator as the first member
    creator_member = GroupMember(user_id=creator_id)
    initial_members = [creator_member]

    # Add other initial members passed from the API layer
    if initial_member_ids:
        for member_id in initial_member_ids:
            if member_id != creator_id:  # Avoid adding creator twice
                # TODO: Validate if member_id exists in the users collection
                initial_members.append(GroupMember(user_id=member_id))

    # Create the GroupInDB object
    new_group = GroupInDB(
        **group_data.dict(
            exclude={"member_ids"}
        ),  # Exclude member_ids from direct mapping
        creator_id=creator_id,
        members=initial_members,
        created_at=now,
        # Use default _id generated by GroupInDB schema
    )

    try:
        # Use model_dump(by_alias=True) if using Pydantic v2
        insert_result = await groups_collection.insert_one(
            new_group.dict(by_alias=True)
        )
        if insert_result.inserted_id:
            # Fetch the created group to return it
            created_group_doc = await groups_collection.find_one({"_id": new_group.id})
            if created_group_doc:
                return GroupInDB(**created_group_doc)
        return None
    except Exception as e:
        logger.error(f"Error creating group: {e}")
        return None


async def get_group_by_id(group_id: str) -> Optional[GroupInDB]:
    """Fetches a group by its ID."""
    groups_collection = get_groups_collection()
    try:
        group_doc = await groups_collection.find_one({"_id": group_id})
        if group_doc:
            return GroupInDB(**group_doc)
        return None
    except Exception as e:
        logger.error(f"Error fetching group {group_id}: {e}")
        return None


async def get_user_groups(user_id: str) -> List[GroupInDB]:
    """Fetches all groups a user is a member of."""
    groups_collection = get_groups_collection()
    groups = []
    try:
        cursor = groups_collection.find({"members.user_id": user_id})
        async for group_doc in cursor:
            logger.debug(f"Raw group doc from DB for user {user_id}: {group_doc}")
            try:
                groups.append(GroupInDB(**group_doc))
            except Exception as parse_error:
                logger.error(
                    f"Error parsing group doc (ID: {group_doc.get('_id')}) into GroupInDB: {parse_error}"
                )
        return groups
    except Exception as e:
        logger.error(f"Error fetching groups for user {user_id}: {e}")
        return []


async def update_group(group_id: str, update_data: GroupUpdate) -> Optional[GroupInDB]:
    """Updates group details (e.g., name)."""
    groups_collection = get_groups_collection()
    # Prepare update document, excluding None values
    update_doc = {k: v for k, v in update_data.dict().items() if v is not None}

    if not update_doc:
        # No fields to update
        return await get_group_by_id(group_id)

    try:
        result = await groups_collection.update_one(
            {"_id": group_id}, {"$set": update_doc}
        )
        if result.matched_count > 0:
            return await get_group_by_id(group_id)
        return None  # Group not found
    except Exception as e:
        logger.error(f"Error updating group {group_id}: {e}")
        return None


async def add_member_to_group(group_id: str, user_id_to_add: str) -> bool:
    """Adds a user to the group's member list."""
    groups_collection = get_groups_collection()
    # TODO: Add check if user exists before adding?
    new_member = GroupMember(user_id=user_id_to_add)
    try:
        result = await groups_collection.update_one(
            {
                "_id": group_id,
                "members.user_id": {"$ne": user_id_to_add},
            },  # Prevent duplicates
            {"$push": {"members": new_member.dict()}},
        )
        return result.modified_count > 0
    except Exception as e:
        logger.error(f"Error adding member {user_id_to_add} to group {group_id}: {e}")
        return False


async def remove_member_from_group(group_id: str, user_id_to_remove: str) -> bool:
    """Removes a user from the group's member list."""
    groups_collection = get_groups_collection()
    # TODO: Prevent creator from being removed? Or handle group deletion?
    try:
        result = await groups_collection.update_one(
            {"_id": group_id}, {"$pull": {"members": {"user_id": user_id_to_remove}}}
        )
        return result.modified_count > 0
    except Exception as e:
        logger.error(
            f"Error removing member {user_id_to_remove} from group {group_id}: {e}"
        )
        return False


async def is_user_group_member(group_id: str, user_id: str) -> bool:
    """Checks if a user is a member of a specific group."""
    groups_collection = get_groups_collection()
    try:
        count = await groups_collection.count_documents(
            {"_id": group_id, "members.user_id": user_id}
        )
        return count > 0
    except Exception as e:
        logger.error(
            f"Error checking membership for user {user_id} in group {group_id}: {e}"
        )
        return False


async def get_group_members(group_id: str) -> List[GroupMember]:
    """Fetches the list of members for a specific group."""
    group = await get_group_by_id(group_id)
    if group:
        return group.members
    return []


async def delete_group(group_id: str) -> bool:
    """Deletes a group by its ID."""
    groups_collection = get_groups_collection()
    try:
        result = await groups_collection.delete_one({"_id": group_id})
        # TODO: Optionally delete associated group messages?
        return result.deleted_count > 0
    except Exception as e:
        logger.error(f"Error deleting group {group_id}: {e}")
        return False


# --- User Helper Functions ---


async def get_users_by_ids(user_ids: List[str]) -> List[UserInDB]:
    """Fetches multiple users by their IDs."""
    users_collection = get_users_collection()
    users = []
    try:
        cursor = users_collection.find({"_id": {"$in": user_ids}})

        async for user_doc in cursor:
            # Ensure all necessary fields are present before creating UserInDB
            # For simplicity, we assume the document matches the schema
            users.append(UserInDB(**user_doc))
        return users
    except Exception as e:
        logger.error(f"Error fetching users by IDs: {user_ids} - {e}")
        return []


# --- Message Helper Functions ---
from schemas.message import MessageInDB  # Import schema if not already done


async def get_group_messages(
    group_id: str, limit: int = 50, skip: int = 0
) -> List[MessageInDB]:
    """Fetches messages for a specific group, ordered by creation time."""
    messages_collection = get_messages_collection()
    messages = []
    try:
        cursor = (
            messages_collection.find(
                {
                    "group_id": group_id,
                    "is_deleted": {"$ne": True},  # Exclude deleted messages
                }
            )
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )

        async for msg_doc in cursor:
            messages.append(MessageInDB(**msg_doc))

        return messages[::-1]  # Return in chronological order (oldest first)
    except Exception as e:
        logger.error(f"Error fetching messages for group {group_id}: {e}")
        return []


# You might also need functions to fetch group messages:
# async def get_group_messages(group_id: str, limit: int = 50, skip: int = 0) -> List[MessageInDB]:
#     messages_collection = get_messages_collection()
#     cursor = messages_collection.find({"group_id": group_id}).sort("created_at", -1).skip(skip).limit(limit)
#     messages = []
#     async for msg_doc in cursor:
#         messages.append(MessageInDB(**msg_doc))
#     return messages[::-1] # Return in chronological order
