import logging
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from bson.objectid import ObjectId

from auth.firebase import get_current_user, FirebaseToken
from db.mongodb import get_contacts_collection, get_users_collection
from schemas.contact import (
    ContactCreate,
    ContactUpdate,
    ContactResponse,
    ContactWithUserInfo,
    ContactStatus,
)

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()


@router.get("/", response_model=List[ContactWithUserInfo])
async def get_contacts(current_user: FirebaseToken = Depends(get_current_user)):
    """
    Get all contacts for the current user.
    """
    contacts_collection = get_contacts_collection()
    users_collection = get_users_collection()

    # Find all accepted contacts
    cursor = contacts_collection.find(
        {"user_id": current_user.firebase_uid, "status": ContactStatus.ACCEPTED}
    )

    contacts = await cursor.to_list(length=100)

    # Enrich with user information
    result = []
    for contact in contacts:
        contact["_id"] = str(contact["_id"])

        # Get contact user info
        contact_user = await users_collection.find_one(
            {"firebase_uid": contact["contact_id"]}
        )

        if contact_user:
            # Add user info to contact
            contact["contact_email"] = contact_user["email"]
            contact["contact_display_name"] = contact_user["display_name"]
            contact["contact_avatar_url"] = contact_user.get("avatar_url")
            contact["contact_status"] = contact_user.get("status", "offline")

            result.append(contact)

    return result


@router.get("/pending", response_model=List[ContactWithUserInfo])
async def get_pending_contacts(current_user: FirebaseToken = Depends(get_current_user)):
    """
    Get all pending contact requests for the current user.
    """
    contacts_collection = get_contacts_collection()
    users_collection = get_users_collection()

    # Find pending contacts where user is the recipient
    cursor = contacts_collection.find(
        {"contact_id": current_user.firebase_uid, "status": ContactStatus.PENDING}
    )

    contacts = await cursor.to_list(length=100)

    # Enrich with user information
    result = []
    for contact in contacts:
        contact["_id"] = str(contact["_id"])

        # Get contact user info
        contact_user = await users_collection.find_one(
            {"firebase_uid": contact["user_id"]}
        )

        if contact_user:
            # Add user info to contact
            contact["contact_email"] = contact_user["email"]
            contact["contact_display_name"] = contact_user["display_name"]
            contact["contact_avatar_url"] = contact_user.get("avatar_url")
            contact["contact_status"] = contact_user.get("status", "offline")

            # Swap IDs to maintain schema consistency
            user_id = contact["user_id"]
            contact_id = contact["contact_id"]
            contact["user_id"] = contact_id
            contact["contact_id"] = user_id

            result.append(contact)

    return result


@router.get("/sent-pending", response_model=List[ContactWithUserInfo])
async def get_sent_pending_contacts(
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Get all pending contact requests sent by the current user.
    """
    contacts_collection = get_contacts_collection()
    users_collection = get_users_collection()

    # Find pending contacts where user is the sender
    cursor = contacts_collection.find(
        {"user_id": current_user.firebase_uid, "status": ContactStatus.PENDING}
    )

    contacts = await cursor.to_list(length=100)

    # Enrich with user information
    result = []
    for contact in contacts:
        contact["_id"] = str(contact["_id"])

        # Get contact user info
        contact_user = await users_collection.find_one(
            {"firebase_uid": contact["contact_id"]}
        )

        if contact_user:
            # Add user info to contact
            contact["contact_email"] = contact_user["email"]
            contact["contact_display_name"] = contact_user["display_name"]
            contact["contact_avatar_url"] = contact_user.get("avatar_url")
            contact["contact_status"] = contact_user.get("status", "offline")

            result.append(contact)

    return result


@router.post("/", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def add_contact(
    contact_create: ContactCreate,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Add a new contact or accept a pending request.
    """
    # Ensure the current user is adding the contact
    if contact_create.user_id != current_user.firebase_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User ID must match the authenticated user",
        )

    contacts_collection = get_contacts_collection()
    users_collection = get_users_collection()

    # Check if the contact exists
    contact_user = await users_collection.find_one(
        {"firebase_uid": contact_create.contact_id}
    )

    if not contact_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Contact user not found"
        )

    # Check if this user is trying to add themselves
    if contact_create.contact_id == current_user.firebase_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add yourself as a contact",
        )

    # Check if there's a pending request from the other user
    pending_request = await contacts_collection.find_one(
        {
            "user_id": contact_create.contact_id,
            "contact_id": current_user.firebase_uid,
            "status": ContactStatus.PENDING,
        }
    )

    if pending_request:
        # Accept the pending request
        now = datetime.utcnow()
        await contacts_collection.update_one(
            {"_id": pending_request["_id"]},
            {"$set": {"status": ContactStatus.ACCEPTED, "updated_at": now}},
        )

        # Also create a reciprocal contact
        new_contact = {
            "user_id": current_user.firebase_uid,
            "contact_id": contact_create.contact_id,
            "status": ContactStatus.ACCEPTED,
            "created_at": now,
            "updated_at": now,
        }

        await contacts_collection.insert_one(new_contact)

        # Get the updated contact
        updated_contact = await contacts_collection.find_one(
            {"_id": pending_request["_id"]}
        )
        updated_contact["_id"] = str(updated_contact["_id"])

        return updated_contact

    # Check if contact already exists
    existing_contact = await contacts_collection.find_one(
        {"user_id": current_user.firebase_uid, "contact_id": contact_create.contact_id}
    )

    if existing_contact:
        if existing_contact["status"] == ContactStatus.BLOCKED:
            # Unblock the contact
            now = datetime.utcnow()
            await contacts_collection.update_one(
                {"_id": existing_contact["_id"]},
                {"$set": {"status": ContactStatus.PENDING, "updated_at": now}},
            )

            existing_contact["status"] = ContactStatus.PENDING
            existing_contact["updated_at"] = now
            existing_contact["_id"] = str(existing_contact["_id"])

            return existing_contact
        else:
            # Contact already exists
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Contact already exists with status: {existing_contact['status']}",
            )

    # Create new contact request
    now = datetime.utcnow()
    new_contact = {
        "user_id": current_user.firebase_uid,
        "contact_id": contact_create.contact_id,
        "status": ContactStatus.PENDING,
        "created_at": now,
        "updated_at": now,
    }

    result = await contacts_collection.insert_one(new_contact)

    # Get the created contact
    created_contact = await contacts_collection.find_one({"_id": result.inserted_id})
    created_contact["_id"] = str(created_contact["_id"])

    return created_contact


