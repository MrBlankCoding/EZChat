import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import websocketService from '../services/websocketService';
import notificationService from '../services/notificationService';

// Create auth context
const AuthContext = createContext<{}>({});

// Auth provider props
interface AuthProviderProps {
  children: ReactNode;
}

// Auth provider component
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { user, isAuthenticated, isLoading, initialized, checkAuth } = useAuthStore();

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Connect/disconnect WebSocket based on auth state
  useEffect(() => {
    const connectWebSocket = async () => {
      if (isAuthenticated && user) {
        // Connect WebSocket
        await websocketService.connect();
        
        // Initialize notifications
        initializeNotifications();
      } else if (!isLoading && initialized) {
        // Disconnect WebSocket
        websocketService.disconnect();
      }
    };

    connectWebSocket();

    // Cleanup function
    return () => {
      websocketService.disconnect();
    };
  }, [isAuthenticated, user, isLoading, initialized]);
  
  // Initialize notifications
  const initializeNotifications = async () => {
    try {
      // Initialize notification service
      await notificationService.initialize();
      
      // Request notification permissions
      const permissionGranted = await notificationService.requestPermission();
      
      if (permissionGranted) {
        // Get FCM token and register with backend
        const token = await notificationService.getToken();
        
        if (token) {
          console.log('FCM token obtained and registered with backend');
          
          // Set up foreground notification handlers
          notificationService.onMessage((notification) => {
            // Display the notification in the foreground
            notificationService.displayNotification(notification);
          });
        }
      } else {
        console.warn('Notification permission denied');
      }
    } catch (error) {
      console.error('Error initializing notifications:', error);
    }
  };

  // Return auth context provider with value
  return (
    <AuthContext.Provider value={{}}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => useContext(AuthContext); 