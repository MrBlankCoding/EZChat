import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Contact, useContactsStore } from '../stores/contactsStore';
import { useChatStore } from '../stores/chatStore';
import AddContact from './AddContact';
import { UserPlusIcon, MagnifyingGlassIcon, XMarkIcon, EllipsisHorizontalIcon, TrashIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

interface ContactsListProps {
  contacts: Contact[];
  isContactsPage: boolean;
}

const ContactsList = ({ contacts, isContactsPage }: ContactsListProps) => {
  const navigate = useNavigate();
  const { deleteContact, fetchPendingContacts, fetchSentPendingContacts } = useContactsStore();
  const { setActiveConversation } = useChatStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  // Fetch contacts when component mounts
  useEffect(() => {
    const loadData = async () => {
      await fetchPendingContacts();
      await fetchSentPendingContacts();
    };
    
    loadData();
  }, [fetchPendingContacts, fetchSentPendingContacts]);

  // Filter contacts by search term
  const filteredContacts = contacts.filter((contact) => {
    const displayName = contact.contact_display_name?.toLowerCase() || '';
    const email = contact.contact_email?.toLowerCase() || '';
    const term = searchTerm.toLowerCase();
    return displayName.includes(term) || email.includes(term);
  });

  // Handle starting a chat with contact
  const startChat = (contactId: string) => {
    setActiveConversation(contactId);
    navigate(`/chat/${contactId}`);
  };
  
  // Toggle dropdown menu
  const toggleDropdown = (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(activeDropdown === contactId ? null : contactId);
  };
  
  // Delete contact
  const handleDeleteContact = async (e: React.MouseEvent, contactId: string) => {
    e.stopPropagation();
    setActiveDropdown(null);
    
    if (confirm('Are you sure you want to delete this contact? This will remove them from your contacts list.')) {
      try {
        const toastId = toast.loading('Deleting contact...');
        await deleteContact(contactId);
        toast.success('Contact deleted successfully', { id: toastId });
      } catch (error) {
        toast.error('Failed to delete contact');
      }
    }
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
        {filteredContacts.length === 0 ? (
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

              return (
                <li
                  key={contactId}
                  className="transition-all duration-200 animate-fade-in hover:bg-gray-50 dark:hover:bg-dark-800"
                >
                  <div className="flex items-center py-3 px-4">
                    <div className="relative flex-shrink-0">
                      <img
                        className="h-12 w-12 rounded-full object-cover"
                        src={contact.contact_avatar_url || 'https://via.placeholder.com/150'}
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
                        <p className="text-sm font-medium truncate text-gray-900 dark:text-white">
                          {contact.contact_display_name}
                        </p>
                      </div>
                      <p className="text-xs truncate text-gray-500 dark:text-gray-400">
                        {contact.contact_status === 'online'
                          ? 'Online'
                          : contact.contact_status === 'away'
                          ? 'Away'
                          : 'Offline'}
                      </p>
                    </div>
                    
                    {/* Action buttons */}
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => startChat(contactId)}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 rounded-full hover:bg-gray-100 dark:hover:bg-dark-700"
                        title="Chat with contact"
                      >
                        <EnvelopeIcon className="h-5 w-5" />
                      </button>
                      
                      <button 
                        onClick={(e) => toggleDropdown(e, contactId)}
                        className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 rounded-full hover:bg-gray-100 dark:hover:bg-dark-700"
                      >
                        <EllipsisHorizontalIcon className="h-5 w-5" />
                      </button>
                    </div>
                    
                    {/* Dropdown Menu */}
                    {activeDropdown === contactId && (
                      <div 
                        className="absolute right-2 z-10 w-48 bg-white dark:bg-dark-800 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                        style={{ top: '3.5rem' }}
                      >
                        <div className="py-1">
                          <button
                            onClick={(e) => handleDeleteContact(e, contactId)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                          >
                            <TrashIcon className="h-4 w-4 mr-2" />
                            Delete contact
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
      
      {/* Add Contact Dialog */}
      {showAddContact && (
        <AddContact onClose={() => setShowAddContact(false)} />
      )}
    </div>
  );
};

export default ContactsList; 