import { useAuthStore } from '../stores/authStore';
import { useContactsStore } from '../stores/contactsStore';
import { useChatStore } from '../stores/chatStore';
import websocketService from './websocketService';

// Enum for user presence states
export enum PresenceState {
  ONLINE = 'online',
  AWAY = 'away',
  OFFLINE = 'offline'
}

class PresenceManager {
  private presenceInterval: ReturnType<typeof setInterval> | null = null;
  private activityTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastActivity: number = Date.now();
  private currentState: PresenceState = PresenceState.ONLINE;
  private idleThreshold: number = 5 * 60 * 1000; // 5 minutes
  private initialized: boolean = false;
  private connectionCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPresenceUpdate: number = 0;
  private MIN_PRESENCE_UPDATE_INTERVAL: number = 5000; // 5 seconds minimum between updates
  
  // Initialize the presence manager
  initialize(): void {
    if (this.initialized) return;
    
    // console.log('[Presence] Initializing presence manager');
    this.initialized = true;
    
    // Send initial presence update
    this.updatePresence(PresenceState.ONLINE, true);
    
    // Start periodic presence updates
    this.startPresenceInterval();
    
    // Set up activity monitoring
    this.setupActivityMonitoring();
    
    // Set up page visibility monitoring
    this.setupVisibilityMonitoring();
    
    // Set up before unload handler
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    
    // Start connection check timer to ensure presence is maintained
    this.startConnectionCheck();
  }
  
  // Start connection check timer
  private startConnectionCheck(): void {
    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
    }
    
