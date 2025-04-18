import logging
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from bson.objectid import ObjectId

from auth.firebase import get_current_user, FirebaseToken
from db.mongodb import (
    get_conversations_collection,
    get_messages_collection,
    get_users_collection,
)
from schemas.conversation import (
    ConversationResponse,
    ConversationWithMessages,
    ConversationUpdate,
)
from schemas.message import MessageResponse

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter()


@router.get("/{user_id}", response_model=List[MessageResponse])
async def get_chat_history(
    user_id: str,
    limit: int = Query(50, ge=1, le=100),
    before: str = None,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Get chat history between the current user and another user.
    """
    # Check if the other user exists
    users_collection = get_users_collection()
    other_user = await users_collection.find_one({"firebase_uid": user_id})

    if not other_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # Create conversation ID (sort user IDs to ensure consistency)
    conversation_id = f"{min(current_user.firebase_uid, user_id)}_{max(current_user.firebase_uid, user_id)}"

    # Get messages
    messages_collection = get_messages_collection()

    # Build query
    query = {
        "conversation_id": conversation_id,
        "$or": [
            {"sender_id": current_user.firebase_uid, "recipient_id": user_id},
            {"sender_id": user_id, "recipient_id": current_user.firebase_uid},
        ],
    }

    # Add pagination if before timestamp is provided
    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
            query["created_at"] = {"$lt": before_dt}
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid 'before' parameter format. Use ISO 8601 format.",
            )

    # Get messages with pagination
    cursor = messages_collection.find(query).sort("created_at", -1).limit(limit)
    messages = await cursor.to_list(length=limit)

    # Process messages
    processed_messages = []
    for message in messages:
        # Convert ObjectId to string
        message["_id"] = str(message["_id"])

        # Handle messages from websocket which might have text in payload
        if "payload" in message and message.get("type") == "message":
            if "text" in message["payload"]:
                message["text"] = message["payload"]["text"]

        # Ensure message has text field
        if "text" not in message:
            message["text"] = ""  # Provide a default value for text

        # Standardize reactions field format if present
        if "reactions" in message and message["reactions"]:
            # Ensure reactions is properly formatted for the frontend
            for reaction in message["reactions"]:
                if "user_id" not in reaction:
                    reaction["user_id"] = reaction.get("userId", "unknown")
                if "created_at" not in reaction and "timestamp" in reaction:
                    reaction["created_at"] = reaction["timestamp"]

        # Standardize fields for edited/deleted status
        if "is_edited" not in message:
            message["is_edited"] = False

        if "is_deleted" not in message:
            message["is_deleted"] = False

        # Ensure reply_to field is present
        if "reply_to" not in message and "replyTo" in message:
            message["reply_to"] = message["replyTo"]

        # Use the from_db method to create proper MessageResponse objects
        processed_messages.append(MessageResponse.model_validate(message))

    # Mark unread messages as read
    unread_ids = [
        (
            ObjectId(msg.id)
            if len(msg.id) == 24
            and all(c in "0123456789abcdef" for c in msg.id.lower())
            else msg.id
        )
        for msg in processed_messages
        if msg.recipient_id == current_user.firebase_uid and msg.status != "read"
    ]

    if unread_ids:
        now = datetime.utcnow()
        # Filter out any IDs that aren't ObjectId objects
        object_ids = [msg_id for msg_id in unread_ids if isinstance(msg_id, ObjectId)]

        if object_ids:
            await messages_collection.update_many(
                {"_id": {"$in": object_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

        # Handle string IDs (from websocket) separately
        string_ids = [msg_id for msg_id in unread_ids if isinstance(msg_id, str)]
        if string_ids:
            await messages_collection.update_many(
                {"_id": {"$in": string_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

    # Sort messages by created_at
    processed_messages.sort(key=lambda x: x.created_at)

    return processed_messages


@router.get("/", response_model=List[ConversationResponse])
async def get_conversations(current_user: FirebaseToken = Depends(get_current_user)):
    """
    Get all conversations for the current user.
    """
    # Get conversations
    conversations_collection = get_conversations_collection()

    # Find conversations where the current user is a participant
    cursor = conversations_collection.find(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid},
                {"user_id_2": current_user.firebase_uid},
            ]
        }
    ).sort(
        [("is_pinned", -1), ("last_message_at", -1)]
    )  # First sort by pinned status, then by last message time

    conversations = await cursor.to_list(length=100)

    # Add the "other_user_id" field to each conversation
    result = []
    for conv in conversations:
        conv["_id"] = str(conv["_id"])

        # Determine the other user
        if conv["user_id_1"] == current_user.firebase_uid:
            conv["other_user_id"] = conv["user_id_2"]
        else:
            conv["other_user_id"] = conv["user_id_1"]

        result.append(conv)

    return result


@router.get("/conversation/{conversation_id}", response_model=ConversationWithMessages)
async def get_conversation_with_messages(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=100),
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Get a conversation and its recent messages.
    """
    # Get the conversation
    conversations_collection = get_conversations_collection()

    # Make sure the current user is a participant
    conversation = await conversations_collection.find_one(
        {
            "_id": ObjectId(conversation_id),
            "$or": [
                {"user_id_1": current_user.firebase_uid},
                {"user_id_2": current_user.firebase_uid},
            ],
        }
    )

    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    # Convert ObjectId to string
    conversation["_id"] = str(conversation["_id"])

    # Determine the other user
    if conversation["user_id_1"] == current_user.firebase_uid:
        conversation["other_user_id"] = conversation["user_id_2"]
    else:
        conversation["other_user_id"] = conversation["user_id_1"]

    # Get recent messages
    messages_collection = get_messages_collection()
    cursor = (
        messages_collection.find(
            {
                "conversation_id": f"{min(conversation['user_id_1'], conversation['user_id_2'])}_{max(conversation['user_id_1'], conversation['user_id_2'])}"
            }
        )
        .sort("created_at", -1)
        .limit(limit)
    )

    messages = await cursor.to_list(length=limit)

    # Convert ObjectId to string for each message
    for message in messages:
        message["_id"] = str(message["_id"])

    # Mark unread messages as read
    unread_messages = [
        (
            ObjectId(msg["_id"])
            if len(msg["_id"]) == 24
            and all(c in "0123456789abcdef" for c in msg["_id"].lower())
            else msg["_id"]
        )
        for msg in messages
        if msg["recipient_id"] == current_user.firebase_uid and msg["status"] != "read"
    ]

    if unread_messages:
        now = datetime.utcnow()
        # Filter out any IDs that aren't ObjectId objects
        object_ids = [
            msg_id for msg_id in unread_messages if isinstance(msg_id, ObjectId)
        ]

        if object_ids:
            await messages_collection.update_many(
                {"_id": {"$in": object_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

        # Handle string IDs (from websocket) separately
        string_ids = [msg_id for msg_id in unread_messages if isinstance(msg_id, str)]
        if string_ids:
            await messages_collection.update_many(
                {"_id": {"$in": string_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

    # Sort messages by created_at
    messages.sort(key=lambda x: x["created_at"])

    # Add messages to the conversation
    conversation["messages"] = messages

    return conversation


@router.patch("/conversation/{user_id}/pin")
async def pin_conversation(
    user_id: str,
    is_pinned: bool,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Pin or unpin a conversation
    """
    # Create conversation ID (sort user IDs to ensure consistency)
    conversation_id = f"{min(current_user.firebase_uid, user_id)}_{max(current_user.firebase_uid, user_id)}"

    # Find the conversation
    conversations_collection = get_conversations_collection()

    # First, check if the conversation exists
    conversation = await conversations_collection.find_one(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
            ]
        }
    )

    if not conversation:
        # Create a new conversation if it doesn't exist
        new_conversation = {
            "user_id_1": min(current_user.firebase_uid, user_id),
            "user_id_2": max(current_user.firebase_uid, user_id),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "is_pinned": is_pinned,
            "is_unread": False,
            "is_deleted": False,
        }
        result = await conversations_collection.insert_one(new_conversation)
        conversation_id = str(result.inserted_id)
    else:
        # Update existing conversation
        await conversations_collection.update_one(
            {
                "$or": [
                    {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                    {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
                ]
            },
            {"$set": {"is_pinned": is_pinned, "updated_at": datetime.utcnow()}},
        )
        conversation_id = str(conversation["_id"])

    return {"id": conversation_id, "is_pinned": is_pinned}


@router.patch("/conversation/{user_id}/unread")
async def mark_conversation_unread(
    user_id: str,
    is_unread: bool,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Mark a conversation as read or unread
    """
    # Find the conversation
    conversations_collection = get_conversations_collection()

    result = await conversations_collection.update_one(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
            ]
        },
        {"$set": {"is_unread": is_unread, "updated_at": datetime.utcnow()}},
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found"
        )

    return {"success": True, "is_unread": is_unread}


@router.delete("/conversation/{user_id}")
async def delete_conversation(
    user_id: str,
    current_user: FirebaseToken = Depends(get_current_user),
):
    """
    Completely delete a conversation and all its messages
    """
    # Create conversation ID (sort user IDs to ensure consistency)
    conversation_id = f"{min(current_user.firebase_uid, user_id)}_{max(current_user.firebase_uid, user_id)}"

    # Get collections
    conversations_collection = get_conversations_collection()
    messages_collection = get_messages_collection()

    # Delete all messages in the conversation
    delete_messages_result = await messages_collection.delete_many(
        {"conversation_id": conversation_id}
    )

    # Delete the conversation
    delete_conversation_result = await conversations_collection.delete_one(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
            ]
        }
    )

    if delete_conversation_result.deleted_count == 0:
        # If the conversation wasn't found, it's fine - we've still deleted any messages
        logger.info(f"No conversation found to delete for {conversation_id}")

    return {
        "success": True,
        "deleted_conversation": delete_conversation_result.deleted_count > 0,
        "deleted_messages": delete_messages_result.deleted_count,
    }
