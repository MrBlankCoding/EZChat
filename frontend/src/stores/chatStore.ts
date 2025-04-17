import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { Contact } from './contactsStore';

// Message types
export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
  attachments?: any[];
}

// Conversation type
export interface Conversation {
  contactId: string;
  messages: Message[];
  lastReadMessageId?: string;
}

// ChatStore interface
interface ChatState {
  activeConversationId: string | null;
  conversations: Record<string, Conversation>;
  isLoading: boolean;
  error: string | null;
  typingIndicators: Record<string, boolean>;
  
  // Actions
  setActiveConversation: (contactId: string) => void;
  fetchMessagesForContact: (contactId: string) => Promise<void>;
  sendMessage: (contactId: string, text: string, attachments?: any[]) => Promise<void>;
  addMessage: (message: Message) => void;
  markMessagesAsRead: (contactId: string) => Promise<void>;
  setTypingIndicator: (contactId: string, isTyping: boolean) => void;
  clearError: () => void;
}

// Create the store
const useChatStore = create<ChatState>((set, get) => ({
  activeConversationId: null,
  conversations: {},
  isLoading: false,
  error: null,
  typingIndicators: {},
  
  // Set active conversation
  setActiveConversation: (contactId: string) => {
    set({ activeConversationId: contactId });
    
    // Initialize conversation if it doesn't exist
    const { conversations } = get();
    if (!conversations[contactId]) {
      set({
        conversations: {
          ...conversations,
          [contactId]: {
            contactId,
            messages: []
          }
        }
      });
      
      // Fetch messages for this contact
      get().fetchMessagesForContact(contactId);
    }
  },
  
  // Fetch messages for a specific contact
  fetchMessagesForContact: async (contactId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      const response = await apiClient.get(`/chats/${contactId}/messages`);
      const messages = response.data;
      
      // Update conversation
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
      console.error('Error fetching messages:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch messages',
        isLoading: false
      });
    }
  },
  
  // Send a message
  sendMessage: async (contactId: string, text: string, attachments = []) => {
    try {
      set({ isLoading: true, error: null });
      
      // Create a temporary message
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        senderId: 'current-user', // This would normally come from auth store
        receiverId: contactId,
        text,
        timestamp: Date.now(),
        status: 'sent',
        attachments
      };
      
      // Add to conversation
      get().addMessage(tempMessage);
      
      // Send to API
      const response = await apiClient.post(`/chats/${contactId}/messages`, {
        text,
        attachments
      });
      
      // Update with real message data from server
      const realMessage = response.data;
      
      // Replace temp message with real one
      const { conversations } = get();
      const conversation = conversations[contactId];
      
      if (conversation) {
        const updatedMessages = conversation.messages.map(msg => 
          msg.id === tempMessage.id ? realMessage : msg
        );
        
        set({
          conversations: {
            ...conversations,
            [contactId]: {
              ...conversation,
              messages: updatedMessages
            }
          },
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to send message',
        isLoading: false
      });
    }
  },
  
  // Add a message to a conversation
  addMessage: (message: Message) => {
    const contactId = message.senderId === 'current-user' 
      ? message.receiverId 
      : message.senderId;
    
    const { conversations } = get();
    const conversation = conversations[contactId] || { contactId, messages: [] };
    
    set({
      conversations: {
        ...conversations,
        [contactId]: {
          ...conversation,
          messages: [...conversation.messages, message]
        }
      }
    });
  },
  
  // Mark messages as read
  markMessagesAsRead: async (contactId: string) => {
    try {
      const { conversations } = get();
      const conversation = conversations[contactId];
      
      if (!conversation || conversation.messages.length === 0) return;
      
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      
      // Only mark if the last message is from the contact
      if (lastMessage.senderId === contactId) {
        await apiClient.post(`/chats/${contactId}/read`, {
          messageId: lastMessage.id
        });
        
        // Update conversation
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
      console.error('Error marking messages as read:', error);
    }
  },
  
  // Set typing indicator
  setTypingIndicator: (contactId: string, isTyping: boolean) => {
    set({
      typingIndicators: {
        ...get().typingIndicators,
        [contactId]: isTyping
      }
    });
  },
  
  // Clear error
  clearError: () => set({ error: null })
}));

export { useChatStore }; 