@router.put("/{contact_id}", response_model=ContactResponse)
async def update_contact_status(
    contact_id: str,
    contact_update: ContactUpdate,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Update contact status (accept, block, etc.).
    """
    contacts_collection = get_contacts_collection()

    # Find the contact
    contact = await contacts_collection.find_one(
        {
            "_id": ObjectId(contact_id),
            "$or": [
                {"user_id": current_user.firebase_uid},
                {"contact_id": current_user.firebase_uid},
            ],
        }
    )

    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found"
        )

    now = datetime.utcnow()

    # If accepting a contact request
    if (
        contact_update.status == ContactStatus.ACCEPTED
        and contact["status"] == ContactStatus.PENDING
    ):
        if contact["contact_id"] == current_user.firebase_uid:
            # Current user is accepting a request from another user
            await contacts_collection.update_one(
                {"_id": ObjectId(contact_id)},
                {"$set": {"status": ContactStatus.ACCEPTED, "updated_at": now}},
            )

            # Create reciprocal contact
            new_contact = {
                "user_id": current_user.firebase_uid,
                "contact_id": contact["user_id"],
                "status": ContactStatus.ACCEPTED,
                "created_at": now,
                "updated_at": now,
            }

            await contacts_collection.insert_one(new_contact)
        else:
            # Can't accept your own sent request
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot accept your own contact request",
            )
    else:
        # For other status updates
        await contacts_collection.update_one(
            {"_id": ObjectId(contact_id)},
            {"$set": {"status": contact_update.status, "updated_at": now}},
        )

    # Get the updated contact
    updated_contact = await contacts_collection.find_one({"_id": ObjectId(contact_id)})
    updated_contact["_id"] = str(updated_contact["_id"])

    return updated_contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: str, current_user: FirebaseToken = Depends(get_current_user)
):
    """
    Delete a contact.
    """
    contacts_collection = get_contacts_collection()

    # Find the contact
    contact = await contacts_collection.find_one(
        {
            "_id": ObjectId(contact_id),
            "$or": [
                {"user_id": current_user.firebase_uid},
                {"contact_id": current_user.firebase_uid},
            ],
        }
    )

    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found"
        )

    # Delete the contact
    await contacts_collection.delete_one({"_id": ObjectId(contact_id)})

    # If this is an accepted contact, also delete the reciprocal contact
    if contact["status"] == ContactStatus.ACCEPTED:
        if contact["user_id"] == current_user.firebase_uid:
            other_user_id = contact["contact_id"]
        else:
            other_user_id = contact["user_id"]

        await contacts_collection.delete_one(
            {
                "user_id": other_user_id,
                "contact_id": current_user.firebase_uid,
                "status": ContactStatus.ACCEPTED,
            }
        )

    return
