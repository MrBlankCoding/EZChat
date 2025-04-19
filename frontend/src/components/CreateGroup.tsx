import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../stores/authStore';
import { useContactsStore } from '../stores/contactsStore';
import { useChatStore } from '../stores/chatStore';
import toast from 'react-hot-toast';

interface CreateGroupProps {
  onClose: () => void;
}

const CreateGroup: React.FC<CreateGroupProps> = ({ onClose }) => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { contacts } = useContactsStore();
  const { createGroup, setActiveGroup } = useChatStore();
  
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredContacts = contacts.filter((contact) => {
    const displayName = contact.contact_display_name?.toLowerCase() || '';
    const email = contact.contact_email?.toLowerCase() || '';
    const term = searchTerm.toLowerCase();
    return displayName.includes(term) || email.includes(term);
  });
  
  const handleToggleContact = (contactId: string) => {
    if (selectedContactIds.includes(contactId)) {
      setSelectedContactIds(selectedContactIds.filter(id => id !== contactId));
    } else {
      setSelectedContactIds([...selectedContactIds, contactId]);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    
    if (selectedContactIds.length === 0) {
      toast.error('Please select at least one contact');
      return;
    }
    
    try {
      const toastId = toast.loading('Creating group...');
      const group = await createGroup(groupName, selectedContactIds, description);
      
      if (group) {
        toast.success('Group created successfully', { id: toastId });
        setActiveGroup(group.id);
        navigate(`/chat/${group.id}`);
        onClose();
      } else {
        toast.error('Failed to create group', { id: toastId });
      }
    } catch (error) {
      toast.error('Failed to create group');
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="relative bg-white dark:bg-dark-900 rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Create Group</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400 rounded-full"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
          <div className="mb-4">
            <label htmlFor="group-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Group Name
            </label>
            <input
              id="group-name"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-primary-500 dark:focus:border-secondary-500 dark:bg-dark-800 dark:text-white"
              required
            />
          </div>
          
          <div className="mb-4">
            <label htmlFor="group-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description (Optional)
            </label>
            <textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter group description"
              className="w-full px-3 py-2 border border-gray-300 dark:border-dark-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-primary-500 dark:focus:border-secondary-500 dark:bg-dark-800 dark:text-white"
              rows={2}
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Add Members
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search contacts"
                className="w-full px-3 py-2 border border-gray-300 dark:border-dark-700 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-primary-500 dark:focus:border-secondary-500 dark:bg-dark-800 dark:text-white"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300" />
                </button>
              )}
            </div>
          </div>
          
          {/* Selected Contacts */}
          {selectedContactIds.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Selected Contacts ({selectedContactIds.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedContactIds.map(id => {
                  const contact = contacts.find(c => c.contact_id === id);
                  return contact ? (
                    <div key={id} className="py-1 px-3 bg-gray-100 dark:bg-dark-700 rounded-full flex items-center text-sm">
                      <span className="truncate max-w-[120px]">{contact.contact_display_name}</span>
                      <button
                        type="button"
                        onClick={() => handleToggleContact(id)}
                        className="ml-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
          
          {/* Contact List */}
          <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 dark:border-dark-700 rounded-md">
            {filteredContacts.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                {searchTerm ? "No contacts found" : "No contacts available"}
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-dark-700">
                {filteredContacts.map((contact) => (
                  <li
                    key={contact.contact_id}
                    className={`p-3 flex items-center hover:bg-gray-50 dark:hover:bg-dark-800 cursor-pointer ${
                      selectedContactIds.includes(contact.contact_id) ? 'bg-gray-50 dark:bg-dark-800' : ''
                    }`}
                    onClick={() => handleToggleContact(contact.contact_id)}
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        className="h-10 w-10 rounded-full object-cover"
                        src={contact.contact_avatar_url || 'https://via.placeholder.com/150'}
                        alt={contact.contact_display_name}
                      />
                    </div>
                    <div className="ml-3 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {contact.contact_display_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {contact.contact_email}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.contact_id)}
                        onChange={() => {}} // Handled by the li click
                        className="h-4 w-4 text-primary-600 dark:text-secondary-500 focus:ring-primary-500 dark:focus:ring-secondary-500 border-gray-300 dark:border-dark-600 rounded"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-dark-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-700 focus:outline-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 dark:bg-secondary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700 dark:hover:bg-secondary-700 focus:outline-none disabled:opacity-50"
              disabled={!groupName.trim() || selectedContactIds.length === 0}
            >
              Create Group
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGroup; 