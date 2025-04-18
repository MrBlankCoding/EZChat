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
        await messages_collection.create_index("created_at")
        await messages_collection.create_index(
            [("conversation_id", 1), ("created_at", -1)]
        )

        # Index for reactions
        await messages_collection.create_index([("reactions.user_id", 1), ("_id", 1)])

        # Index for replies
        await messages_collection.create_index("reply_to")

        # Indexes for edited/deleted messages
        await messages_collection.create_index("is_edited")
        await messages_collection.create_index("is_deleted")

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
