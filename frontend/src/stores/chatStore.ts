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
    if (!conversations[contactId]) {
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
        attachments: message.attachments || []
      }));
      
      const { conversations } = get();
      const existingConversation = conversations[contactId] || {};
      
      set({
        conversations: {
          ...conversations,
          [contactId]: {
            ...existingConversation,
            contactId,
            messages
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
    
    const updatedConversations = {
      ...conversations,
      [contactId]: {
        ...conversation,
        messages: [...conversation.messages, formattedMessage]
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
              lastReadMessageId: lastMessage.id
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
  
  clearError: () => set({ error: null })
}));

export { useChatStore };