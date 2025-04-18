import os
import json
import logging
from typing import Dict, Any, Optional, List, Union
import firebase_admin
from firebase_admin import credentials, messaging
from datetime import datetime
from pathlib import Path

# Set up logging
logger = logging.getLogger(__name__)


# Initialize Firebase Admin SDK
def initialize_firebase():
    """Initialize Firebase Admin SDK if not already initialized."""
    try:
        if not firebase_admin._apps:
            # Get the service account key from environment variable
            firebase_service_account = os.getenv("FIREBASE_SERVICE_ACCOUNT")

            # Get the project root directory
            project_root = Path(__file__).parent.parent

            if firebase_service_account:
                # If it's provided as a JSON string
                try:
                    cred_dict = json.loads(firebase_service_account)
                    cred = credentials.Certificate(cred_dict)
                except json.JSONDecodeError:
                    # If it's provided as a file path
                    service_account_path = project_root / firebase_service_account
                    cred = credentials.Certificate(str(service_account_path))
            else:
                # Fall back to Application Default Credentials
                cred = credentials.ApplicationDefault()

            firebase_admin.initialize_app(cred)
            logger.info("Firebase Admin SDK initialized")
        return True
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
        return False


# Send a notification to a specific user
async def send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    fcm_token: Optional[str] = None,
) -> bool:
    """
    Send a push notification to a user.

    Args:
        user_id: The user ID to send the notification to
        title: The notification title
        body: The notification body
        data: Additional data to include in the notification
        fcm_token: Optional FCM token to use instead of looking up the user's token

    Returns:
        bool: True if the notification was sent successfully, False otherwise
    """
    try:
        # Initialize Firebase Admin SDK if needed
        if not initialize_firebase():
            return False

        # If no FCM token is provided, look it up from the database
        if not fcm_token:
            from db.mongodb import get_users_collection

            users_collection = get_users_collection()
            user = await users_collection.find_one({"firebase_uid": user_id})

            if not user or "fcm_token" not in user:
                logger.warning(f"No FCM token found for user {user_id}")
                return False

            fcm_token = user["fcm_token"]

        # Create message
        message = messaging.Message(
            notification=messaging.Notification(
                title=title,
                body=body,
            ),
            data=data or {},
            token=fcm_token,
        )

        # Send message
        response = messaging.send(message)
        logger.info(f"Successfully sent notification to {user_id}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send notification to {user_id}: {e}")
        return False


# Send a notification about a new message
async def send_new_message_notification(
    recipient_id: str,
    sender_name: str,
    message_text: str,
    message_id: str,
    contact_id: str,
) -> bool:
    """
    Send a notification about a new message.

    Args:
        recipient_id: The user ID to send the notification to
        sender_name: The name of the sender
        message_text: The message text (truncated if needed)
        message_id: The message ID
        contact_id: The contact ID (sender ID)

    Returns:
        bool: True if the notification was sent successfully, False otherwise
    """
    # Truncate message text if it's too long
    truncated_text = message_text
    if len(truncated_text) > 100:
        truncated_text = f"{truncated_text[:97]}..."

    # Create message data
    data = {
        "messageId": message_id,
        "contactId": contact_id,
        "type": "new_message",
        "timestamp": str(int(datetime.now().timestamp())),
    }

    # Send notification
    return await send_push_notification(
        recipient_id, f"New message from {sender_name}", truncated_text, data
    )
