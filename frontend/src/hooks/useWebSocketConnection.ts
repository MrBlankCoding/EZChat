import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import websocketService from '../services/websocketService';

/**
 * Hook to manage WebSocket connection
 * Automatically connects when the user is authenticated
 * Avoids creating duplicate connections
 */
export function useWebSocketConnection() {
  const { user } = useAuthStore();
  const [connectionStatus, setConnectionStatus] = useState(websocketService.getConnectionState());
  
  useEffect(() => {
    // Only connect when the user is authenticated
    if (user) {
      console.log('User authenticated in hook, checking WebSocket connection');
      // Check current connection state before attempting to connect
      const status = websocketService.getConnectionState();
      
      if (status.state !== 'connected' && status.state !== 'connecting') {
        console.log('WebSocket not connected, initiating connection from hook');
        websocketService.connect().catch(error => {
          console.error('Failed to connect WebSocket from hook:', error);
        });
      }
    }
    
    // No disconnect on unmount - connections are managed globally by AuthProvider
    // This prevents connection/disconnection cycles when navigating between pages
  }, [user]);
  
  useEffect(() => {
    // Update connection status periodically
    const intervalId = setInterval(() => {
      setConnectionStatus(websocketService.getConnectionState());
    }, 1000);
    
    return () => clearInterval(intervalId);
  }, []);
  
  return { connectionStatus };
}

export default useWebSocketConnection; 