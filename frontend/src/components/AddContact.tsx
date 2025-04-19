import React, { useState, FormEvent, useEffect } from 'react';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import { MagnifyingGlassIcon, PlusIcon, XMarkIcon, CheckIcon, ClockIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import apiClient from '../services/apiClient';
import { generateAvatarUrl } from '../utils/avatarUtils';

interface AddContactProps {
  onClose: () => void;
}

const AddContact = ({ onClose }: AddContactProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { user } = useAuthStore();
  const { 
    contacts, 
    pendingContacts, 
    sentPendingContacts,
    addContact, 
    acceptContact, 
    isLoading, 
    error,
    fetchPendingContacts, 
    fetchSentPendingContacts
  } = useContactsStore();
  
  // Fetch pending contacts when component mounts
  useEffect(() => {
    const loadPendingContacts = async () => {
      await fetchPendingContacts();
      await fetchSentPendingContacts();
    };
    
    loadPendingContacts();
  }, [fetchPendingContacts, fetchSentPendingContacts]);
  
  // Handle search submission
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setSearchResults([]);
    
    try {
      console.log(`Searching for users matching "${searchQuery}"...`);
      
      // Get the token
      const auth = (await import('../services/firebaseConfig')).auth;
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      // Try direct fetch API approach
      const response = await fetch(`http://127.0.0.1:8000/api/user/search?query=${encodeURIComponent(searchQuery)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        mode: 'cors'
      });
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Search response:', data);
      
      // Add flags to indicate if a user is already a contact or has a pending request
      const resultsWithStatus = data.map((user: any) => {
        const isContact = contacts.some(contact => contact.contact_id === user.firebase_uid);
        const isPending = pendingContacts.some(
          contact => contact.contact_id === user.firebase_uid
        );
        
        return {
          ...user,
          firebase_uid: user.firebase_uid,
          isContact,
          isPending
        };
      });
      
      setSearchResults(resultsWithStatus);
    } catch (error: any) {
      console.error('Error searching users:', error);
      toast.error(`Search failed: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };
  
  // Handle adding a contact
  const handleAddContact = async (userId: string) => {
    try {
      await addContact(userId);
      toast.success('Contact request sent');
      
      // Update the search results to show pending status
      setSearchResults(prevResults => 
        prevResults.map(user => 
          user.firebase_uid === userId 
            ? { ...user, isPending: true } 
            : user
        )
      );
    } catch (error) {
      toast.error('Failed to add contact');
    }
  };
  
  // Handle accepting a contact request
  const handleAcceptContact = async (contactId: string) => {
    try {
      if (!contactId || contactId === 'undefined') {
        console.error('Invalid contact ID:', contactId);
        toast.error('Invalid contact ID');
        return;
      }
      
      console.log('Accepting contact request for ID:', contactId);
      
      // Debug pending contacts
      console.log('All pending contacts:', pendingContacts);
      
      // Debug matching contact
      const matchingContact = pendingContacts.find(c => c._id === contactId);
      if (matchingContact) {
        console.log('Matching contact found:', matchingContact);
      } else {
        console.warn('No matching contact found with _id:', contactId);
      }
      
      await acceptContact(contactId);
      toast.success('Contact request accepted');
    } catch (error) {
      console.error('Error accepting contact request:', error);
      toast.error('Failed to accept contact request');
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">Add Contact</h2>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-gray-700"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4">
          <form onSubmit={handleSearch} className="mb-4">
            <div className="relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
              </div>
              <input
                type="text"
                className="focus:ring-primary-500 focus:border-primary-500 block w-full pl-10 pr-12 sm:text-sm border-gray-300 rounded-md"
                placeholder="Search by email or name"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                <button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                  className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-primary-700 bg-primary-100 hover:bg-primary-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          </form>
          
          {/* Pending contact requests received */}
          {pendingContacts.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Pending Requests Received</h3>
              <ul className="divide-y divide-gray-200 bg-gray-50 rounded-md">
                {pendingContacts.map((contact, index) => (
                  <li key={`pending-${contact._id}-${index}`} className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center">
                      <img
                        className="h-8 w-8 rounded-full object-cover"
                        src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                        alt={contact.contact_display_name}
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{contact.contact_display_name}</p>
                        <p className="text-xs text-gray-500">{contact.contact_email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAcceptContact(contact._id)}
                      disabled={isLoading}
                      className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-green-700 bg-green-100 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                    >
                      <CheckIcon className="h-4 w-4 mr-1" />
                      Accept
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Pending contact requests sent */}
          {sentPendingContacts.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Pending Requests Sent</h3>
              <ul className="divide-y divide-gray-200 bg-gray-50 rounded-md">
                {sentPendingContacts.map((contact, index) => (
                  <li key={`sent-pending-${contact._id}-${index}`} className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center">
                      <img
                        className="h-8 w-8 rounded-full object-cover"
                        src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                        alt={contact.contact_display_name}
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{contact.contact_display_name}</p>
                        <p className="text-xs text-gray-500">{contact.contact_email}</p>
                      </div>
                    </div>
                    <div className="inline-flex items-center px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200 rounded">
                      <ClockIcon className="h-4 w-4 mr-1" />
                      Pending
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Search results */}
          {searchResults.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Search Results</h3>
              <ul className="divide-y divide-gray-200 bg-gray-50 rounded-md">
                {searchResults.map((user, index) => (
                  <li key={`search-${user.firebase_uid}-${index}`} className="py-3 px-4 flex items-center justify-between">
                    <div className="flex items-center">
                      <img
                        className="h-8 w-8 rounded-full object-cover"
                        src={user.avatar_url || generateAvatarUrl(user.display_name, 150)}
                        alt={user.display_name}
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{user.display_name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    {user.isContact ? (
                      <span className="text-xs text-gray-500">Already a contact</span>
                    ) : user.isPending ? (
                      <span className="text-xs text-yellow-500">Request sent</span>
                    ) : (
                      <button
                        onClick={() => handleAddContact(user.firebase_uid)}
                        disabled={isLoading}
                        className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded text-primary-700 bg-primary-100 hover:bg-primary-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                      >
                        <PlusIcon className="h-4 w-4 mr-1" />
                        Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {searchResults.length === 0 && searchQuery && !isSearching && (
            <div className="text-center py-4 text-gray-500">
              No users found matching "{searchQuery}"
            </div>
          )}
          
          {error && (
            <div className="text-sm text-red-600 mt-2">{error}</div>
          )}
        </div>
        
        <div className="px-4 py-3 bg-gray-50 text-right sm:px-6 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddContact; 