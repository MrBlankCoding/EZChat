import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import ContactList from '../components/ContactList';
import ChatWindow from '../components/ChatWindow';
import websocketService from '../services/websocketService';

const ChatPage = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const { user } = useAuthStore();
  const { activeConversationId, setActiveConversation, fetchMessagesForContact } = useChatStore();
  const { contacts, fetchContacts } = useContactsStore();
  const [isLoading, setIsLoading] = useState(true);
  
  // Set active conversation based on URL param
  useEffect(() => {
    if (contactId) {
      setActiveConversation(contactId);
    } else if (activeConversationId === null && contacts.length > 0) {
      // If no active conversation, set the first contact as active
      setActiveConversation(contacts[0].contact_id);
    }
  }, [contactId, contacts, activeConversationId, setActiveConversation]);
  
  // Connect to WebSocket when component mounts
  useEffect(() => {
    if (user) {
      websocketService.connect();
    }
    
    // Cleanup WebSocket connection when component unmounts
    return () => {
      websocketService.disconnect();
    };
  }, [user]);
  
  // Fetch contacts and messages on initial load
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        // Fetch contacts
        await fetchContacts();
        
        // If there's an active conversation or contactId in URL, fetch messages
        if (contactId) {
          await fetchMessagesForContact(contactId);
        }
      } catch (error) {
        console.error('Error fetching initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchInitialData();
  }, [fetchContacts, fetchMessagesForContact, contactId]);
  
  return (
    <div className="h-full flex">
      <Sidebar />
      
      <div className="flex-1 flex overflow-hidden">
        <ContactList />
        
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading conversations...</p>
            </div>
          </div>
        ) : activeConversationId ? (
          <ChatWindow contactId={activeConversationId} />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center max-w-md px-4">
              <h3 className="text-lg font-medium text-gray-900">No conversation selected</h3>
              <p className="mt-1 text-sm text-gray-500">
                {contacts.length > 0 
                  ? 'Select a contact from the list to start chatting' 
                  : 'Add a contact to start chatting'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;