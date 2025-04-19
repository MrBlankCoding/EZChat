import logging
from fastapi import Depends, HTTPException, status

# Import user model
from schemas.user import UserInDB
from db.mongodb import get_users_collection
from auth.firebase import get_current_user, FirebaseToken

# Configure logging
logger = logging.getLogger(__name__)


async def get_current_active_user(
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Dependency that returns the current active user from the database.
    This extends the Firebase authentication by also checking if the user exists in our database.
    """
    users_collection = get_users_collection()
    user = await users_collection.find_one({"firebase_uid": current_user.firebase_uid})

    if not user:
        logger.warning(
            f"User with Firebase UID {current_user.firebase_uid} not found in database"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in database. Please register first.",
        )

    # Convert ObjectId to string
    user["id"] = str(user["_id"])

    return UserInDB(**user)
