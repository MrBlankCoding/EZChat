import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import ProtectedRoute from './components/ProtectedRoute';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthProvider';
import timezoneService from './services/timezoneService';
import presenceManager from './services/presenceManager';

function App() {
  const { isAuthenticated, initialized, checkAuth } = useAuthStore();
  
  // Initial auth check
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);
  
  // Initialize services when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Initialize timezone service
      timezoneService.initialize();
      
      // Initialize presence manager for status tracking
      presenceManager.initialize();
      
      // Clean up on unmount
      return () => {
        presenceManager.cleanup();
      };
    }
  }, [isAuthenticated]);
  
  // Handle notification clicks from service worker
  useEffect(() => {
    const handleNotificationClick = (event: MessageEvent) => {
      // Check if the message is a notification click
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        // Get the contact ID from the message
        const contactId = event.data.contactId;
        
        if (contactId) {
          // Navigate to the chat with this contact
          window.location.href = `/chat/${contactId}`;
        }
      }
    };
    
    // Add event listener for messages from service worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('message', handleNotificationClick);
    }
    
    // Cleanup function
    return () => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.removeEventListener('message', handleNotificationClick);
      }
    };
  }, []);
  
  // Register the service worker for notifications
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/firebase-messaging-sw.js')
        .then(registration => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  if (!initialized) {
    // Show loading state while checking authentication
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-dark-900">
        <div className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <div className="transition-colors duration-200">
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'bg-white dark:bg-dark-800 dark:text-white rounded-xl shadow-soft-md',
            duration: 5000,
          }}
        />
        
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
          <Route path="/register" element={isAuthenticated ? <Navigate to="/" /> : <RegisterPage />} />
          
          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/chat" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:contactId"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts"
            element={
              <ProtectedRoute>
                <ContactsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          
          {/* 404 Route */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </AuthProvider>
  );
}

export default App; 