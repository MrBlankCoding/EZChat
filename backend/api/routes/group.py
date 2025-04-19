from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from datetime import datetime
from pymongo.collection import Collection
from bson import ObjectId
from pymongo import ReturnDocument

from db.mongodb import get_database
from schemas import (
    GroupCreate,
    Group,
    GroupUpdate,
    GroupMember,
    GroupDetails,
    AddGroupMember,
    UpdateGroupMember,
    UserResponse,
    MessageResponse,
)
from auth.firebase import get_current_user
from websocket.manager import manager

router = APIRouter()


@router.post("/", response_model=Group, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_data: GroupCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    users_collection: Collection = db["users"]

    # Include creator and deduplicate member list
    member_ids = list(set([current_user.id] + group_data.members))

    # Validate members exist
    members_count = await users_collection.count_documents(
        {"_id": {"$in": [ObjectId(user_id) for user_id in member_ids]}}
    )
    if members_count != len(member_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="One or more members do not exist",
        )

    # Create member objects, with creator as admin
    now = datetime.utcnow()
    group_members = [
        GroupMember(
            user_id=user_id,
            role="admin" if user_id == current_user.id else "member",
            joined_at=now,
            is_active=True,
        ).dict()
        for user_id in member_ids
    ]

    # Create new group
    new_group = {
        "_id": str(ObjectId()),
        "name": group_data.name,
        "description": group_data.description,
        "avatar_url": group_data.avatar_url,
        "is_public": group_data.is_public,
        "creator_id": current_user.id,
        "members": group_members,
        "created_at": now,
        "updated_at": now,
        "last_message_at": None,
    }

    await groups_collection.insert_one(new_group)
    new_group["member_count"] = len(member_ids)

    # Notify members
    for member_id in member_ids:
        await manager.send_json_to_user(
            member_id, {"type": "group_created", "payload": new_group}
        )

    return new_group


@router.get("/", response_model=List[Group])
async def get_user_groups(
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    cursor = groups_collection.find(
        {"members.user_id": current_user.id, "members.is_active": True}
    )

    groups = []
    async for group in cursor:
        group["member_count"] = len([m for m in group["members"] if m["is_active"]])
        groups.append(group)

    return groups


@router.get("/{group_id}", response_model=GroupDetails)
async def get_group(
    group_id: str,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    users_collection: Collection = db["users"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify current user is active member
    if not any(
        m["user_id"] == current_user.id and m["is_active"] for m in group["members"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this group",
        )

    # Get active member details
    active_member_ids = [m["user_id"] for m in group["members"] if m["is_active"]]

    cursor = users_collection.find(
        {"_id": {"$in": [ObjectId(user_id) for user_id in active_member_ids]}}
    )

    members_details = []
    async for user in cursor:
        user["_id"] = str(user["_id"])
        members_details.append(user)

    group["member_count"] = len(active_member_ids)
    group["members_details"] = members_details

    return group


@router.put("/{group_id}", response_model=Group)
async def update_group(
    group_id: str,
    group_data: GroupUpdate,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify current user is admin
    if not any(
        m["user_id"] == current_user.id and m["role"] == "admin" and m["is_active"]
        for m in group["members"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group admins can update group details",
        )

    # Update only provided fields
    update_data = {k: v for k, v in group_data.dict(exclude_unset=True).items()}
    update_data["updated_at"] = datetime.utcnow()

    updated_group = await groups_collection.find_one_and_update(
        {"_id": group_id}, {"$set": update_data}, return_document=ReturnDocument.AFTER
    )

    updated_group["member_count"] = len(
        [m for m in updated_group["members"] if m["is_active"]]
    )

    # Notify active members
    active_member_ids = [
        m["user_id"] for m in updated_group["members"] if m["is_active"]
    ]
    for member_id in active_member_ids:
        await manager.send_json_to_user(
            member_id, {"type": "group_updated", "payload": updated_group}
        )

    return updated_group


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: str,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    messages_collection: Collection = db["messages"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify user is creator or admin
    is_admin = any(
        m["user_id"] == current_user.id and m["role"] == "admin" and m["is_active"]
        for m in group["members"]
    )

    if not is_admin and group["creator_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group creator or admins can delete the group",
        )

    # Delete group and associated messages
    await groups_collection.delete_one({"_id": group_id})
    await messages_collection.delete_many({"group_id": group_id})

    # Notify active members
    active_member_ids = [m["user_id"] for m in group["members"] if m["is_active"]]
    for member_id in active_member_ids:
        await manager.send_json_to_user(
            member_id, {"type": "group_deleted", "payload": {"group_id": group_id}}
        )

    return None


@router.post("/{group_id}/members", response_model=Group)
async def add_group_member(
    group_id: str,
    member_data: AddGroupMember,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    users_collection: Collection = db["users"]

    # Verify user exists
    if not await users_collection.find_one({"_id": ObjectId(member_data.user_id)}):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify current user is admin
    if not any(
        m["user_id"] == current_user.id and m["role"] == "admin" and m["is_active"]
        for m in group["members"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group admins can add members",
        )

    # Check if user is already a member or needs reactivation
    for member in group["members"]:
        if member["user_id"] == member_data.user_id:
            if member["is_active"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User is already a member of this group",
                )
            else:
                # Reactivate member
                await groups_collection.update_one(
                    {"_id": group_id, "members.user_id": member_data.user_id},
                    {
                        "$set": {
                            "members.$.is_active": True,
                            "members.$.role": member_data.role,
                        }
                    },
                )
                break
    else:
        # Add new member
        new_member = GroupMember(
            user_id=member_data.user_id,
            role=member_data.role,
            joined_at=datetime.utcnow(),
            is_active=True,
        ).dict()

        await groups_collection.update_one(
            {"_id": group_id}, {"$push": {"members": new_member}}
        )

    # Get updated group
    updated_group = await groups_collection.find_one({"_id": group_id})
    updated_group["member_count"] = len(
        [m for m in updated_group["members"] if m["is_active"]]
    )

    # Notify active members
    active_member_ids = [
        m["user_id"] for m in updated_group["members"] if m["is_active"]
    ]
    notification = {
        "type": "group_member_added",
        "payload": {
            "group_id": group_id,
            "group": updated_group,
            "added_member": member_data.user_id,
        },
    }

    for member_id in active_member_ids:
        await manager.send_json_to_user(member_id, notification)

    return updated_group


@router.delete("/{group_id}/members/{user_id}", response_model=Group)
async def remove_group_member(
    group_id: str,
    user_id: str,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Get member roles
    is_admin = False
    user_is_member = False

    for member in group["members"]:
        if member["user_id"] == current_user.id and member["is_active"]:
            user_is_member = True
            if member["role"] == "admin":
                is_admin = True

    # Check permissions - users can remove themselves, admins can remove others
    if not user_is_member or (user_id != current_user.id and not is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to remove this member",
        )

    # Verify target user is a member
    target_member = next(
        (m for m in group["members"] if m["user_id"] == user_id and m["is_active"]),
        None,
    )
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not a member of this group",
        )

    # Don't allow removing last admin
    if user_id != current_user.id:  # Skip if removing self
        admin_count = sum(
            1 for m in group["members"] if m["role"] == "admin" and m["is_active"]
        )
        is_target_admin = target_member["role"] == "admin"

        if admin_count == 1 and is_target_admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the last admin. Promote another member to admin first.",
            )

    # Deactivate member
    await groups_collection.update_one(
        {"_id": group_id, "members.user_id": user_id},
        {"$set": {"members.$.is_active": False}},
    )

    # Get updated group
    updated_group = await groups_collection.find_one({"_id": group_id})
    updated_group["member_count"] = len(
        [m for m in updated_group["members"] if m["is_active"]]
    )

    # Notify remaining members
    active_member_ids = [
        m["user_id"] for m in updated_group["members"] if m["is_active"]
    ]
    notification = {
        "type": "group_member_removed",
        "payload": {
            "group_id": group_id,
            "group": updated_group,
            "removed_member": user_id,
        },
    }

    for member_id in active_member_ids:
        await manager.send_json_to_user(member_id, notification)

    # Notify removed member
    await manager.send_json_to_user(
        user_id,
        {
            "type": "group_member_removed",
            "payload": {"group_id": group_id, "removed_member": user_id},
        },
    )

    return updated_group


@router.patch("/{group_id}/members/{user_id}", response_model=Group)
async def update_group_member_role(
    group_id: str,
    user_id: str,
    member_data: UpdateGroupMember,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify current user is admin
    if not any(
        m["user_id"] == current_user.id and m["role"] == "admin" and m["is_active"]
        for m in group["members"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only group admins can update member roles",
        )

    # Verify target user is member
    target_member = next(
        (m for m in group["members"] if m["user_id"] == user_id and m["is_active"]),
        None,
    )
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User is not a member of this group",
        )

    # Check when demoting admin to ensure not the last admin
    if member_data.role == "member" and target_member["role"] == "admin":
        admin_count = sum(
            1 for m in group["members"] if m["role"] == "admin" and m["is_active"]
        )

        if admin_count == 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last admin. Promote another member to admin first.",
            )

    # Update member fields that were provided
    update_data = {}
    if member_data.role is not None:
        update_data["members.$.role"] = member_data.role
    if member_data.is_active is not None:
        update_data["members.$.is_active"] = member_data.is_active

    if update_data:
        await groups_collection.update_one(
            {"_id": group_id, "members.user_id": user_id}, {"$set": update_data}
        )

    # Get updated group
    updated_group = await groups_collection.find_one({"_id": group_id})
    updated_group["member_count"] = len(
        [m for m in updated_group["members"] if m["is_active"]]
    )

    # Notify active members
    active_member_ids = [
        m["user_id"] for m in updated_group["members"] if m["is_active"]
    ]
    notification = {
        "type": "group_member_updated",
        "payload": {
            "group_id": group_id,
            "group": updated_group,
            "updated_member": user_id,
        },
    }

    for member_id in active_member_ids:
        await manager.send_json_to_user(member_id, notification)

    return updated_group


@router.get("/{group_id}/messages", response_model=List[MessageResponse])
async def get_group_messages(
    group_id: str,
    before: Optional[datetime] = None,
    limit: int = 50,
    current_user: UserResponse = Depends(get_current_user),
    db: dict = Depends(get_database),
):
    groups_collection: Collection = db["groups"]
    messages_collection: Collection = db["messages"]

    group = await groups_collection.find_one({"_id": group_id})
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Verify current user is member
    if not any(
        m["user_id"] == current_user.id and m["is_active"] for m in group["members"]
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this group",
        )

    # Build query
    query = {"group_id": group_id}
    if before:
        query["created_at"] = {"$lt": before}

    # Get messages in chronological order
    cursor = messages_collection.find(query).sort("created_at", -1).limit(limit)
    messages = await cursor.to_list(length=limit)
    messages.sort(key=lambda x: x["created_at"])  # Sort chronologically

    return messages
