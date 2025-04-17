# EZChat WebSocket Protocol Documentation

## Overview
EZChat uses a custom WebSocket protocol for real-time messaging. This protocol enables features such as:
- Private messaging between users
- Typing indicators
- Read receipts
- Online status updates

## Authentication
All WebSocket connections must be authenticated using a Firebase JWT token.

1. Client authenticates with Firebase Auth to obtain an ID token
2. Client establishes WebSocket connection with the token in the query parameter:
   ```
   ws://server-url/ws?token=<firebase-id-token>
   ```
3. Server validates the token before accepting the connection
4. If token is invalid or expired, connection is rejected

## Message Format
All messages use a standardized JSON format:

```json
{
  "type": "<message_type>",
  "from": "<sender_user_id>",
  "to": "<recipient_user_id>",
  "payload": { ... }
}
```

## Message Types

### 1. Text Message
```json
{
  "type": "message",
  "from": "user123",
  "to": "user456",
  "payload": {
    "id": "msg-uuid-123456",
    "text": "Hello, how are you?",
    "timestamp": "2023-05-20T14:30:00Z",
    "status": "sent"
  }
}
```

### 2. Typing Indicator
```json
{
  "type": "typing",
  "from": "user123",
  "to": "user456",
  "payload": {
    "isTyping": true
  }
}
```

### 3. Read Receipt
```json
{
  "type": "read_receipt",
  "from": "user456",
  "to": "user123",
  "payload": {
    "messageId": "msg-uuid-123456",
    "status": "read",
    "timestamp": "2023-05-20T14:31:00Z"
  }
}
```

### 4. Delivery Receipt
```json
{
  "type": "delivery_receipt",
  "from": "user456", 
  "to": "user123",
  "payload": {
    "messageId": "msg-uuid-123456",
    "status": "delivered",
    "timestamp": "2023-05-20T14:30:30Z"
  }
}
```

### 5. Presence Update
```json
{
  "type": "presence",
  "from": "user123",
  "to": null,
  "payload": {
    "status": "online" | "offline" | "away",
    "lastSeen": "2023-05-20T14:30:00Z"
  }
}
```

### 6. File/Media Message
```json
{
  "type": "message",
  "from": "user123",
  "to": "user456",
  "payload": {
    "id": "msg-uuid-123456",
    "text": "Check out this image!",
    "timestamp": "2023-05-20T14:30:00Z",
    "status": "sent",
    "attachments": [
      {
        "type": "image",
        "url": "https://storage.firebase.com/path/to/image.jpg",
        "name": "image.jpg",
        "size": 24680
      }
    ]
  }
}
```

## Error Handling
Server sends error messages for invalid requests:

```json
{
  "type": "error",
  "payload": {
    "code": 400,
    "message": "Invalid message format"
  }
}
```

## Connection Management
- Server may terminate connections for inactivity (after 30 minutes)
- Clients should implement reconnection logic with exponential backoff
- Server broadcasts a system message when it's going to restart/maintenance

## Rate Limiting
- 100 messages per minute per user
- Exceeding rate limits will trigger a rate_limit_exceeded error
- Persistent violations may result in temporary bans

## Security Considerations
- All message data should be properly sanitized
- URLs should be validated and sanitized
- Message content length is limited to 5000 characters
- Attachments are limited to 25MB per file 