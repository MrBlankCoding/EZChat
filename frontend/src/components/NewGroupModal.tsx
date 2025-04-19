import { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import { useNavigate } from 'react-router-dom';

interface NewGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const NewGroupModal = ({ isOpen, onClose }: NewGroupModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { contacts } = useContactsStore();
  const { createGroup, setActiveGroup } = useChatStore();
  const navigate = useNavigate();
  
  // Reset form when modal is opened
  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setSelectedContacts([]);
      setError(null);
    }
  }, [isOpen]);
  
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Group name is required');
      return;
    }
    
    if (selectedContacts.length === 0) {
      setError('Please select at least one contact');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const newGroup = await createGroup(name, selectedContacts, description);
      
      if (newGroup) {
        onClose();
        // Set the active group before navigation
        setActiveGroup(newGroup.id);
        // Navigate to the new group chat
        navigate(`/chat/${newGroup.id}`);
      } else {
        setError('Failed to create group');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };
  
  const toggleContact = (contactId: string) => {
    setSelectedContacts(prev => 
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col transition-colors">
        <div className="p-4 border-b border-gray-200 dark:border-dark-600">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Create New Group</h2>
        </div>
        
        <form onSubmit={handleCreateGroup} className="flex-1 overflow-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-md">
              {error}
            </div>
          )}
          
          <div className="mb-4">
            <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Group Name*
            </label>
            <input
              type="text"
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-transparent bg-white dark:bg-dark-700 text-gray-900 dark:text-white"
              placeholder="Enter group name"
            />
          </div>
          
          <div className="mb-4">
            <label htmlFor="group-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description (optional)
            </label>
            <textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-transparent bg-white dark:bg-dark-700 text-gray-900 dark:text-white"
              placeholder="Enter group description"
              rows={3}
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Contacts*
            </label>
            <div className="max-h-60 overflow-auto border border-gray-300 dark:border-dark-600 rounded-md">
              {contacts.length === 0 ? (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  No contacts available. Add contacts first.
                </div>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-dark-600">
                  {contacts.map((contact) => (
                    <li key={contact.contact_id} className="flex items-center p-3 hover:bg-gray-50 dark:hover:bg-dark-700">
                      <input
                        type="checkbox"
                        id={`contact-${contact.contact_id}`}
                        checked={selectedContacts.includes(contact.contact_id)}
                        onChange={() => toggleContact(contact.contact_id)}
                        className="h-4 w-4 text-primary-600 dark:text-secondary-500 focus:ring-primary-500 dark:focus:ring-secondary-500 rounded"
                      />
                      <label
                        htmlFor={`contact-${contact.contact_id}`}
                        className="ml-3 flex items-center cursor-pointer flex-1"
                      >
                        <div className="flex-shrink-0">
                          {contact.contact_avatar_url ? (
                            <img
                              src={contact.contact_avatar_url}
                              alt={contact.contact_display_name}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-300 flex items-center justify-center">
                              {contact.contact_display_name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {contact.contact_display_name}
                          </p>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </form>
        
        <div className="p-4 border-t border-gray-200 dark:border-dark-600 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-700 border border-gray-300 dark:border-dark-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-dark-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreateGroup}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 dark:bg-secondary-600 rounded-md shadow-sm hover:bg-primary-700 dark:hover:bg-secondary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500"
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </span>
            ) : (
              'Create Group'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewGroupModal; 