// Message related types
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface Attachment {
  id?: string;
  type: string;
  url: string;
  name: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, any>;
  fileType?: string;
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
  receiverId?: string;
  groupId?: string;
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
  presence_status?: 'online' | 'away' | 'offline';
  last_seen?: string | number;
}

// Group chat related types
export interface GroupMember {
  user_id: string;
  display_name: string;
  role: 'admin' | 'member';
  avatar_url?: string;
  joined_at: string | number;
  status?: UserStatus;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_at: string | number;
  updated_at?: string | number;
  created_by: string;
  members: GroupMember[];
  is_direct_message?: boolean;
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
  isGroup?: boolean;
  group?: Group;
}

// UI related types
export type ThemeMode = 'light' | 'dark' | 'system'; 