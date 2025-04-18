import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import websocketService from '../services/websocketService';

/**
 * Hook to manage WebSocket connection
 * Automatically connects when the user is authenticated and
 * disconnects when the user logs out
 */
export function useWebSocketConnection() {
  const { user } = useAuthStore();
  
  useEffect(() => {
    // Connect to WebSocket when the user is authenticated
    if (user) {
      console.log('User authenticated, connecting to WebSocket');
      websocketService.connect();
    } else {
      // Disconnect when the user logs out
      console.log('User not authenticated, disconnecting WebSocket');
      websocketService.disconnect();
    }
    
    // Cleanup on unmount
    return () => {
      console.log('Component unmounting, cleaning up WebSocket connection');
      websocketService.disconnect();
    };
  }, [user]);
}

export default useWebSocketConnection; 