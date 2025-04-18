import logging
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.middleware.cors import CORSMiddleware
from bson.objectid import ObjectId
from pydantic import BaseModel

from auth.firebase import get_current_user, FirebaseToken
from db.mongodb import get_users_collection
from schemas.user import UserCreate, UserUpdate, UserResponse, UserProfile

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()


@router.get("/profile", response_model=UserProfile)
async def get_user_profile(current_user: FirebaseToken = Depends(get_current_user)):
    """
    Get the profile of the currently authenticated user.
    """
    users_collection = get_users_collection()
    user = await users_collection.find_one({"firebase_uid": current_user.firebase_uid})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Convert ObjectId to string
    user["_id"] = str(user["_id"])

    # Update last seen timestamp
    await users_collection.update_one(
        {"_id": ObjectId(user["_id"])}, {"$set": {"last_seen": datetime.utcnow()}}
    )

    return user


@router.put("/profile", response_model=UserResponse)
async def update_user_profile(
    user_update: UserUpdate, current_user: FirebaseToken = Depends(get_current_user)
):
    """
    Update the profile of the currently authenticated user.
    """
    users_collection = get_users_collection()

    # Get the current user
    user = await users_collection.find_one({"firebase_uid": current_user.firebase_uid})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Prepare update data, only including fields that were provided
    update_data = {k: v for k, v in user_update.dict(exclude_unset=True).items()}

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="No valid fields to update"
        )

    # Add updated_at timestamp
    update_data["updated_at"] = datetime.utcnow()

    # Update the user
    await users_collection.update_one(
        {"firebase_uid": current_user.firebase_uid}, {"$set": update_data}
    )

    # Get the updated user
    updated_user = await users_collection.find_one(
        {"firebase_uid": current_user.firebase_uid}
    )
    updated_user["_id"] = str(updated_user["_id"])

    return updated_user


@router.post(
    "/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
async def register_user(
    user_create: UserCreate, current_user: FirebaseToken = Depends(get_current_user)
):
    """
    Register a new user after Firebase authentication.
    """
    try:
        logger.info(f"Attempting to register user with email: {user_create.email}")

        # Validate that Firebase UID matches
        if user_create.firebase_uid != current_user.firebase_uid:
            logger.warning(
                f"Firebase UID mismatch: {user_create.firebase_uid} vs {current_user.firebase_uid}"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Firebase UID mismatch"
            )

        users_collection = get_users_collection()

        # Check if user already exists
        existing_user = await users_collection.find_one(
            {"firebase_uid": current_user.firebase_uid}
        )

        if existing_user:
            logger.info(f"User already registered: {current_user.firebase_uid}")
            # Instead of error, return the existing user
            existing_user["_id"] = str(existing_user["_id"])
            return existing_user

        # Create new user
        now = datetime.utcnow()
        new_user = {
            "firebase_uid": user_create.firebase_uid,
            "email": user_create.email,
            "display_name": user_create.display_name,
            "avatar_url": user_create.avatar_url,
            "status": user_create.status,
            "created_at": now,
            "updated_at": now,
            "last_seen": now,
        }

        logger.info(f"Creating new user: {user_create.email}")
        result = await users_collection.insert_one(new_user)

        # Get the created user
        created_user = await users_collection.find_one({"_id": result.inserted_id})
        created_user["_id"] = str(created_user["_id"])
        logger.info(f"User registered successfully: {created_user['_id']}")

        return created_user
    except Exception as e:
        logger.error(f"Error in user registration: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {str(e)}",
        )


# Handle preflight CORS requests
@router.options("/search")
async def options_search(response: Response):
    """
    Handle preflight CORS requests for the search endpoint.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return {}


@router.get("/search", response_model=List[UserProfile])
async def search_users(
    query: str,
    current_user: FirebaseToken = Depends(get_current_user),
    response: Response = None,
):
    """
    Search for users by email or display name.
    """
    # Set CORS headers explicitly for this endpoint
    if response:
        response.headers["Access-Control-Allow-Origin"] = "*"

    users_collection = get_users_collection()

    # Simple search by email or display name
    cursor = users_collection.find(
        {
            "$or": [
                {"email": {"$regex": query, "$options": "i"}},
                {"display_name": {"$regex": query, "$options": "i"}},
            ],
            "firebase_uid": {
                "$ne": current_user.firebase_uid
            },  # Exclude the current user
        }
    )

    users = await cursor.to_list(length=10)  # Limit to 10 results

    # Create proper UserProfile models from the MongoDB documents
    result_profiles = []
    for user in users:
        # Convert ObjectId to string and ensure it's in the right field
        user_id = str(user["_id"])
        user["_id"] = user_id  # Keep _id for alias mapping
        result_profiles.append(UserProfile(**user))

    return result_profiles


class FCMTokenData(BaseModel):
    token: str


@router.post("/fcm-token")
async def register_fcm_token(
    token_data: FCMTokenData, current_user: FirebaseToken = Depends(get_current_user)
):
    """
    Register the FCM token for the current user.
    This token will be used to send push notifications to the user.
    """
    users_collection = get_users_collection()

    try:
        # Update the user's FCM token in the database
        await users_collection.update_one(
            {"firebase_uid": current_user.firebase_uid},
            {"$set": {"fcm_token": token_data.token, "updated_at": datetime.utcnow()}},
        )
        return {"status": "success", "message": "FCM token registered successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register FCM token: {str(e)}",
        )