    // Check connection status every 30 seconds
    this.connectionCheckTimer = setInterval(() => {
      // Test the WebSocket connection
      websocketService.testConnection().then(connected => {
        if (!connected) {
          // console.log('[Presence] WebSocket connection test failed, attempting to reconnect');
          websocketService.connect().then(() => {
            // Force resend presence after reconnection
            this.updatePresence(this.currentState, true);
          }).catch(error => {
            console.error('[Presence] Failed to reconnect WebSocket:', error);
          });
        }
      });
    }, 30 * 1000); // 30 seconds
  }
  
  // Clean up resources
  cleanup(): void {
    // console.log('[Presence] Cleaning up presence manager');
    
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }
    
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }
    
    if (this.connectionCheckTimer) {
      clearInterval(this.connectionCheckTimer);
      this.connectionCheckTimer = null;
    }
    
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    
    // Broadcast offline status
    this.updatePresence(PresenceState.OFFLINE, true);
    
    this.initialized = false;
  }
  
  // Handle before unload event (user closing tab/browser)
  private handleBeforeUnload = (): void => {
    this.updatePresence(PresenceState.OFFLINE, true);
  };
  
  // Set up monitoring for user activity
  private setupActivityMonitoring(): void {
    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'click'];
    
    const handleUserActivity = (): void => {
      this.lastActivity = Date.now();
      
      // If we were away, update to online
      if (this.currentState === PresenceState.AWAY) {
        this.updatePresence(PresenceState.ONLINE);
      }
      
      // Reset the idle timeout
      this.resetIdleTimeout();
    };
    
    // Add activity event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, handleUserActivity);
    });
    
    // Set initial idle timeout
    this.resetIdleTimeout();
  }
  
  // Set up monitoring for page visibility
  private setupVisibilityMonitoring(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // User has returned to the page
        this.updatePresence(PresenceState.ONLINE, true); // Force update when returning to page
        this.lastActivity = Date.now();
        this.resetIdleTimeout();
      } else if (document.visibilityState === 'hidden') {
        // User has left the page
        this.updatePresence(PresenceState.AWAY);
      }
    });
  }
  
  // Reset the idle timeout that detects inactivity
  private resetIdleTimeout(): void {
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
    }
    
    this.activityTimeout = setTimeout(() => {
      // User has been idle for the threshold time
      this.updatePresence(PresenceState.AWAY);
    }, this.idleThreshold);
  }
  
  // Start sending periodic presence updates
  private startPresenceInterval(): void {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
    }
    
    // Send presence update more frequently - every 45 seconds
    this.presenceInterval = setInterval(() => {
      // Only send if we're still logged in
      if (useAuthStore.getState().isAuthenticated) {
        // Force update periodically to ensure everyone has the right status
        this.updatePresence(this.currentState, true);
      } else {
        // If we're no longer authenticated, clean up
        this.cleanup();
      }
    }, 45 * 1000); // 45 seconds
  }
  
  // Update the user's presence state
  updatePresence(state: PresenceState, force: boolean = false): void {
    const prevState = this.currentState;
    this.currentState = state;
    
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastPresenceUpdate;
    
    // Only send update if state changed or forcing update
    // AND respect the minimum update interval to prevent spamming
    if ((force || prevState !== state) && 
        (force || timeSinceLastUpdate > this.MIN_PRESENCE_UPDATE_INTERVAL)) {
      // console.log(`[Presence] ${force ? 'Forcing' : 'Updating'} state from ${prevState} to ${state}`);
      
      // Set the timestamp before sending to prevent multiple rapid updates
      this.lastPresenceUpdate = now;
      
      // Ensure the WebSocket is connected before sending
      if (websocketService.isConnected()) {
        websocketService.sendPresenceUpdate(state);
      } else {
        // console.log('[Presence] WebSocket not connected, connecting before sending presence');
        websocketService.connect().then(() => {
          websocketService.sendPresenceUpdate(state);
        }).catch(error => {
          console.error('[Presence] Failed to connect WebSocket for presence update:', error);
        });
      }
    }
  }
  
  // Force update presence state (useful for manual status changes)
  forceUpdatePresence(state: PresenceState): void {
    this.currentState = state;
    this.updatePresence(state, true);
  }
  
  // Get current presence state
  getCurrentState(): PresenceState {
    return this.currentState;
  }
  
  // Update idle threshold (time before user is considered away)
  setIdleThreshold(minutes: number): void {
    this.idleThreshold = minutes * 60 * 1000;
    this.resetIdleTimeout();
  }
  
  // Update a specific contact's status in the stores
  updateContactStatus(contactId: string, status: PresenceState): void {
    // Ignore updates about our own status
    const { user } = useAuthStore.getState();
    if (user && user.id === contactId) {
      return;
    }
    
    // Update in contacts store
    try {
      const contactsStore = useContactsStore.getState();
      if (contactsStore && typeof contactsStore.updateContactPresence === 'function') {
        contactsStore.updateContactPresence(contactId, status);
      }
    } catch (error) {
      console.warn('[Presence] Could not update contacts store:', error);
    }
    
    // Update in chat store
    try {
      const chatStore = useChatStore.getState();
      if (chatStore && typeof chatStore.updateContactStatus === 'function') {
        chatStore.updateContactStatus(contactId, status);
      }
    } catch (error) {
      console.warn('[Presence] Could not update chat store:', error);
    }
    
    // console.log(`[Presence] Updated contact ${contactId} status to ${status}`);
  }
  
  // Get a contact's current status
  getContactStatus(contactId: string): PresenceState {
    try {
      const contactsStore = useContactsStore.getState();
      const contact = contactsStore.contacts.find(c => c.contact_id === contactId);
      
      // Map contact_status to PresenceState
      if (contact?.contact_status === PresenceState.ONLINE) return PresenceState.ONLINE;
      if (contact?.contact_status === PresenceState.AWAY) return PresenceState.AWAY;
      if (contact?.contact_status === 'online') return PresenceState.ONLINE;
      if (contact?.contact_status === 'away') return PresenceState.AWAY;
      
      return PresenceState.OFFLINE;
    } catch (error) {
      console.warn('[Presence] Error getting contact status:', error);
      return PresenceState.OFFLINE;
    }
  }
}

// Create singleton instance
const presenceManager = new PresenceManager();

export default presenceManager; 