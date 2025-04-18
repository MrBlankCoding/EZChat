import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import { useContactsStore } from '../stores/contactsStore';
import ContactsList from '../components/ContactsList';

const ContactsPage = () => {
  const { contacts, fetchContacts } = useContactsStore();
  const [isLoading, setIsLoading] = useState(true);
  
  // Fetch contacts on initial load
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        await fetchContacts();
      } catch (error) {
        console.error('Error fetching contacts:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, [fetchContacts]);
  
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-950 transition-colors duration-200">
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        
        <div className="flex-1 flex overflow-hidden">
          <ContactsList contacts={contacts} isContactsPage={true} />
          
          <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
            <div className="text-center max-w-md px-4 animate-fade-in">
              <svg 
                className="h-16 w-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" 
                xmlns="http://www.w3.org/2000/svg" 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="text-xl font-medium text-gray-900 dark:text-white">Contact Management</h3>
              <p className="mt-2 text-base text-gray-500 dark:text-gray-400">
                {contacts.length > 0 
                  ? 'Select a contact to view their details' 
                  : 'Add your first contact to get started'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactsPage; 