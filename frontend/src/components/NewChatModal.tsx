import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon, MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useContactsStore } from '../stores/contactsStore';
import { useChatStore } from '../stores/chatStore';
import { useNavigate } from 'react-router-dom';
import { generateAvatarUrl } from '../utils/avatarUtils';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectContact?: (contactId: string) => void;
}

const NewChatModal = ({ isOpen, onClose, onSelectContact }: NewChatModalProps) => {
  const { contacts } = useContactsStore();
  const { setActiveConversation } = useChatStore();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  
  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('modal-backdrop')) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Filter contacts by search term
  const filteredContacts = contacts.filter((contact) => {
    const displayName = contact.contact_display_name?.toLowerCase() || '';
    const email = contact.contact_email?.toLowerCase() || '';
    const term = searchTerm.toLowerCase();
    return displayName.includes(term) || email.includes(term);
  });

  // Start a new chat with the selected contact
  const handleStartChat = () => {
    if (selectedContactId) {
      // If onSelectContact callback exists, use it
      if (onSelectContact) {
        onSelectContact(selectedContactId);
      } else {
        // Otherwise use the old behavior
        setActiveConversation(selectedContactId);
        navigate(`/chat/${selectedContactId}`);
        onClose();
      }
    }
  };

  return (
    isOpen ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 modal-backdrop">
        <div 
          className="bg-white dark:bg-dark-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-dark-700">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">New Chat</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-gray-200 dark:border-dark-700">
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
          <div className="max-h-60 overflow-y-auto">
            {filteredContacts.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                {searchTerm ? 'No contacts found' : 'You have no contacts'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-dark-700">
                {filteredContacts.map((contact) => (
                  <li
                    key={contact.contact_id}
                    onClick={() => setSelectedContactId(contact.contact_id)}
                    className={`
                      cursor-pointer hover:bg-gray-50 dark:hover:bg-dark-700 transition-colors
                      ${selectedContactId === contact.contact_id ? 'bg-primary-50 dark:bg-dark-800' : ''}
                    `}
                  >
                    <div className="flex items-center p-3">
                      <div className="relative flex-shrink-0">
                        <img
                          className="h-10 w-10 rounded-full object-cover"
                          src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                          alt={contact.contact_display_name}
                        />
                        <div
                          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-dark-900 ${
                            contact.contact_status === 'online'
                              ? 'bg-green-500'
                              : contact.contact_status === 'away'
                              ? 'bg-yellow-500'
                              : 'bg-gray-500'
                          }`}
                        ></div>
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {contact.contact_display_name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {contact.contact_email || 'No email'}
                        </p>
                      </div>
                      {selectedContactId === contact.contact_id && (
                        <CheckIcon className="h-5 w-5 text-primary-600 dark:text-secondary-500" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-200 dark:border-dark-700 flex justify-end space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStartChat}
              disabled={!selectedContactId}
              className={`
                px-4 py-2 text-sm text-white rounded-lg transition-colors
                ${selectedContactId
                  ? 'bg-primary-600 dark:bg-secondary-600 hover:bg-primary-700 dark:hover:bg-secondary-700'
                  : 'bg-gray-300 dark:bg-dark-600 cursor-not-allowed'
                }
              `}
            >
              Start Chat
            </button>
          </div>
        </div>
      </div>
    ) : null
  );
};

export default NewChatModal; 