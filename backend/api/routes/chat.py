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
)
from schemas.message import MessageResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{user_id}", response_model=List[MessageResponse])
async def get_chat_history(
    user_id: str,
    limit: int = Query(50, ge=1, le=100),
    before: str = None,
    current_user: FirebaseToken = Depends(get_current_user),
):
    users_collection = get_users_collection()
    other_user = await users_collection.find_one({"firebase_uid": user_id})

    if not other_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    conversation_id = f"{min(current_user.firebase_uid, user_id)}_{max(current_user.firebase_uid, user_id)}"
    messages_collection = get_messages_collection()

    query = {
        "conversation_id": conversation_id,
        "$or": [
            {"sender_id": current_user.firebase_uid, "recipient_id": user_id},
            {"sender_id": user_id, "recipient_id": current_user.firebase_uid},
        ],
    }

    if before:
        try:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
            query["created_at"] = {"$lt": before_dt}
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid 'before' parameter format. Use ISO 8601 format.",
            )

    cursor = messages_collection.find(query).sort("created_at", -1).limit(limit)
    messages = await cursor.to_list(length=limit)

    processed_messages = []
    for message in messages:
        message["_id"] = str(message["_id"])

        if "payload" in message and message.get("type") == "message":
            if "text" in message["payload"]:
                message["text"] = message["payload"]["text"]

        if "text" not in message:
            message["text"] = ""

        message["is_edited"] = message.get("is_edited", False)
        message["is_deleted"] = message.get("is_deleted", False)

        if "reply_to" not in message and "replyTo" in message:
            message["reply_to"] = message["replyTo"]

        processed_messages.append(MessageResponse.model_validate(message))

    unread_messages = [
        (
            ObjectId(msg.id)
            if isinstance(msg.id, str)
            and len(msg.id) == 24
            and all(c in "0123456789abcdef" for c in msg.id.lower())
            else msg.id
        )
        for msg in processed_messages
        if msg.recipient_id == current_user.firebase_uid and msg.status != "read"
    ]

    if unread_messages:
        now = datetime.utcnow()
        object_ids = [
            msg_id for msg_id in unread_messages if isinstance(msg_id, ObjectId)
        ]
        string_ids = [msg_id for msg_id in unread_messages if isinstance(msg_id, str)]

        if object_ids:
            await messages_collection.update_many(
                {"_id": {"$in": object_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

        if string_ids:
            await messages_collection.update_many(
                {"_id": {"$in": string_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

    processed_messages.sort(key=lambda x: x.created_at)
    return processed_messages


@router.get("/", response_model=List[ConversationResponse])
async def get_conversations(current_user: FirebaseToken = Depends(get_current_user)):
    conversations_collection = get_conversations_collection()

    cursor = conversations_collection.find(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid},
                {"user_id_2": current_user.firebase_uid},
            ]
        }
    ).sort([("is_pinned", -1), ("last_message_at", -1)])

    conversations = await cursor.to_list(length=100)

    result = []
    for conv in conversations:
        conv["_id"] = str(conv["_id"])
        conv["other_user_id"] = (
            conv["user_id_2"]
            if conv["user_id_1"] == current_user.firebase_uid
            else conv["user_id_1"]
        )
        result.append(conv)

    return result


@router.get("/conversation/{conversation_id}", response_model=ConversationWithMessages)
async def get_conversation_with_messages(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=100),
    current_user: FirebaseToken = Depends(get_current_user),
):
    conversations_collection = get_conversations_collection()

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

    conversation["_id"] = str(conversation["_id"])
    conversation["other_user_id"] = (
        conversation["user_id_2"]
        if conversation["user_id_1"] == current_user.firebase_uid
        else conversation["user_id_1"]
    )

    messages_collection = get_messages_collection()
    user_id_1, user_id_2 = conversation["user_id_1"], conversation["user_id_2"]
    conversation_key = f"{min(user_id_1, user_id_2)}_{max(user_id_1, user_id_2)}"

    cursor = (
        messages_collection.find({"conversation_id": conversation_key})
        .sort("created_at", -1)
        .limit(limit)
    )
    messages = await cursor.to_list(length=limit)

    for message in messages:
        message["_id"] = str(message["_id"])

    unread_message_ids = [
        (
            ObjectId(msg["_id"])
            if len(msg["_id"]) == 24
            and all(c in "0123456789abcdef" for c in msg["_id"].lower())
            else msg["_id"]
        )
        for msg in messages
        if msg["recipient_id"] == current_user.firebase_uid and msg["status"] != "read"
    ]

    if unread_message_ids:
        now = datetime.utcnow()
        object_ids = [
            msg_id for msg_id in unread_message_ids if isinstance(msg_id, ObjectId)
        ]
        string_ids = [
            msg_id for msg_id in unread_message_ids if isinstance(msg_id, str)
        ]

        if object_ids:
            await messages_collection.update_many(
                {"_id": {"$in": object_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

        if string_ids:
            await messages_collection.update_many(
                {"_id": {"$in": string_ids}},
                {"$set": {"status": "read", "read_at": now}},
            )

    messages.sort(key=lambda x: x["created_at"])
    conversation["messages"] = messages

    return conversation


@router.patch("/conversation/{user_id}/pin")
async def pin_conversation(
    user_id: str,
    is_pinned: bool,
    current_user: FirebaseToken = Depends(get_current_user),
):
    conversations_collection = get_conversations_collection()

    conversation = await conversations_collection.find_one(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
            ]
        }
    )

    if not conversation:
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
        await conversations_collection.update_one(
            {"_id": conversation["_id"]},
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
    conversation_id = f"{min(current_user.firebase_uid, user_id)}_{max(current_user.firebase_uid, user_id)}"

    conversations_collection = get_conversations_collection()
    messages_collection = get_messages_collection()

    delete_messages_result = await messages_collection.delete_many(
        {"conversation_id": conversation_id}
    )

    delete_conversation_result = await conversations_collection.delete_one(
        {
            "$or": [
                {"user_id_1": current_user.firebase_uid, "user_id_2": user_id},
                {"user_id_1": user_id, "user_id_2": current_user.firebase_uid},
            ]
        }
    )

    if delete_conversation_result.deleted_count == 0:
        logger.info(f"No conversation found to delete for {conversation_id}")

    return {
        "success": True,
        "deleted_conversation": delete_conversation_result.deleted_count > 0,
        "deleted_messages": delete_messages_result.deleted_count,
    }
