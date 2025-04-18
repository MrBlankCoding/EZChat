import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import ChatsList from '../components/ChatsList';
import ChatWindow from '../components/ChatWindow';
import websocketService from '../services/websocketService';

const ChatPage = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const { user } = useAuthStore();
  const { activeConversationId, setActiveConversation, fetchMessagesForContact } = useChatStore();
  const { contacts, fetchContacts } = useContactsStore();
  const [isLoading, setIsLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState({ state: 'unknown', readyState: 'unknown' });
  
  // Set active conversation based on URL param
  useEffect(() => {
    if (contactId) {
      setActiveConversation(contactId);
    } else if (activeConversationId === null) {
      // Don't automatically set the first contact as active
      // Let the user explicitly choose a chat
    }
  }, [contactId, activeConversationId, setActiveConversation]);
  
  // Function to check and update WebSocket connection status
  const checkWsConnection = useCallback(async () => {
    if (user) {
      try {
        // Force reconnect if there's an issue
        await websocketService.testConnection();
        // Get updated status
        const status = websocketService.getConnectionState();
        setWsStatus(status);
        console.log('[ChatPage] WebSocket Status:', status);
        
        // If we still have connection issues, try more drastic measures
        if (status.state !== 'connected' || status.readyState !== 'OPEN') {
          console.log('[ChatPage] Connection still problematic, forcing full reconnect');
          websocketService.disconnect();
          // Small delay to ensure complete disconnect
          await new Promise(resolve => setTimeout(resolve, 1000));
          await websocketService.connect();
          
          // Get status after forced reconnect
          const newStatus = websocketService.getConnectionState();
          setWsStatus(newStatus);
          console.log('[ChatPage] WebSocket Status after forced reconnect:', newStatus);
        }
      } catch (error) {
        console.error('[ChatPage] WebSocket connection check failed:', error);
      }
    }
  }, [user]);
  
  // Connect to WebSocket when component mounts and periodically check connection
  useEffect(() => {
    if (user) {
      // Initial connection
      websocketService.connect();
      
      // Check connection immediately
      checkWsConnection();
      
      // Set up periodic check (every 30 seconds)
      const intervalId = setInterval(checkWsConnection, 30000);
      
      // Cleanup WebSocket connection and interval when component unmounts
      return () => {
        clearInterval(intervalId);
        websocketService.disconnect();
      };
    }
  }, [user, checkWsConnection]);
  
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
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-950 transition-colors duration-200">
      {/* WebSocket status indicator */}
      {wsStatus.state !== 'connected' && (
        <div className="bg-yellow-100 dark:bg-yellow-900 p-2 text-center text-sm">
          <span className="font-medium">WebSocket disconnected!</span> Messages won't be delivered in real-time. 
          <button 
            onClick={checkWsConnection}
            className="ml-2 underline"
          >
            Try reconnect
          </button>
        </div>
      )}
      
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
            <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
              <div className="text-center max-w-md px-4 animate-fade-in">
                <svg 
                  className="h-16 w-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" 
                  xmlns="http://www.w3.org/2000/svg" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="text-xl font-medium text-gray-900 dark:text-white">No conversation selected</h3>
                <p className="mt-2 text-base text-gray-500 dark:text-gray-400">
                  {contacts.length > 0 
                    ? 'Select a chat from the list to start messaging' 
                    : 'Add a contact to start your first conversation'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;