import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import { useContactsStore } from '../stores/contactsStore';
import ContactsList from '../components/ContactsList';
import PendingContactsView from '../components/PendingContactsView';

const ContactsPage = () => {
  const { contacts, fetchContacts, fetchPendingContacts, fetchSentPendingContacts } = useContactsStore();
  const [isLoading, setIsLoading] = useState(true);
  
  // Fetch contacts when component mounts
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        await fetchContacts();
        await fetchPendingContacts();
        await fetchSentPendingContacts();
      } catch (error) {
        console.error('Error fetching contacts:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [fetchContacts, fetchPendingContacts, fetchSentPendingContacts]);
  
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-950 transition-colors duration-200">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <div className="flex-1 flex overflow-hidden">
          <ContactsList contacts={contacts} isContactsPage={true} />
          
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 dark:border-secondary-500 mx-auto"></div>
                <p className="mt-2 text-gray-600 dark:text-gray-300">Loading contacts...</p>
              </div>
            </div>
          ) : (
            <PendingContactsView />
          )}
        </div>
      </div>
    </div>
  );
};

export default ContactsPage; 