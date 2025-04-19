import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import websocketService from '../services/websocketService';
import { useAuthStore } from './authStore';
import { useContactsStore } from './contactsStore';
import { PresenceState } from '../services/presenceManager';
import { Attachment } from '../types';

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
  status: 'sent' | 'delivered' | 'read';
  attachments?: FileAttachment[];
  replyTo?: string;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

export interface Conversation {
  contactId: string;
  messages: Message[];
  lastReadMessageId?: string;
  isPinned?: boolean;
  isUnread?: boolean;
  _lastUpdated?: number;
  contactStatus?: PresenceState;
}

interface ChatState {
  activeConversationId: string | null;
  conversations: Record<string, Conversation>;
  isLoading: boolean;
  error: string | null;
  typingIndicators: Record<string, boolean>;
  
  setActiveConversation: (contactId: string) => void;
  fetchMessagesForContact: (contactId: string) => Promise<void>;
  sendMessage: (contactId: string, text: string, attachments?: any[]) => Promise<string | undefined>;
  addMessage: (message: Message) => void;
  markMessagesAsRead: (contactId: string) => Promise<void>;
  setTypingIndicator: (contactId: string, isTyping: boolean) => void;
  updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => void;
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
}

const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      activeConversationId: null,
      conversations: {},
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
      
      updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => {
        const msgId = String(messageId);
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === msgId) {
            if (message.status !== status || status === 'read') {
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
      }
    }),
    {
      name: 'chat-storage',
      partialize: (state) => ({
        conversations: Object.entries(state.conversations).reduce((acc, [contactId, conversation]) => {
          acc[contactId] = { 
            contactId, 
            isPinned: conversation.isPinned || false,
            messages: [] 
          };
          return acc;
        }, {} as Record<string, Conversation>)
      }),
    }
  )
);

export { useChatStore };