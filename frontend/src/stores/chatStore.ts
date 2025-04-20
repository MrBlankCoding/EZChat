import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import websocketService from '../services/websocketService';
import { useAuthStore } from './authStore';
import { useContactsStore } from './contactsStore';
import { PresenceState } from '../services/presenceManager';
import { Attachment, Group } from '../types';

export interface FileAttachment {
  type: string;
  url: string;
  name: string;
  size?: number;
  fileType?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, any>;
  id?: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number | string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  attachments?: FileAttachment[];
  replyTo?: string;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
  groupId?: string;
}

export interface Conversation {
  contactId: string;
  messages: Message[];
  lastReadMessageId?: string;
  isPinned?: boolean;
  isUnread?: boolean;
  _lastUpdated?: number;
  contactStatus?: PresenceState;
  isGroup?: boolean;
  groupId?: string;
}

interface GroupConversation extends Conversation {
  isGroup: true;
  groupId: string;
  groupDetails?: Group;
}

interface ChatState {
  activeConversationId: string | null;
  conversations: Record<string, Conversation | GroupConversation>;
  groups: Record<string, Group>;
  isLoading: boolean;
  error: string | null;
  typingIndicators: Record<string, boolean>;
  
  setActiveConversation: (contactId: string) => void;
  fetchMessagesForContact: (contactId: string) => Promise<void>;
  sendMessage: (contactId: string, text: string, attachments?: any[]) => Promise<string | undefined>;
  addMessage: (message: Message) => void;
  markMessagesAsRead: (contactId: string) => Promise<void>;
  setTypingIndicator: (contactId: string, isTyping: boolean) => void;
  updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read' | 'failed') => void;
  updateContactStatus: (contactId: string, status: PresenceState) => void;
  clearError: () => void;
  
  pinConversation: (contactId: string, isPinned: boolean) => Promise<void>;
  markConversationAsUnread: (contactId: string, isUnread: boolean) => Promise<void>;
  deleteConversation: (contactId: string) => Promise<void>;
  
  editMessage: (messageId: string, contactId: string, text: string) => Promise<boolean>;
  updateEditedMessage: (messageId: string, contactId: string, text: string, editedAt: string) => void;
  deleteMessage: (messageId: string, contactId: string) => Promise<boolean>;
  updateDeletedMessage: (messageId: string, contactId: string, deletedAt?: string) => void;
  sendReply: (contactId: string, text: string, replyToMessageId: string, attachments?: any[]) => Promise<string | undefined>;
  getAllImageAttachments: () => Attachment[];

  // Group chat related methods
  fetchGroups: () => Promise<void>;
  fetchGroup: (groupId: string) => Promise<Group | null>;
  fetchMessagesForGroup: (groupId: string) => Promise<void>;
  createGroup: (name: string, memberIds: string[], description?: string, avatarUrl?: string) => Promise<Group | null>;
  updateGroup: (groupId: string, updates: Partial<Group>) => Promise<Group | null>;
  addGroupMembers: (groupId: string, memberIds: string[]) => Promise<boolean>;
  removeGroupMember: (groupId: string, memberId: string) => Promise<boolean>;
  leaveGroup: (groupId: string) => Promise<boolean>;
  sendGroupMessage: (groupId: string, text: string, attachments?: any[]) => Promise<string | undefined>;
  setActiveGroup: (groupId: string) => void;
  deleteGroup: (groupId: string) => Promise<boolean>;
}

