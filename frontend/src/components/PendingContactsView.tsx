import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import { CheckIcon, ClockIcon, MagnifyingGlassIcon, PlusIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { generateAvatarUrl } from '../utils/avatarUtils';

const PendingContactsView = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const { user } = useAuthStore();
  const { 
    contacts,
    pendingContacts, 
    sentPendingContacts,
    fetchPendingContacts, 
    fetchSentPendingContacts,
    addContact,
    acceptContact, 
    isLoading
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
      
      // Add flags to indicate if a user is already a contact or has a pending request
      const resultsWithStatus = data.map((user: any) => {
        const isContact = contacts.some(contact => contact.contact_id === user.firebase_uid);
        const isPending = pendingContacts.some(
          contact => contact.contact_id === user.firebase_uid
        );
        const isSentPending = sentPendingContacts.some(
          contact => contact.contact_id === user.firebase_uid
        );
        
        return {
          ...user,
          firebase_uid: user.firebase_uid,
          isContact,
          isPending,
          isSentPending
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
            ? { ...user, isSentPending: true } 
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
      
      await acceptContact(contactId);
      toast.success('Contact request accepted');
    } catch (error) {
      console.error('Error accepting contact request:', error);
      toast.error('Failed to accept contact request');
    }
  };

  const hasPendingContacts = pendingContacts.length > 0 || sentPendingContacts.length > 0;

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-dark-900 transition-colors duration-200 overflow-y-auto">
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">
              Contact Requests
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Manage your pending contact requests and find new contacts
            </p>
          </div>
          <button
            onClick={() => navigate('/chat')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-dark-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-800 hover:bg-gray-50 dark:hover:bg-dark-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-secondary-500 transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Chats
          </button>
        </div>

        {/* Search for users */}
        <div className="mb-10">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Find New Contacts
          </h2>
          <form onSubmit={handleSearch} className="mb-6">
            <div className="flex items-center">
              <div className="relative rounded-md flex-1 mr-4">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </div>
                <input
                  type="text"
                  className="focus:ring-primary-500 focus:border-primary-500 block w-full pl-10 pr-12 sm:text-sm border-gray-300 dark:border-dark-600 dark:bg-dark-800 dark:text-white rounded-md"
                  placeholder="Search by email or name"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 dark:bg-secondary-600 hover:bg-primary-700 dark:hover:bg-secondary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-secondary-500 transition-colors disabled:opacity-50"
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </form>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="bg-white dark:bg-dark-800 rounded-lg shadow overflow-hidden">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 p-4 border-b border-gray-200 dark:border-dark-700">
                Search Results
              </h3>
              <ul className="divide-y divide-gray-200 dark:divide-dark-700">
                {searchResults.map((user) => (
                  <li 
                    key={`search-${user.firebase_uid}`} 
                    className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <img
                        className="h-10 w-10 rounded-full object-cover"
                        src={user.avatar_url || generateAvatarUrl(user.display_name, 150)}
                        alt={user.display_name}
                      />
                      <div className="ml-4">
                        <p className="text-base font-medium text-gray-900 dark:text-white">
                          {user.display_name}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {user.email}
                        </p>
                      </div>
                    </div>
                    {user.isContact ? (
                      <span className="text-sm text-gray-500 dark:text-gray-400">Already a contact</span>
                    ) : user.isPending ? (
                      <span className="text-sm text-yellow-600 dark:text-yellow-400">Request received</span>
                    ) : user.isSentPending ? (
                      <span className="text-sm text-yellow-600 dark:text-yellow-400">Request sent</span>
                    ) : (
                      <button
                        onClick={() => handleAddContact(user.firebase_uid)}
                        disabled={isLoading}
                        className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 dark:bg-secondary-600 hover:bg-primary-700 dark:hover:bg-secondary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-secondary-500 transition-colors disabled:opacity-50"
                      >
                        <PlusIcon className="h-4 w-4 mr-2" />
                        Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {searchResults.length === 0 && searchQuery && !isSearching && (
            <div className="text-center py-4 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-800 rounded-lg">
              No users found matching "{searchQuery}"
            </div>
          )}
        </div>

        {/* No pending contacts message */}
        {!hasPendingContacts && !searchResults.length && (
          <div className="flex flex-col items-center justify-center py-12 bg-gray-50 dark:bg-dark-800 rounded-lg mb-10">
            <div className="text-center">
              <svg
                className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
              <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-white">
                No pending requests
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                You don't have any pending contact requests at the moment.
              </p>
            </div>
          </div>
        )}

        {/* Pending contact requests received */}
        {pendingContacts.length > 0 && (
          <div className="mb-10">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Requests Received ({pendingContacts.length})
            </h2>
            <div className="bg-white dark:bg-dark-800 rounded-lg shadow overflow-hidden">
              <ul className="divide-y divide-gray-200 dark:divide-dark-700">
                {pendingContacts.map((contact) => (
                  <li 
                    key={`pending-${contact._id}`} 
                    className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <img
                        className="h-10 w-10 rounded-full object-cover"
                        src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                        alt={contact.contact_display_name}
                      />
                      <div className="ml-4">
                        <p className="text-base font-medium text-gray-900 dark:text-white">
                          {contact.contact_display_name}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {contact.contact_email}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAcceptContact(contact._id)}
                      disabled={isLoading}
                      className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 dark:bg-secondary-600 hover:bg-primary-700 dark:hover:bg-secondary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-secondary-500 transition-colors disabled:opacity-50"
                    >
                      <CheckIcon className="h-4 w-4 mr-2" />
                      Accept
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Pending contact requests sent */}
        {sentPendingContacts.length > 0 && (
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Requests Sent ({sentPendingContacts.length})
            </h2>
            <div className="bg-white dark:bg-dark-800 rounded-lg shadow overflow-hidden">
              <ul className="divide-y divide-gray-200 dark:divide-dark-700">
                {sentPendingContacts.map((contact) => (
                  <li 
                    key={`sent-${contact._id}`} 
                    className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-dark-700 transition-colors"
                  >
                    <div className="flex items-center">
                      <img
                        className="h-10 w-10 rounded-full object-cover"
                        src={contact.contact_avatar_url || generateAvatarUrl(contact.contact_display_name, 150)}
                        alt={contact.contact_display_name}
                      />
                      <div className="ml-4">
                        <p className="text-base font-medium text-gray-900 dark:text-white">
                          {contact.contact_display_name}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {contact.contact_email}
                        </p>
                      </div>
                    </div>
                    <div className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-dark-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-700 transition-colors">
                      <ClockIcon className="h-4 w-4 mr-2 text-gray-500 dark:text-gray-400" />
                      Pending
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingContactsView; 