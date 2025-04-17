import os
import logging
import firebase_admin
from firebase_admin import credentials, auth
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from functools import lru_cache

# Load environment variables
load_dotenv()

# Configure logging
logger = logging.getLogger(__name__)

# Path to service account key file
SERVICE_ACCOUNT_PATH = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT_PATH", "auth/serviceAccountKey.json"
)

# Initialize Firebase Admin SDK
try:
    # Check if already initialized
    firebase_admin.get_app()
except ValueError:
    try:
        # Initialize with service account
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(
            cred, {"storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET")}
        )
        logger.info("Firebase Admin SDK initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing Firebase Admin SDK: {e}")
        # Continue with a dummy initialization if in development mode
        if os.getenv("DEBUG", "False").lower() == "true":
            logger.warning("Using dummy Firebase initialization for development")
            firebase_admin.initialize_app()
        else:
            raise

# Setup bearer token authentication
bearer_scheme = HTTPBearer()


class FirebaseToken:
    """
    Firebase ID token model that handles verification and extraction of user data.
    """

    def __init__(self, token: str):
        self.token = token
        self.decoded_token = None
        self.firebase_uid = None
        self.email = None
        self.verified = False

    async def verify(self):
        """
        Verify the Firebase ID token.
        """
        try:
            # Verify the token
            self.decoded_token = auth.verify_id_token(self.token)

            # Extract user data
            self.firebase_uid = self.decoded_token["uid"]
            self.email = self.decoded_token.get("email")
            self.verified = True

            return self
        except Exception as e:
            logger.error(f"Error verifying Firebase token: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> FirebaseToken:
    """
    Dependency that returns the current authenticated user.
    """
    token = FirebaseToken(credentials.credentials)
    await token.verify()
    return token


@lru_cache(maxsize=128)
def get_firebase_user(firebase_uid: str):
    """
    Get a Firebase user by UID.
    Uses LRU cache to reduce API calls.
    """
    try:
        return auth.get_user(firebase_uid)
    except Exception as e:
        logger.error(f"Error getting Firebase user {firebase_uid}: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User not found: {firebase_uid}",
        )
