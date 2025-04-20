from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional

from schemas.group import Group, GroupCreate, GroupUpdate, GroupMemberInfo, GroupDetails
from schemas.message import MessageResponse
from db import mongodb as db
from auth.dependencies import get_current_active_user
from schemas.user import UserInDB

router = APIRouter(
    prefix="/groups",
    tags=["Groups"],
    dependencies=[Depends(get_current_active_user)],  # Protect all group routes
)


@router.post("/", response_model=Group, status_code=status.HTTP_201_CREATED)
async def create_new_group(
    group: GroupCreate, current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Creates a new group. The creator is automatically added as the first member.
    Optionally include `member_ids` in the request body to add initial members.
    """
    # Extract member IDs from the payload, ensuring creator isn't duplicated
    initial_member_ids = set(group.member_ids or [])
    initial_member_ids.discard(current_user.id)  # Ensure creator isn't listed twice

    # TODO: Add validation to ensure initial_member_ids exist and are valid users

    created_group = await db.create_group(
        group_data=group,
        creator_id=current_user.id,
        initial_member_ids=list(initial_member_ids),  # Pass the list of other members
    )
    if not created_group:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create group.",
        )
    return created_group


@router.get("/", response_model=List[Group])
async def get_my_groups(current_user: UserInDB = Depends(get_current_active_user)):
    """Gets all groups the current user is a member of."""
    groups = await db.get_user_groups(user_id=current_user.id)
    return groups


@router.get("/{group_id}", response_model=GroupDetails)
async def get_group_details(
    group_id: str, current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Gets detailed information about a specific group, including member details.
    Ensures the current user is a member of the group.
    """
    is_member = await db.is_user_group_member(
        group_id=group_id, user_id=current_user.id
    )
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this group"
        )

    group = await db.get_group_by_id(group_id=group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Fetch member details using the existing get_users_by_ids function
    member_ids = [member.user_id for member in group.members if member.is_active]
    users = await db.get_users_by_ids(member_ids)

    # Create proper member details from the fetched users
    members_details = [
        GroupMemberInfo(id=user.firebase_uid, username=user.display_name)
        for user in users
    ]

    return GroupDetails(**group.dict(), members_details=members_details)


@router.put("/{group_id}", response_model=Group)
async def update_group_info(
    group_id: str,
    group_update: GroupUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """
    Updates a group's information (e.g., name).
    Only the group creator or potentially admins (if roles are implemented) can update.
    """
    group = await db.get_group_by_id(group_id=group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Authorization: Check if current user is the creator (or an admin)
    if group.creator_id != current_user.id:
        # TODO: Add role-based access control if needed (e.g., allow admins)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the group creator can update group info",
        )

    updated_group = await db.update_group(group_id=group_id, update_data=group_update)
    if not updated_group:
        # This might happen if the group was deleted between checks
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found or update failed",
        )
    return updated_group


@router.post(
    "/{group_id}/members/{user_id_to_add}", status_code=status.HTTP_204_NO_CONTENT
)
async def add_group_member(
    group_id: str,
    user_id_to_add: str,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """
    Adds a user to a group.
    Requires the current user to be a member (or creator/admin) of the group.
    """
    # TODO: Add validation that user_id_to_add exists
    is_member = await db.is_user_group_member(
        group_id=group_id, user_id=current_user.id
    )
    # TODO: Add role check - maybe only creator/admins can add members?
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Must be a member to add others",
        )

    success = await db.add_member_to_group(
        group_id=group_id, user_id_to_add=user_id_to_add
    )
    if not success:
        # Could be group not found, user already member, or DB error
        # Check if group exists first for better error message
        group_exists = await db.get_group_by_id(group_id)
        if not group_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
            )
        # Check if user already exists
        user_already_member = await db.is_user_group_member(group_id, user_id_to_add)
        if user_already_member:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="User is already a member"
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add member",
        )
    return  # Return 204 No Content on success


@router.delete(
    "/{group_id}/members/{user_id_to_remove}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_group_member(
    group_id: str,
    user_id_to_remove: str,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """
    Removes a user from a group.
    Requires the current user to be the group creator or the user being removed.
    (Adjust logic as needed for admins etc.)
    """
    group = await db.get_group_by_id(group_id=group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Authorization:
    is_creator = group.creator_id == current_user.id
    is_self_remove = user_id_to_remove == current_user.id

    if not (is_creator or is_self_remove):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the creator or the user themselves can remove a member",
        )

    # Prevent creator from being removed (or handle group deletion/ownership transfer)
    if user_id_to_remove == group.creator_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the group creator.",
        )

    success = await db.remove_member_from_group(
        group_id=group_id, user_id_to_remove=user_id_to_remove
    )
    if not success:
        # Could be group not found, user not member, or DB error
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,  # Or 400 if user wasn't a member
            detail="Failed to remove member (user might not be a member or group not found)",
        )
    return  # Return 204 No Content on success


@router.get("/{group_id}/messages/", response_model=List[MessageResponse])
async def get_group_messages(
    group_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
):
    """
    Gets messages for a specific group. Requires user to be a member.
    """
    is_member = await db.is_user_group_member(
        group_id=group_id, user_id=current_user.id
    )
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this group"
        )

    # Use the implemented DB function
    messages_in_db = await db.get_group_messages(
        group_id=group_id, limit=limit, skip=skip
    )

    # Convert DB objects to response model
    # Assuming MessageResponse can be created from MessageInDB
    return [MessageResponse(**msg.model_dump()) for msg in messages_in_db]


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_existing_group(
    group_id: str, current_user: UserInDB = Depends(get_current_active_user)
):
    """
    Deletes a group. Requires the current user to be the group creator.
    """
    group = await db.get_group_by_id(group_id=group_id)
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
        )

    # Authorization: Only creator can delete
    if group.creator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the group creator can delete the group",
        )

    success = await db.delete_group(group_id=group_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete group",
        )
    # TODO: Consider deleting associated messages or archiving them.
    return  # Return 204 No Content on success


# Note: Sending messages to groups will likely be handled primarily via WebSockets,
# but you might want a REST endpoint for specific use cases if needed.
