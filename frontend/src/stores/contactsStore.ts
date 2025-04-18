import { create } from 'zustand';
import apiClient from '../services/apiClient';

// Contact types
export enum ContactStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  BLOCKED = 'blocked'
}

export interface Contact {
  _id: string;       // This is what the MongoDB backend sends
  id?: string;       // This might exist in some legacy code
  user_id: string;
  contact_id: string;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
  contact_email: string;
  contact_display_name: string;
  contact_avatar_url?: string;
  contact_status: string;
}

// Store state interface
interface ContactsState {
  contacts: Contact[];
  pendingContacts: Contact[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchContacts: () => Promise<void>;
  fetchPendingContacts: () => Promise<void>;
  addContact: (userId: string) => Promise<void>;
  acceptContact: (contactId: string) => Promise<void>;
  blockContact: (contactId: string) => Promise<void>;
  deleteContact: (contactId: string) => Promise<void>;
  clearError: () => void;
}

// Create the contacts store
const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  pendingContacts: [],
  isLoading: false,
  error: null,
  
  // Fetch all accepted contacts
  fetchContacts: async () => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiClient.get('/contacts');
      set({ contacts: response.data, isLoading: false });
    } catch (error) {
      console.error('Error fetching contacts:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch contacts',
        isLoading: false
      });
    }
  },
  
  // Fetch pending contact requests
  fetchPendingContacts: async () => {
    try {
      set({ isLoading: true, error: null });
      const response = await apiClient.get('/contacts/pending');
      set({ pendingContacts: response.data, isLoading: false });
    } catch (error) {
      console.error('Error fetching pending contacts:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to fetch pending contacts',
        isLoading: false
      });
    }
  },
  
  // Add a new contact
  addContact: async (contactId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      // Get current user ID from the first contact or from auth store
      const { contacts } = get();
      const userId = contacts.length > 0 
        ? contacts[0].user_id 
        : (await import('./authStore')).useAuthStore.getState().user?.id;
      
      if (!userId) {
        throw new Error('User not authenticated');
      }
      
      const response = await apiClient.post('/contacts', {
        user_id: userId,
        contact_id: contactId,
        status: ContactStatus.PENDING
      });
      
      // Refresh contacts and pending contacts
      await get().fetchContacts();
      await get().fetchPendingContacts();
      
      set({ isLoading: false });
    } catch (error) {
      console.error('Error adding contact:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to add contact',
        isLoading: false
      });
    }
  },
  
  // Accept a contact request
  acceptContact: async (contactId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (!contactId || contactId === 'undefined') {
        throw new Error('Invalid contact ID');
      }
      
      console.log('Accepting contact with ID:', contactId);
      
      await apiClient.put(`/contacts/${contactId}`, {
        status: ContactStatus.ACCEPTED
      });
      
      // Refresh contacts and pending contacts
      await get().fetchContacts();
      await get().fetchPendingContacts();
      
      set({ isLoading: false });
    } catch (error) {
      console.error('Error accepting contact:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to accept contact',
        isLoading: false
      });
      throw error; // Re-throw so it can be caught by the component
    }
  },
  
  // Block a contact
  blockContact: async (contactId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (!contactId || contactId === 'undefined') {
        throw new Error('Invalid contact ID');
      }
      
      await apiClient.put(`/contacts/${contactId}`, {
        status: ContactStatus.BLOCKED
      });
      
      // Refresh contacts
      await get().fetchContacts();
      
      set({ isLoading: false });
    } catch (error) {
      console.error('Error blocking contact:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to block contact',
        isLoading: false
      });
    }
  },
  
  // Delete a contact
  deleteContact: async (contactId: string) => {
    try {
      set({ isLoading: true, error: null });
      
      if (!contactId || contactId === 'undefined') {
        throw new Error('Invalid contact ID');
      }
      
      await apiClient.delete(`/contacts/${contactId}`);
      
      // Refresh contacts and pending contacts
      await get().fetchContacts();
      await get().fetchPendingContacts();
      
      set({ isLoading: false });
    } catch (error) {
      console.error('Error deleting contact:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to delete contact',
        isLoading: false
      });
    }
  },
  
  // Clear error
  clearError: () => set({ error: null })
}));

export { useContactsStore }; 