import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore, Contact as ContactType } from '../stores/contactsStore';
import { MagnifyingGlassIcon, UserPlusIcon, BellIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import AddContact from './AddContact';

const ContactList = () => {
  const navigate = useNavigate();
  const { activeConversationId, setActiveConversation, conversations } = useChatStore();
  const { contacts, pendingContacts, fetchContacts, fetchPendingContacts } = useContactsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  
  // Fetch contacts when component mounts
  useEffect(() => {
    fetchContacts();
    fetchPendingContacts();
    
    // Set up a refresh interval
    const interval = setInterval(() => {
      fetchContacts();
      fetchPendingContacts();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [fetchContacts, fetchPendingContacts]);
  
  const handleContactClick = (contactId: string) => {
    setActiveConversation(contactId);
    navigate(`/chat/${contactId}`);
  };
  
  // Convert contacts to chat-compatible format
  const chatContacts = contacts.map(contact => ({
    id: contact.contact_id,
    displayName: contact.contact_display_name,
    email: contact.contact_email,
    photoURL: contact.contact_avatar_url,
    status: contact.contact_status,
    unreadCount: 0, // This would come from the chat store
    isTyping: false // This would come from the chat store
  }));
  
  const filteredContacts = chatContacts.filter(contact => {
    if (!searchQuery) return true;
    
    const searchLower = searchQuery.toLowerCase();
    return (
      contact.displayName.toLowerCase().includes(searchLower) ||
      contact.email.toLowerCase().includes(searchLower)
    );
  });
  
  // Get the last message for each contact to display in the list
  const getLastMessage = (contactId: string) => {
    const conversation = conversations[contactId];
    if (!conversation || conversation.messages.length === 0) return null;
    
    return conversation.messages[conversation.messages.length - 1];
  };
  
  return (
    <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Contacts</h2>
          <div className="flex space-x-2">
            {pendingContacts.length > 0 && (
              <button
                className="relative p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                onClick={() => setShowAddContact(true)}
              >
                <BellIcon className="h-5 w-5 text-gray-600" />
                <span className="absolute top-0 right-0 h-3.5 w-3.5 bg-red-500 rounded-full text-[10px] flex items-center justify-center text-white">
                  {pendingContacts.length}
                </span>
              </button>
            )}
            <button
              className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              onClick={() => setShowAddContact(true)}
            >
              <UserPlusIcon className="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="relative rounded-md shadow-sm">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </div>
          <input
            type="text"
            name="search"
            id="search"
            className="focus:ring-primary-500 focus:border-primary-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md"
            placeholder="Search contacts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-gray-200">
          {filteredContacts.length === 0 ? (
            <li className="p-4 text-center text-gray-500">
              {contacts.length === 0 
                ? 'No contacts yet. Add your first contact!' 
                : 'No contacts found matching your search'}
            </li>
          ) : (
            filteredContacts.map((contact) => {
              const lastMessage = getLastMessage(contact.id);
              
              return (
                <li
                  key={contact.id}
                  className={`hover:bg-gray-50 cursor-pointer ${
                    activeConversationId === contact.id ? 'bg-gray-100' : ''
                  }`}
                  onClick={() => handleContactClick(contact.id)}
                >
                  <div className="px-4 py-4 flex items-center sm:px-6">
                    <div className="min-w-0 flex-1 flex items-center">
                      <div className="flex-shrink-0 relative">
                        <img
                          className="h-12 w-12 rounded-full object-cover"
                          src={contact.photoURL || 'https://via.placeholder.com/150'}
                          alt={contact.displayName}
                        />
                        <div
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${
                            contact.status === 'online'
                              ? 'bg-green-500'
                              : contact.status === 'away'
                              ? 'bg-yellow-500'
                              : 'bg-gray-500'
                          }`}
                        ></div>
                      </div>
                      <div className="min-w-0 flex-1 px-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-gray-900 truncate">{contact.displayName}</p>
                          {lastMessage && (
                            <p className="text-xs text-gray-500">
                              {(() => {
                                try {
                                  // Check if timestamp is a valid date value
                                  if (!lastMessage.timestamp) return '';
                                  // Parse the timestamp correctly - handle both string and number formats
                                  const date = typeof lastMessage.timestamp === 'string' 
                                    ? new Date(lastMessage.timestamp) 
                                    : new Date(Number(lastMessage.timestamp));
                                  
                                  // Validate that the date is valid before formatting
                                  if (isNaN(date.getTime())) return '';
                                  
                                  return format(date, 'h:mm a');
                                } catch (error) {
                                  console.error('Error formatting date:', error, lastMessage);
                                  return '';
                                }
                              })()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-gray-500 truncate">
                            {lastMessage ? lastMessage.text : 'No messages yet'}
                          </p>
                          {contact.unreadCount && contact.unreadCount > 0 ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-500 text-white">
                              {contact.unreadCount}
                            </span>
                          ) : contact.isTyping ? (
                            <span className="inline-flex space-x-1 items-center h-2">
                              <span className="bg-gray-500 rounded-full h-1.5 w-1.5 animate-typing"></span>
                              <span className="bg-gray-500 rounded-full h-1.5 w-1.5 animate-typing" style={{ animationDelay: '0.2s' }}></span>
                              <span className="bg-gray-500 rounded-full h-1.5 w-1.5 animate-typing" style={{ animationDelay: '0.4s' }}></span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
      
      {/* Add Contact Modal */}
      {showAddContact && (
        <AddContact onClose={() => setShowAddContact(false)} />
      )}
    </div>
  );
};

export default ContactList; 