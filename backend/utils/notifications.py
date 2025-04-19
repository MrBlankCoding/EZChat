import os
import logging
from typing import Dict, Optional
import firebase_admin
from firebase_admin import credentials, messaging
from firebase_admin.exceptions import FirebaseError
from db.mongodb import get_users_collection

logger = logging.getLogger(__name__)

# Module-level flag to track initialization status
_firebase_initialized = False


def initialize_firebase() -> bool:
    """Initialize Firebase Admin SDK if not already initialized."""
    global _firebase_initialized

    if _firebase_initialized:
        return True

    try:
        if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            firebase_admin.initialize_app()
            logger.info(
                "Firebase Admin SDK initialized using Application Default Credentials."
            )
        else:
            # Update path to use the correct location
            default_cred_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "auth",
                "serviceAccountKey.json",
            )
            cred_path = os.getenv("FIREBASE_ADMIN_SDK_CREDENTIALS", default_cred_path)
            if os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                logger.info(
                    f"Firebase Admin SDK initialized using credentials file: {cred_path}"
                )
            else:
                logger.warning(
                    f"Firebase Admin SDK credentials file not found at {cred_path}. Push notifications disabled."
                )
                return False

        _firebase_initialized = True
        return True
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
        return False


# Initialize during module import
initialize_firebase()


async def get_user_fcm_token(user_id: str) -> Optional[str]:
    """Retrieve a user's FCM token from the database."""
    users_collection = get_users_collection()
    user = await users_collection.find_one({"firebase_uid": user_id})

    if not user or "fcm_token" not in user:
        logger.warning(f"No FCM token found for user {user_id}")
        return None

    return user["fcm_token"]


async def send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    fcm_token: Optional[str] = None,
) -> bool:
    """Send a push notification to a user."""
    if not _firebase_initialized and not initialize_firebase():
        return False

    try:
        token = fcm_token or await get_user_fcm_token(user_id)
        if not token:
            return False

        message = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            data=data or {},
            token=token,
        )

        response = messaging.send(message)
        logger.info(f"Successfully sent notification to {user_id}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send notification to {user_id}: {e}")
        return False


async def send_new_message_notification(
    recipient_id: str,
    sender_name: str,
    message_text: str,
    message_id: str,
    contact_id: str,
) -> bool:
    """Send a notification about a new message."""
    if not _firebase_initialized and not initialize_firebase():
        logger.warning(
            "Firebase Admin SDK not initialized, cannot send push notification."
        )
        return False

    try:
        token = await get_user_fcm_token(recipient_id)
        if not token:
            return False

        truncated_text = (
            (message_text[:100] + "...") if len(message_text) > 100 else message_text
        )
        display_text = truncated_text if truncated_text else "Attachment received"

        message = messaging.Message(
            notification=messaging.Notification(
                title=f"New message from {sender_name}",
                body=display_text,
            ),
            token=token,
            data={
                "type": "new_message",
                "messageId": str(message_id),
                "senderId": str(contact_id),
            },
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    click_action="FLUTTER_NOTIFICATION_CLICK",
                ),
            ),
            apns=messaging.APNSConfig(
                headers={"apns-priority": "10"},
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        alert=messaging.ApsAlert(
                            title=f"New message from {sender_name}",
                            body=display_text,
                        ),
                        sound="default",
                    )
                ),
            ),
        )

        response = messaging.send(message)
        token_prefix = token[:10] if len(token) > 10 else token
        logger.info(
            f"Successfully sent message notification to {token_prefix}...: {response}"
        )
        return True
    except FirebaseError as e:
        token_prefix = recipient_id[:10] if len(recipient_id) > 10 else recipient_id
        logger.error(
            f"Firebase error sending push notification to {token_prefix}...: {e}"
        )
        return False
    except Exception as e:
        token_prefix = recipient_id[:10] if len(recipient_id) > 10 else recipient_id
        logger.error(
            f"Generic error sending push notification to {token_prefix}...: {e}"
        )
        return False


async def send_dismiss_notification(fcm_token: str, message_id: str) -> bool:
    """Sends a silent push notification to instruct the client to dismiss a notification."""
    if not _firebase_initialized and not initialize_firebase():
        logger.warning(
            "Firebase Admin SDK not initialized, cannot send dismiss notification."
        )
        return False

    if not fcm_token:
        logger.warning(
            f"Cannot send dismiss notification for message {message_id}: No FCM token provided."
        )
        return False

    try:
        message = messaging.Message(
            data={
                "type": "dismiss_notification",
                "messageId": str(message_id),
            },
            token=fcm_token,
            android=messaging.AndroidConfig(priority="high"),
            apns=messaging.APNSConfig(
                headers={"apns-priority": "5"},
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(content_available=True)
                ),
            ),
        )

        response = messaging.send(message)
        token_prefix = fcm_token[:10] if len(fcm_token) > 10 else fcm_token
        logger.info(
            f"Successfully sent dismiss notification for message {message_id} to {token_prefix}...: {response}"
        )
        return True
    except Exception as e:
        token_prefix = fcm_token[:10] if len(fcm_token) > 10 else fcm_token
        logger.error(
            f"Generic error sending dismiss notification for message {message_id} to {token_prefix}...: {e}"
        )
        return False
