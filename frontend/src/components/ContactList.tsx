import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContactsStore } from '../stores/contactsStore';
import { useChatStore } from '../stores/chatStore';
import AddContact from './AddContact';
import { UserPlusIcon, MagnifyingGlassIcon, XMarkIcon, EllipsisHorizontalIcon, TrashIcon, EnvelopeIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinIconSolid } from '@heroicons/react/24/solid';
import toast from 'react-hot-toast';
import { generateAvatarUrl } from '../utils/avatarUtils';

const ContactList = () => {
  const navigate = useNavigate();
  const { contacts } = useContactsStore();
  const { 
    activeConversationId, 
    setActiveConversation, 
    conversations,
    pinConversation,
    markConversationAsUnread,
    deleteConversation
  } = useChatStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Filter contacts by search term
  const filteredContacts = contacts.filter((contact) => {
    const displayName = contact.contact_display_name?.toLowerCase() || '';
    const email = contact.contact_email?.toLowerCase() || '';
    const term = searchTerm.toLowerCase();
    return displayName.includes(term) || email.includes(term);
  });

  // Handle contact selection
  const selectContact = (contactId: string) => {
    setActiveConversation(contactId);
    navigate(`/chat/${contactId}`);
  };
  
  // Toggle conversation pin
  const handleTogglePin = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(null);
    const conversation = conversations[contactId];
    const isPinned = !conversation?.isPinned;
    
    try {
      await pinConversation(contactId, isPinned);
      toast.success(isPinned ? 'Chat pinned' : 'Chat unpinned');
    } catch (error) {
      toast.error('Failed to update pin status');
    }
  };
  
  // Mark conversation as unread
  const handleMarkAsUnread = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(null);
    
    try {
      await markConversationAsUnread(contactId, true);
      toast.success('Chat marked as unread');
    } catch (error) {
      toast.error('Failed to mark as unread');
    }
  };
  
  // Delete conversation
  const handleDeleteConversation = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(null);
    
    if (confirm('Are you sure you want to delete this conversation? This will permanently remove all messages.')) {
      try {
        // Immediately show a toast that deletion is in progress
        const toastId = toast.loading('Deleting chat...');
        
        // Delete the conversation
        await deleteConversation(contactId);
        
        // Update the toast to success
        toast.success('Chat deleted successfully', { id: toastId });
      } catch (error) {
        toast.error('Failed to delete chat');
      }
    }
  };
  
  // Toggle dropdown menu
  const toggleDropdown = (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(activeDropdown === contactId ? null : contactId);
  };

  return (
    <div className="w-80 border-r border-gray-200 dark:border-dark-700 flex flex-col bg-white dark:bg-dark-900 transition-colors duration-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-dark-700">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Contacts</h2>
          <button
            onClick={() => setShowAddContact(true)}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 rounded-full bg-gray-100 dark:bg-dark-800 hover:bg-gray-200 dark:hover:bg-dark-700 transition-colors"
          >
            <UserPlusIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search contacts"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-100 dark:bg-dark-800 text-gray-900 dark:text-white border-0 rounded-xl py-2 pl-10 pr-9 focus:ring-1 focus:ring-primary-500 dark:focus:ring-secondary-500 focus:bg-white dark:focus:bg-dark-700 placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2"
            >
              <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
            </button>
          )}
        </div>
      </div>

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 dark:border-secondary-500"></div>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            {searchTerm ? (
              <>
                <p className="text-gray-500 dark:text-gray-400 mb-1">No contacts found</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Try a different search term
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-500 dark:text-gray-400 mb-1">Your contacts list is empty</p>
                <button
                  onClick={() => setShowAddContact(true)}
                  className="mt-2 px-3 py-1.5 text-sm text-white bg-primary-600 dark:bg-secondary-600 hover:bg-primary-700 dark:hover:bg-secondary-700 rounded-lg transition-colors focus:outline-none"
                >
                  Add your first contact
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-dark-700">
            {filteredContacts.map((contact) => {
              const contactId = contact.contact_id;
              const isActive = contactId === activeConversationId;
              const conversation = conversations[contactId] || {};
              const isPinned = conversation.isPinned;
              const isUnread = conversation.isUnread;

              return (
                <li
                  key={contactId}
                  onClick={() => selectContact(contactId)}
                  className={`
                    cursor-pointer transition-all duration-200 animate-fade-in relative
                    ${isActive ? 'bg-primary-50 dark:bg-dark-800' : 'hover:bg-gray-50 dark:hover:bg-dark-800'}
                    ${isPinned ? 'border-l-4 border-primary-500 dark:border-secondary-500' : ''}
                  `}
                >
                  <div className="flex items-center py-3 px-4">
                    <div className="relative flex-shrink-0">
                      <img
                        className={`h-12 w-12 rounded-full object-cover ${isActive ? 'ring-2 ring-primary-500 dark:ring-secondary-500' : ''}`}
                        src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                        alt={contact.contact_display_name}
                      />
                      <div
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-dark-900 ${
                          contact.contact_status === 'online'
                            ? 'bg-green-500'
                            : contact.contact_status === 'away'
                            ? 'bg-yellow-500'
                            : 'bg-gray-500'
                        }`}
                      ></div>
                    </div>
                    <div className="ml-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium truncate ${isActive ? 'text-primary-600 dark:text-secondary-400' : 'text-gray-900 dark:text-white'} ${isUnread ? 'font-bold' : ''}`}>
                          {contact.contact_display_name}
                          {isPinned && (
                            <span className="ml-1 text-primary-500 dark:text-secondary-500 inline-block transform -rotate-45">
                              <MapPinIconSolid className="h-3 w-3 inline" />
                            </span>
                          )}
                        </p>
                        {isUnread && (
                          <span className="ml-2 bg-primary-600 dark:bg-secondary-600 text-white text-xs px-2 py-0.5 rounded-full animate-scale-in">
                            New
                          </span>
                        )}
                      </div>
                      <p className={`text-xs truncate ${isActive ? 'text-primary-500 dark:text-secondary-500' : 'text-gray-500 dark:text-gray-400'}`}>
                        {contact.contact_status === 'online'
                          ? 'Online'
                          : contact.contact_status === 'away'
                          ? 'Away'
                          : 'Offline'}
                      </p>
                    </div>
                    
                    {/* Options button */}
                    <button 
                      onClick={(e) => toggleDropdown(e, contactId)}
                      className="ml-2 p-1 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 rounded-full hover:bg-gray-100 dark:hover:bg-dark-700"
                    >
                      <EllipsisHorizontalIcon className="h-5 w-5" />
                    </button>
                    
                    {/* Dropdown Menu */}
                    {activeDropdown === contactId && (
                      <div 
                        className="absolute right-2 top-14 z-10 w-48 bg-white dark:bg-dark-800 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="py-1">
                          <button
                            onClick={(e) => handleTogglePin(e, contactId)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                          >
                            {isPinned ? (
                              <>
                                <MapPinIconSolid className="h-4 w-4 mr-2 text-primary-500 dark:text-secondary-500" />
                                Unpin chat
                              </>
                            ) : (
                              <>
                                <MapPinIcon className="h-4 w-4 mr-2" />
                                Pin chat
                              </>
                            )}
                          </button>
                          <button
                            onClick={(e) => handleMarkAsUnread(e, contactId)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                          >
                            <EnvelopeIcon className="h-4 w-4 mr-2" />
                            Mark as unread
                          </button>
                          <button
                            onClick={(e) => handleDeleteConversation(e, contactId)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                          >
                            <TrashIcon className="h-4 w-4 mr-2" />
                            Delete chat
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add Contact Modal */}
      {showAddContact && (
        <AddContact onClose={() => setShowAddContact(false)} />
      )}
    </div>
  );
};

export default ContactList; 