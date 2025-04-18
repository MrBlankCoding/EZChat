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
    let wsCheckInterval: NodeJS.Timeout | null = null;
    
    const connectWebSocket = async () => {
      if (isAuthenticated && user) {
        console.log('[AuthProvider] User authenticated, connecting WebSocket...');
        
        try {
          // Check if already connected before connecting
          const status = websocketService.getConnectionState();
          if (status.state !== 'connected') {
            await websocketService.connect();
            console.log('[AuthProvider] WebSocket connected successfully');
          }
          
          // Set up a connection health check every 60 seconds
          wsCheckInterval = setInterval(async () => {
            try {
              const isConnected = await websocketService.testConnection();
              if (!isConnected) {
                console.log('[AuthProvider] WebSocket health check failed, reconnecting...');
                await websocketService.connect().catch(err => {
                  console.log('[AuthProvider] WebSocket reconnect failed:', err.message);
                  // Don't throw - we'll try again on next interval
                });
              }
            } catch (error) {
              console.log('[AuthProvider] WebSocket health check error:', 
                error instanceof Error ? error.message : 'Unknown error');
              // Continue despite error - we'll try again on next interval
            }
          }, 60000);
          
          // Initialize notifications
          try {
            await initializeNotifications();
          } catch (error) {
            console.log('[AuthProvider] Notification initialization failed:', 
              error instanceof Error ? error.message : 'Unknown error');
            // Continue despite notification error
          }
        } catch (error) {
          console.error('[AuthProvider] Error during WebSocket setup:', 
            error instanceof Error ? error.message : 'Unknown error');
          // Don't halt the app for WebSocket errors
        }
      } else if (!isLoading && initialized) {
        // Disconnect WebSocket when logged out
        console.log('[AuthProvider] User not authenticated, disconnecting WebSocket');
        websocketService.disconnect();
        
        // Clear interval if it exists
        if (wsCheckInterval) {
          clearInterval(wsCheckInterval);
          wsCheckInterval = null;
        }
      }
    };

    connectWebSocket();

    // Cleanup function
    return () => {
      if (wsCheckInterval) {
        clearInterval(wsCheckInterval);
      }
      // Don't disconnect WebSocket on component unmount - only on logout
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