import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '../services/apiClient';
import websocketService from '../services/websocketService';
import { useAuthStore } from './authStore';

export interface Reaction {
  userId: string;
  reaction: string;
  timestamp: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number | string;
  status: 'sent' | 'delivered' | 'read';
  attachments?: any[];
  reactions?: Reaction[];
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
  updateContactStatus: (contactId: string, status: 'online' | 'offline' | 'away') => void;
  clearError: () => void;
  
  pinConversation: (contactId: string, isPinned: boolean) => Promise<void>;
  markConversationAsUnread: (contactId: string, isUnread: boolean) => Promise<void>;
  deleteConversation: (contactId: string) => Promise<void>;
  
  addReaction: (messageId: string, contactId: string, reaction: string) => Promise<boolean>;
  removeReaction: (messageId: string, contactId: string, reaction: string) => Promise<boolean>;
  updateMessageReaction: (messageId: string, senderId: string, contactId: string, reaction: string, action: 'add' | 'remove') => void;
  editMessage: (messageId: string, contactId: string, text: string) => Promise<boolean>;
  updateEditedMessage: (messageId: string, contactId: string, text: string, editedAt: string) => void;
  deleteMessage: (messageId: string, contactId: string) => Promise<boolean>;
  updateDeletedMessage: (messageId: string, contactId: string) => void;
  sendReply: (contactId: string, text: string, replyToMessageId: string, attachments?: any[]) => Promise<void>;
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
            const lastMessage = unreadMessages[unreadMessages.length - 1];
            websocketService.sendReadReceipt(contactId, lastMessage.id);
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
        try {
          set({ isLoading: true, error: null });
          
          const { user } = useAuthStore.getState();
          if (!user) {
            set({ error: 'User not authenticated', isLoading: false });
            return;
          }
          
          const response = await apiClient.get(`/chats/${contactId}`);
          const messages = response.data.map((message: any) => ({
            id: message.id || message._id,
            senderId: message.senderId || message.sender_id,
            receiverId: message.receiverId || message.recipient_id,
            text: message.text || '',
            timestamp: message.timestamp || message.created_at,
            status: message.status || 'sent',
            attachments: message.attachments || [],
            reactions: message.reactions?.map((r: any) => ({
              userId: r.user_id,
              reaction: r.reaction,
              timestamp: r.created_at || new Date().toISOString()
            })) || [],
            replyTo: message.reply_to,
            isEdited: message.is_edited || false,
            editedAt: message.edited_at,
            isDeleted: message.is_deleted || false,
            deletedAt: message.deleted_at
          }));
          
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
          
          const messageId = websocketService.sendMessage(contactId, text, attachments);
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
        
        if (activeConversationId === contactId && 
            message.senderId !== user.id && 
            document?.visibilityState === 'visible') {
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
        set({
          typingIndicators: {
            ...get().typingIndicators,
            [contactId]: isTyping
          }
        });
      },
      
      updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => {
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => 
          message.id === messageId ? { ...message, status } : message
        );
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: updatedMessages
            }
          }
        });
      },
      
      updateContactStatus: (contactId: string, status: 'online' | 'offline' | 'away') => {
        console.log(`[Chat] Contact ${contactId} status updated to ${status}`);
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
      
      addReaction: async (messageId: string, contactId: string, reaction: string) => {
        const { user } = useAuthStore.getState();
        if (!user) return false;
        
        try {
          websocketService.sendReaction(contactId, messageId, reaction, 'add');
          
          const { conversations } = get();
          const conversation = conversations[contactId];
          
          if (!conversation) return false;
          
          const updatedMessages = conversation.messages.map(message => {
            if (message.id === messageId) {
              const reactions = message.reactions || [];
              const existingReaction = reactions.find(r => r.userId === user.id && r.reaction === reaction);
              
              if (!existingReaction) {
                return {
                  ...message,
                  reactions: [
                    ...reactions,
                    {
                      userId: user.id,
                      reaction,
                      timestamp: new Date().toISOString()
                    }
                  ]
                };
              }
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
          console.error('Error adding reaction:', error);
          return false;
        }
      },
      
      removeReaction: async (messageId: string, contactId: string, reaction: string) => {
        const { user } = useAuthStore.getState();
        if (!user) return false;
        
        try {
          websocketService.sendReaction(contactId, messageId, reaction, 'remove');
          
          const { conversations } = get();
          const conversation = conversations[contactId];
          
          if (!conversation) return false;
          
          const updatedMessages = conversation.messages.map(message => {
            if (message.id === messageId && message.reactions) {
              return {
                ...message,
                reactions: message.reactions.filter(r => !(r.userId === user.id && r.reaction === reaction))
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
          console.error('Error removing reaction:', error);
          return false;
        }
      },
      
      updateMessageReaction: (messageId: string, senderId: string, contactId: string, reaction: string, action: 'add' | 'remove') => {
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === messageId) {
            const reactions = message.reactions || [];
            
            if (action === 'add') {
              const existingReaction = reactions.find(r => r.userId === senderId && r.reaction === reaction);
              
              if (!existingReaction) {
                return {
                  ...message,
                  reactions: [
                    ...reactions,
                    {
                      userId: senderId,
                      reaction,
                      timestamp: new Date().toISOString()
                    }
                  ]
                };
              }
            } else {
              return {
                ...message,
                reactions: reactions.filter(r => !(r.userId === senderId && r.reaction === reaction))
              };
            }
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
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === messageId) {
            return {
              ...message,
              text,
              isEdited: true,
              editedAt
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
                messages: updatedMessages
              }
            }
          });
          
          return true;
        } catch (error) {
          console.error('Error deleting message:', error);
          return false;
        }
      },
      
      updateDeletedMessage: (messageId: string, contactId: string) => {
        const { conversations } = get();
        const conversation = conversations[contactId];
        
        if (!conversation) return;
        
        const updatedMessages = conversation.messages.map(message => {
          if (message.id === messageId) {
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
              messages: updatedMessages
            }
          }
        });
      },
      
      sendReply: async (contactId: string, text: string, replyToMessageId: string, attachments = []) => {
        try {
          set({ isLoading: true, error: null });
          
          const { user } = useAuthStore.getState();
          if (!user) {
            set({ error: 'User not authenticated', isLoading: false });
            return;
          }
          
          websocketService.sendReply(contactId, text, replyToMessageId, attachments);
          
          set({ isLoading: false });
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Failed to send reply',
            isLoading: false
          });
        }
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