const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      activeConversationId: null,
      conversations: {},
      groups: {},
      isLoading: false,
      error: null,
      typingIndicators: {},
      
      setActiveConversation: (contactId: string) => {
        set({ activeConversationId: contactId });
        
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (conversation) {
          if (conversation.isUnread) {
            get().markMessagesAsRead(contactId);
          }
          
          const unreadMessages = conversation.messages.filter(
            msg => msg.senderId === contactId && msg.status !== 'read'
          );
          
          if (unreadMessages.length > 0) {
            websocketService.sendReadReceipt(contactId, unreadMessages[unreadMessages.length - 1].id);
          }
        } else {
          set({
            conversations: {
              ...conversations,
              [contactId]: { contactId, messages: [] }
            }
          });
          get().fetchMessagesForContact(contactId);
        }
      },
      
      fetchMessagesForContact: async (contactId: string) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          const response = await apiClient.get(`/chats/${contactId}`);
          const messages = response.data.map((message: any) => {
            // Process attachments to ensure they follow the FileAttachment structure
            const attachments = (message.attachments || []).map((att: any) => {
              if (typeof att === 'object' && att !== null) {
                return {
                  type: att.type || 'file',
                  url: att.url || '',
                  name: att.name || 'Unknown file',
                  size: att.size,
                  fileType: att.fileType
                };
              }
              return att;
            });
            
            return {
              id: message.id || message._id,
              senderId: message.senderId || message.sender_id,
              receiverId: message.receiverId || message.recipient_id,
              text: message.text || '',
              timestamp: message.timestamp || message.created_at,
              status: message.status || 'sent',
              attachments: attachments,
              replyTo: message.reply_to,
              isEdited: message.is_edited || false,
              editedAt: message.edited_at,
              isDeleted: message.is_deleted || false,
              deletedAt: message.deleted_at
            };
          });
          
          const { conversations } = get();
          const existingConversation = conversations[contactId] || {};
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...existingConversation,
                contactId,
                messages,
                isPinned: existingConversation.isPinned || false,
                isUnread: existingConversation.isUnread || false
              }
            },
            isLoading: false
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to fetch messages',
            isLoading: false
          });
        }
      },
      
      sendMessage: async (contactId: string, text: string, attachments = []) => {
        try {
          set({ isLoading: true, error: null });
          
          const { conversations } = get();
          if (!conversations[contactId]) {
            set({
              conversations: {
                ...conversations,
                [contactId]: { contactId, messages: [] }
              }
            });
          }
          
          const messageId = await websocketService.sendMessage(contactId, text, attachments);
          set({ isLoading: false });
          return messageId;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to send message',
            isLoading: false
          });
        }
      },
      
      addMessage: (message: Message) => {
        const { user } = useAuthStore.getState();
        if (!user) return;
        
        const contactId = message.senderId === user.id ? message.receiverId : message.senderId;
        const { conversations, activeConversationId } = get();
        const conversation = conversations[contactId] || { contactId, messages: [] };
        
        if (conversation.messages.some(m => m.id === message.id)) return;
        
        const formattedMessage = {
          ...message,
          timestamp: typeof message.timestamp === 'string' 
            ? message.timestamp 
            : new Date(message.timestamp).toISOString()
        };
        
        const shouldMarkAsUnread = message.senderId !== user.id && activeConversationId !== contactId;
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: [...conversation.messages, formattedMessage],
              isUnread: shouldMarkAsUnread ? true : conversation.isUnread
            }
          }
        });
        
        const isActive = activeConversationId === contactId;
        const isVisible = document?.visibilityState === 'visible';
        const isFromOther = message.senderId !== user.id;
        
        if (isActive && isFromOther && isVisible) {
          websocketService.sendReadReceipt(contactId, message.id);
        }
      },
      
      markMessagesAsRead: async (contactId: string) => {
        try {
          const { conversations } = get();
          const conversation = conversations[contactId];
          
          if (!conversation?.messages.length) return;
          
          const unreadMessages = conversation.messages.filter(
            msg => msg.senderId === contactId && msg.status !== 'read'
          );
          
          if (unreadMessages.length === 0) return;
          
          const lastMessage = unreadMessages[unreadMessages.length - 1];
          
          await apiClient.post(`/chats/${contactId}/read`, { messageId: lastMessage.id });
          
          const updatedMessages = conversation.messages.map(message => 
            message.senderId === contactId && message.status !== 'read'
              ? { ...message, status: 'read' as const }
              : message
          );
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                lastReadMessageId: lastMessage.id,
                isUnread: false,
                messages: updatedMessages
              }
            }
          });
        } catch (error) {
          console.error("Failed to mark messages as read:", error);
        }
      },
      
      setTypingIndicator: (contactId: string, isTyping: boolean) => {
        set(state => ({
          typingIndicators: {
            ...state.typingIndicators,
            [contactId]: isTyping
          }
        }));
      },
      
      updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read' | 'failed') => {
        const msgId = String(messageId);
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === msgId) {
            if (message.status !== status || status === 'read' || status === 'failed') {
              return { ...message, status };
            }
          }
          return message;
        });
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: updatedMessages,
              _lastUpdated: Date.now()
            }
          }
        });
      },
      
      updateContactStatus: (contactId: string, status: PresenceState) => {
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (conversation) {
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                contactStatus: status,
                _lastUpdated: Date.now()
              }
            }
          });
        }
        
        useContactsStore.getState().updateContactPresence(contactId, status);
      },
      
      clearError: () => set({ error: null }),
      
      pinConversation: async (contactId: string, isPinned: boolean) => {
        try {
          set({ isLoading: true, error: null });
          
          await apiClient.patch(`/chats/conversation/${contactId}/pin`, null, {
            params: { is_pinned: isPinned }
          });
          
          const { conversations } = get();
          const conversation = conversations[contactId] || { contactId, messages: [] };
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                isPinned
              }
            },
            isLoading: false
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to pin conversation',
            isLoading: false
          });
        }
      },
      
      markConversationAsUnread: async (contactId: string, isUnread: boolean) => {
        try {
          set({ isLoading: true, error: null });
          
          await apiClient.patch(`/chats/conversation/${contactId}/unread`, null, {
            params: { is_unread: isUnread }
          });
          
          const { conversations } = get();
          const conversation = conversations[contactId] || { contactId, messages: [] };
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                isUnread
              }
            },
            isLoading: false
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to mark conversation as unread',
            isLoading: false
          });
        }
      },
      
      deleteConversation: async (contactId: string) => {
        try {
          const { conversations, activeConversationId } = get();
          
          const updatedConversations = { ...conversations };
          delete updatedConversations[contactId];
          
          set({
            conversations: updatedConversations,
            activeConversationId: activeConversationId === contactId ? null : activeConversationId,
            isLoading: true,
            error: null
          });
          
          await apiClient.delete(`/chats/conversation/${contactId}`);
          set({ isLoading: false });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to delete conversation',
            isLoading: false
          });
        }
      },
      
      editMessage: async (messageId: string, contactId: string, text: string) => {
        const { user } = useAuthStore.getState();
        if (!user) return false;
        
        try {
          websocketService.editMessage(contactId, messageId, text);
          
          const { conversations } = get();
          const conversation = conversations[contactId];
          
          if (!conversation) return false;
          
          const updatedMessages = conversation.messages.map(message => {
            if (message.id === messageId && message.senderId === user.id) {
              return {
                ...message,
                text,
                isEdited: true,
                editedAt: new Date().toISOString()
              };
            }
            return message;
          });
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                messages: updatedMessages
              }
            }
          });
          
          return true;
        } catch (error) {
          console.error('Error editing message:', error);
          return false;
        }
      },
      
      updateEditedMessage: (messageId: string, contactId: string, text: string, editedAt: string) => {
        const msgId = String(messageId);
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === msgId) {
            return {
              ...message,
              text,
              isEdited: true,
              editedAt: editedAt || new Date().toISOString()
            };
          }
          return message;
        });
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: updatedMessages,
              _lastUpdated: Date.now()
            }
          }
        });
      },
      
      deleteMessage: async (messageId: string, contactId: string) => {
        const { user } = useAuthStore.getState();
        if (!user) return false;
        
        try {
          websocketService.deleteMessage(contactId, messageId);
          
          const { conversations } = get();
          const conversation = conversations[contactId];
          
          if (!conversation) return false;
          
          const updatedMessages = conversation.messages.map(message => {
            if (message.id === messageId && message.senderId === user.id) {
              return {
                ...message,
                text: 'This message was deleted',
                isDeleted: true,
                deletedAt: new Date().toISOString(),
                attachments: []
              };
            }
            return message;
          });
          
          set({
            conversations: {
              ...conversations,
              [contactId]: {
                ...conversation,
                messages: updatedMessages,
                _lastUpdated: Date.now()
              }
            }
          });
          
          return true;
        } catch (error) {
          console.error('Error deleting message:', error);
          return false;
        }
      },
      
      updateDeletedMessage: (messageId: string, contactId: string, deletedAt?: string) => {
        const msgId = String(messageId);
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === msgId) {
            return {
              ...message,
              text: 'This message was deleted',
              isDeleted: true,
              deletedAt: deletedAt || new Date().toISOString(),
              attachments: []
            };
          }
          return message;
        });
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: updatedMessages,
              _lastUpdated: Date.now()
            }
          }
        });
      },
      
      sendReply: async (contactId: string, text: string, replyToMessageId: string, attachments = []) => {
        try {
          set({ isLoading: true, error: null });
          
          const messageId = await websocketService.sendReply(contactId, text, replyToMessageId, attachments);
          set({ isLoading: false });
          
          return messageId;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to send reply',
            isLoading: false
          });
          return undefined;
        }
      },
      
      getAllImageAttachments: () => {
        const { conversations, activeConversationId } = get();
        
        if (!activeConversationId) {
          console.log("No active conversation ID");
          return [];
        }
        
        const conversation = conversations[activeConversationId];
        if (!conversation) {
          console.log(`Conversation with ID ${activeConversationId} not found`);
          return [];
        }
        
        console.log(`Found ${conversation.messages.length} messages in conversation`);
        
        const allAttachments: Attachment[] = [];
        conversation.messages.forEach(message => {
          if (message.attachments && message.attachments.length > 0 && !message.isDeleted) {
            console.log(`Found ${message.attachments.length} attachments in message ${message.id}`);
            
            message.attachments.forEach(attachment => {
              const type = attachment.type || '';
              const fileType = attachment.fileType || '';
              if (
                type === 'image' || 
                type.startsWith('image/') || 
                fileType?.startsWith('image/')
              ) {
                console.log(`Found image attachment: ${attachment.name}`);
                allAttachments.push({
                  id: attachment.id || `img-${Math.random().toString(36).substring(2)}`,
                  type: attachment.type,
                  url: attachment.url,
                  name: attachment.name,
                  size: attachment.size,
                  fileType: attachment.fileType,
                  thumbnailUrl: attachment.thumbnailUrl,
                  metadata: attachment.metadata
                });
              } else {
                console.log(`Skipping non-image attachment: ${attachment.name} (type: ${type}, fileType: ${fileType})`);
              }
            });
          }
        });
        
        console.log(`Found ${allAttachments.length} total image attachments`);
        return allAttachments;
      },
      
      // Group chat methods
      fetchGroups: async () => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          const response = await apiClient.get('groups');
          console.log('Raw response from GET /groups:', response.data);
          const fetchedGroups = response.data;
          
          // Process groups and update conversations state
          const updatedGroups: Record<string, Group> = {};
          const currentConversations = get().conversations;
          const updatedConversations = { ...currentConversations };

          for (const group of fetchedGroups) {
            // Ensure ID is normalized
            if (!group.id && group._id) {
              group.id = group._id;
            }
            if (!group.id) continue; // Skip groups without an ID

            updatedGroups[group.id] = group;

            // Ensure a conversation entry exists for this group
            if (!updatedConversations[group.id]) {
              updatedConversations[group.id] = {
                contactId: group.id,
                messages: [],
                isGroup: true,
                groupId: group.id,
                isPinned: false, // Default values
                isUnread: false,
              };
            } else {
              // Update existing group conversation with potentially new details
              updatedConversations[group.id] = {
                ...updatedConversations[group.id],
                isGroup: true,
                groupId: group.id,
                // Optionally update groupDetails if stored in conversation
                // groupDetails: group 
              };
            }
          }
          
          set({
            groups: updatedGroups,
            conversations: updatedConversations, // Update conversations too
            isLoading: false
          });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to fetch groups',
            isLoading: false
          });
        }
      },
      
      fetchGroup: async (groupId: string) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return null;
        }
        
        try {
          console.log(`Fetching group data for: ${groupId}`);
          const response = await apiClient.get(`/groups/${groupId}`);
          const group = response.data;
          
          // Ensure ID is properly normalized
          if (!group.id && group._id) {
            group.id = group._id;
          }
          
          set(state => ({
            groups: {
              ...state.groups,
              [groupId]: group
            }
          }));
          
          console.log(`Successfully fetched group: ${group.name} (${groupId})`);
          return group;
        } catch (error) {
          console.error(`Failed to fetch group ${groupId}:`, error);
          set({ 
            error: error instanceof Error ? error.message : `Failed to fetch group ${groupId}`,
          });
          return null;
        }
      },
      
      fetchMessagesForGroup: async (groupId: string) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          const response = await apiClient.get(`/groups/${groupId}/messages`);
          const messages = response.data.map((message: any) => {
            // Process attachments to ensure they follow the FileAttachment structure
            const attachments = (message.attachments || []).map((att: any) => {
              if (typeof att === 'object' && att !== null) {
                return {
                  type: att.type || 'file',
                  url: att.url || '',
                  name: att.name || 'Unknown file',
                  size: att.size,
                  fileType: att.fileType
                };
              }
              return att;
            });
            
            return {
              id: message.id || message._id,
              senderId: message.senderId || message.sender_id,
              receiverId: message.receiverId || message.recipient_id,
              text: message.text || '',
              timestamp: message.timestamp || message.created_at,
              status: message.status || 'sent',
              attachments: attachments,
              replyTo: message.reply_to,
              isEdited: message.is_edited || false,
              editedAt: message.edited_at,
              isDeleted: message.is_deleted || false,
              deletedAt: message.deleted_at,
              groupId
            };
          });
          
          const { conversations } = get();
          const existingConversation = conversations[groupId] || {};
          
          set({
            conversations: {
              ...conversations,
              [groupId]: {
                ...existingConversation,
                contactId: groupId, // Use groupId as the contactId for consistency
                messages,
                isPinned: existingConversation.isPinned || false,
                isUnread: existingConversation.isUnread || false,
                isGroup: true,
                groupId
              }
            },
            isLoading: false
          });
        } catch (error) {
          console.error(`Failed to fetch group messages for ${groupId}:`, error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to fetch group messages',
            isLoading: false
          });
        }
      },
      
      createGroup: async (name: string, memberIds: string[], description?: string, avatarUrl?: string) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return null;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          const response = await apiClient.post('groups', {
            name,
            member_ids: memberIds,
            description,
            avatar_url: avatarUrl
          });
          
          const group = response.data;
          
          // Ensure ID is properly extracted and normalized
          if (!group.id && group._id) {
            group.id = group._id;
          }
          
          if (!group.id) {
            console.error('Group created without ID:', group);
            set({ 
              error: 'Created group has no ID', 
              isLoading: false 
            });
            return null;
          }
          
          // Store the group in state
          set(state => ({
            groups: {
              ...state.groups,
              [group.id]: group
            },
            isLoading: false
          }));
          
          console.log(`Group created successfully with ID: ${group.id}`);
          return group;
        } catch (error) {
          console.error('Error creating group:', error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to create group',
            isLoading: false
          });
          return null;
        }
      },
      
      updateGroup: async (groupId: string, updates: Partial<Group>) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return null;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          const response = await apiClient.put(`groups/${groupId}`, updates);
          const updatedGroup = response.data;
          
          set(state => ({
            groups: {
              ...state.groups,
              [groupId]: updatedGroup
            },
            isLoading: false
          }));
          
          return updatedGroup;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to update group',
            isLoading: false
          });
          return null;
        }
      },
      
      addGroupMembers: async (groupId: string, memberIds: string[]) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return false;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          await apiClient.post(`groups/${groupId}/members`, {
            member_ids: memberIds
          });
          
          // Refresh group details
          const updatedGroup = await get().fetchGroup(groupId);
          
          set({ isLoading: false });
          return !!updatedGroup;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to add group members',
            isLoading: false
          });
          return false;
        }
      },
      
      removeGroupMember: async (groupId: string, memberId: string) => {
        const { user } = useAuthStore.getState();
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return false;
        }
        
        try {
          set({ isLoading: true, error: null });
          
          await apiClient.delete(`groups/${groupId}/members/${memberId}`);
          
          // Refresh group details
          const updatedGroup = await get().fetchGroup(groupId);
          
          set({ isLoading: false });
          return !!updatedGroup;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to remove group member',
            isLoading: false
          });
          return false;
        }
      },
      
      leaveGroup: async (groupId: string) => {
        const { user } = useAuthStore.getState();
        console.log(`Attempting to leave group: ${groupId}, User: ${user?.id}`);
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return false;
        }
        
        const userIdToRemove = user.id; // Use current user's ID for removal

        try {
          set({ isLoading: true, error: null });
          
          // Call the existing endpoint to remove the specific user (self)
          await apiClient.delete(`groups/${groupId}/members/${userIdToRemove}`); 
          console.log(`Successfully called API to leave group: ${groupId} (removed user ${userIdToRemove})`); 
          
          // Remove group from state (same logic as before)
          set(state => {
            const { [groupId]: _, ...remainingGroups } = state.groups;
            const { [groupId]: __, ...remainingConversations } = state.conversations;
            
            return {
              groups: remainingGroups,
              conversations: remainingConversations,
              isLoading: false,
              activeConversationId: state.activeConversationId === groupId ? null : state.activeConversationId
            };
          });
          
          return true;
        } catch (error) {
          console.error(`Failed to leave group ${groupId}:`, error); 
          set({ 
            error: error instanceof Error ? error.message : 'Failed to leave group',
            isLoading: false
          });
          return false;
        }
      },
      
      deleteGroup: async (groupId: string) => {
        const { user } = useAuthStore.getState();
        console.log(`Attempting to delete group: ${groupId}, User: ${user?.id}`);
        if (!user) {
          set({ error: 'User not authenticated', isLoading: false });
          return false;
        }

        const groupToDelete = get().groups[groupId];
        if (!groupToDelete || groupToDelete.created_by !== user.id) {
          console.warn(`Delete group check failed: Group found: ${!!groupToDelete}, Is owner: ${groupToDelete?.created_by === user.id}`);
          set({ error: 'User is not the owner or group not found', isLoading: false });
          return false; // Optional: Check ownership here too for safety
        }
        
        try {
          set({ isLoading: true, error: null });
          
          await apiClient.delete(`groups/${groupId}`);
          console.log(`Successfully called API to delete group: ${groupId}`);
          
          // Remove group from state
          set(state => {
            const { [groupId]: _, ...remainingGroups } = state.groups;
            const { [groupId]: __, ...remainingConversations } = state.conversations;
            
            return {
              groups: remainingGroups,
              conversations: remainingConversations,
              isLoading: false,
              // If active conversation is the group being deleted, clear it
              activeConversationId: state.activeConversationId === groupId ? null : state.activeConversationId
            };
          });
          
          return true;
        } catch (error) {
          console.error(`Failed to delete group ${groupId}:`, error);
          set({ 
            error: error instanceof Error ? error.message : 'Failed to delete group',
            isLoading: false
          });
          return false;
        }
      },
      
      sendGroupMessage: async (groupId: string, text: string, attachments = []) => {
        try {
          set({ isLoading: true, error: null });
          
          const { conversations } = get();
          if (!conversations[groupId]) {
            set({
              conversations: {
                ...conversations,
                [groupId]: { 
                  contactId: groupId, 
                  messages: [],
                  isGroup: true,
                  groupId
                }
              }
            });
          }
          
          // Use websocketService to send group message
          const messageId = await websocketService.sendGroupMessage(groupId, text, attachments);
          set({ isLoading: false });
          return messageId;
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to send group message',
            isLoading: false
          });
          return undefined;
        }
      },
      
      setActiveGroup: (groupId: string) => {
        set({ activeConversationId: groupId });
        
        const { conversations, groups } = get();
        const conversation = conversations[groupId];
        
        if (conversation) {
          if (conversation.isUnread) {
            get().markMessagesAsRead(groupId);
          }
        } else {
          // Create a new conversation entry for this group
          const group = groups[groupId];
          set({
            conversations: {
              ...conversations,
              [groupId]: { 
                contactId: groupId, 
                messages: [],
                isGroup: true,
                groupId,
                groupDetails: group
              }
            }
          });
          
          // Fetch messages for this group
          get().fetchMessagesForGroup(groupId);
        }
      }
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({
        conversations: state.conversations,
        groups: state.groups,
      }),
    }
  )
);

export { useChatStore };