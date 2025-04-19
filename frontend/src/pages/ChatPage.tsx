import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import ChatsList from '../components/ChatsList';
import ChatWindow from '../components/ChatWindow';
import PendingContactsView from '../components/PendingContactsView';
import websocketService from '../services/websocketService';

const ChatPage = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const { user } = useAuthStore();
  const { 
    activeConversationId, 
    conversations, 
    groups,
    fetchMessagesForContact, 
    setActiveConversation,
    setActiveGroup,
    fetchGroup
  } = useChatStore();
  const { contacts, fetchContacts, fetchPendingContacts, fetchSentPendingContacts } = useContactsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState({ state: 'unknown', readyState: 'unknown' });
  const [isContactListOpen, setIsContactListOpen] = useState(false);
  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);
  
  // Determine if contactId is a group or direct chat, then set active conversation accordingly
  useEffect(() => {
    const setActiveChat = async () => {
      if (!contactId) return;
      
      // Check if this is a group by checking if it exists in groups
      const isGroup = !!groups[contactId];
      
      // If it's a group, use setActiveGroup, otherwise use setActiveConversation
      if (isGroup) {
        console.log(`Setting active group: ${contactId}`);
        setActiveGroup(contactId);
      } 
      // Check if it's a contact
      else if (contacts.some(c => c.contact_id === contactId)) {
        console.log(`Setting active conversation: ${contactId}`);
        setActiveConversation(contactId);
      }
      // If it's neither in groups nor contacts, it might be a newly created group
      // Try to fetch the group first
      else {
        console.log(`Checking if ${contactId} is a group...`);
        try {
          const group = await fetchGroup(contactId);
          if (group) {
            console.log(`Found group ${contactId}, setting as active`);
            setActiveGroup(contactId);
          } else {
            console.log(`No group found, setting as conversation: ${contactId}`);
            setActiveConversation(contactId);
          }
        } catch (error) {
          console.error(`Error checking group status for ${contactId}:`, error);
          // Fall back to setting as a conversation
          setActiveConversation(contactId);
        }
      }
    };
    
    setActiveChat();
  }, [contactId, groups, contacts, setActiveConversation, setActiveGroup, fetchGroup]);
  
  // Function to check and update WebSocket connection status
  const checkWsConnection = async () => {
    if (user) {
      try {
        // Get updated status
        const status = websocketService.getConnectionState();
        setWsStatus(status);
      } catch (error) {
        console.error('[ChatPage] WebSocket connection check failed:', error);
      }
    }
  };
  
  // Periodically check WebSocket connection status
  useEffect(() => {
    if (user) {
      // Check connection immediately
      checkWsConnection();
      
      // Set up periodic check (every 30 seconds)
      const intervalId = setInterval(checkWsConnection, 30000);
      
      // Cleanup interval when component unmounts
      return () => {
        clearInterval(intervalId);
      };
    }
  }, [user]);
  
  // Fetch data when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      if (user) {
        setIsMessagesLoaded(false);
        
        // Fetch all contacts
        await fetchContacts();
        await fetchPendingContacts();
        await fetchSentPendingContacts();
        
        setIsMessagesLoaded(true);
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [fetchContacts, fetchPendingContacts, fetchSentPendingContacts, user]);
  
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-950 transition-colors duration-200">
      {/* WebSocket status indicator */}
      {/* WebSocket disconnection message removed */}
      
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <div className="flex-1 flex overflow-hidden">
          <ChatsList />
          
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 dark:border-secondary-500 mx-auto"></div>
                <p className="mt-2 text-gray-600 dark:text-gray-300">Loading conversations...</p>
              </div>
            </div>
          ) : activeConversationId ? (
            <ChatWindow contactId={activeConversationId} />
          ) : (
            <PendingContactsView />
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;