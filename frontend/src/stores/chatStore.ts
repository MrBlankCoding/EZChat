import { create } from 'zustand';
import apiClient from '../services/apiClient';
import websocketService from '../services/websocketService';
import { useAuthStore } from './authStore';

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number | string;
  status: 'sent' | 'delivered' | 'read';
  attachments?: any[];
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
  updateContactStatus: (userId: string, status: string) => void;
  updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => void;
  clearError: () => void;
  
  pinConversation: (contactId: string, isPinned: boolean) => Promise<void>;
  markConversationAsUnread: (contactId: string, isUnread: boolean) => Promise<void>;
  deleteConversation: (contactId: string) => Promise<void>;
}

const useChatStore = create<ChatState>((set, get) => ({
  activeConversationId: null,
  conversations: {},
  isLoading: false,
  error: null,
  typingIndicators: {},
  
  setActiveConversation: (contactId: string) => {
    set({ activeConversationId: contactId });
    
    const { conversations } = get();
    
    // Only fetch messages for this contact if they don't exist already,
    // but don't create an empty conversation entry
    if (conversations[contactId]) {
      // If we already have a conversation, mark it as read if unread
      if (conversations[contactId]?.isUnread) {
        get().markConversationAsUnread(contactId, false);
      }
    } else {
      // Only fetch messages if there's an existing conversation
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
        attachments: message.attachments || []
      }));
      
      // Only create/update a conversation if there are messages
      if (messages.length > 0) {
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
      } else {
        set({ isLoading: false });
      }
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
      
      // Ensure the conversation exists before sending a message
      const { conversations } = get();
      if (!conversations[contactId]) {
        // Create a new conversation entry with empty messages array
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
    
    const updatedConversations = {
      ...conversations,
      [contactId]: {
        ...conversation,
        messages: [...conversation.messages, formattedMessage],
        isUnread: shouldMarkAsUnread ? true : conversation.isUnread
      }
    };
    
    set({ conversations: updatedConversations });
    
    if (activeConversationId === contactId && message.senderId !== user.id) {
      websocketService.sendReadReceipt(contactId, message.id);
    }
  },
  
  markMessagesAsRead: async (contactId: string) => {
    try {
      const { conversations } = get();
      const conversation = conversations[contactId];
      
      if (!conversation?.messages.length) return;
      
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      
      if (lastMessage.senderId === contactId) {
        await apiClient.post(`/chats/${contactId}/read`, { messageId: lastMessage.id });
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              lastReadMessageId: lastMessage.id,
              isUnread: false
            }
          }
        });
      }
    } catch (error) {
      // Error handling without state change
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
  
  updateContactStatus: (userId: string, status: string) => {
    // Stub for contact status updates
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
      // First, immediately update the UI by clearing the messages from the conversation
      const { conversations, activeConversationId } = get();
      
      // Create a copy with an empty messages array for this contact
      const updatedConversations = { ...conversations };
      if (updatedConversations[contactId]) {
        updatedConversations[contactId] = {
          ...updatedConversations[contactId],
          messages: [],
          isPinned: false,
          isUnread: false
        };
      }
      
      // If the deleted conversation was active, set activeConversationId to null
      const newActiveId = activeConversationId === contactId ? null : activeConversationId;
      
      // Update the state immediately - don't wait for the API call
      set({
        conversations: updatedConversations,
        activeConversationId: newActiveId,
        isLoading: true,
        error: null
      });
      
      // Then make the API call to delete the conversation on the server
      await apiClient.delete(`/chats/conversation/${contactId}`);
      
      // When API call completes, clear loading state
      set({ isLoading: false });
    } catch (error) {
      // If there's an error, set the error message but don't restore the conversation
      // This maintains immediate UI feedback even if the backend operation fails
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete conversation',
        isLoading: false
      });
    }
  }
}));

export { useChatStore };