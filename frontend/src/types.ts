// Message related types
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Attachment {
  id: string;
  type: string;
  url: string;
  name: string;
  size: number;
  mimeType?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, any>;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string | number;
  status: MessageStatus;
  attachments?: Attachment[];
  replyTo?: string;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  reactions?: MessageReaction[];
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  timestamp: string | number;
}

// User related types
export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  status?: UserStatus;
  lastSeen?: string | number;
}

export type UserStatus = 'online' | 'offline' | 'away' | 'busy' | 'invisible';

// Contact related types
export interface Contact {
  contact_id: string;
  contact_display_name: string;
  contact_avatar_url?: string;
  contact_phone?: string;
  contact_email?: string;
  contact_status?: UserStatus;
  last_seen?: string | number;
}

// Conversation related types
export interface Conversation {
  id: string;
  participants: string[];
  messages: Message[];
  lastMessage?: Message;
  unreadCount: number;
  createdAt: string | number;
  updatedAt: string | number;
}

// UI related types
export type ThemeMode = 'light' | 'dark' | 'system'; 