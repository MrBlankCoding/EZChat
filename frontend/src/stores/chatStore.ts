import { create } from 'zustand';
import apiClient from '../services/apiClient';
import { Contact } from './contactsStore';
import websocketService from '../services/websocketService';
import { useAuthStore } from './authStore';

// Message types
export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  timestamp: number | string;
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
  sendMessage: (contactId: string, text: string, attachments?: any[]) => Promise<string | undefined>;
  addMessage: (message: Message) => void;
  markMessagesAsRead: (contactId: string) => Promise<void>;
  setTypingIndicator: (contactId: string, isTyping: boolean) => void;
  updateContactStatus: (userId: string, status: string) => void;
  updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => void;
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
      
      const { user } = useAuthStore.getState();
      if (!user) {
        console.error('Cannot fetch messages: User not authenticated');
        set({ 
          error: 'User not authenticated',
          isLoading: false
        });
        return;
      }
      
      // Log the request before making it
      console.log(`Fetching messages for contact: ${contactId}`);
      
      // Fix URL path - remove duplicate /api prefix
      const response = await apiClient.get(`/chats/${contactId}`);
      let messages = response.data;
      
      console.log(`Received ${messages.length} messages from API:`, messages);
      
      // Transform API response to match our frontend Message format
      messages = messages.map((message: any) => {
        return {
          id: message.id || message._id,
          senderId: message.senderId || message.sender_id,
          receiverId: message.receiverId || message.recipient_id,
          text: message.text || '',
          timestamp: message.timestamp || message.created_at,
          status: message.status || 'sent',
          attachments: message.attachments || []
        };
      });
      
      // Log the transformed messages
      console.log('Transformed messages:', messages);
      
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
      
      // Use websocketService instead of direct API call
      const messageId = websocketService.sendMessage(contactId, text, attachments);
      
      // Note: The message is already added to the store by websocketService.sendMessage
      set({ isLoading: false });
      return messageId;
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
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    // Determine the correct contactId based on whether the current user is the sender or receiver
    const contactId = message.senderId === user.id 
      ? message.receiverId 
      : message.senderId;
    
    console.log('Adding message to conversation:', {
      messageId: message.id,
      senderId: message.senderId,
      receiverId: message.receiverId,
      contactId
    });
    
    const { conversations } = get();
    const conversation = conversations[contactId] || { contactId, messages: [] };
    
    // Check if message already exists to avoid duplicates
    const messageExists = conversation.messages.some(m => m.id === message.id);
    if (messageExists) return;
    
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
  
  // Update contact status
  updateContactStatus: (userId: string, status: string) => {
    // This would typically notify another store to update the contact status
    // We can just log it for now
    console.log(`Updating status for user ${userId} to ${status}`);
    // This would be implemented to sync with contactsStore if needed
  },
  
  // Update message status (delivered or read)
  updateMessageStatus: (messageId: string, contactId: string, status: 'delivered' | 'read') => {
    const { conversations } = get();
    const conversation = conversations[contactId];
    
    if (!conversation) return;
    
    // Find and update the message
    const updatedMessages = conversation.messages.map(message => 
      message.id === messageId ? { ...message, status } : message
    );
    
    // Update the conversation
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
  
  // Clear error
  clearError: () => set({ error: null })
}));

export { useChatStore }; 