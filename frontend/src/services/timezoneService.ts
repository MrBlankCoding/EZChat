import { getUserTimezone } from '../utils/dateUtils';
import websocketService from './websocketService';

/**
 * Service to handle timezone-related functionality
 */
class TimezoneService {
  /**
   * Initialize the service by setting up listeners and sending the initial timezone
   */
  initialize(): void {
    // Send the user's timezone when the app initializes
    this.sendUserTimezone();
    
    // Listen for timezone changes (e.g. when user travels)
    this.listenForTimezoneChanges();
  }
  
  /**
   * Send the user's current timezone to the server
   */
  sendUserTimezone(): void {
    const timezone = getUserTimezone();
    
    // Send timezone through websocket
    websocketService.sendUserTimezone(timezone);
  }
  
  /**
   * Listen for timezone changes on the device
   */
  listenForTimezoneChanges(): void {
    // Check if Intl.DateTimeFormat().resolvedOptions().timeZone is supported
    if (!Intl.DateTimeFormat().resolvedOptions().timeZone) {
      console.warn('Timezone detection not fully supported in this browser');
      return;
    }
    
    // This is a simple check that runs when the tab becomes visible again
    // More sophisticated timezone change detection would require additional logic
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const currentTz = getUserTimezone();
        this.sendUserTimezone();
      }
    });
  }
}

export default new TimezoneService(); 