import { getUserTimezone } from '../utils/dateUtils';
import websocketService from './websocketService';

/**
 * Service to handle timezone-related functionality
 */
class TimezoneService {
  // Store the last timezone we sent to avoid duplicates
  private lastSentTimezone: string | null = null;
  // Add debounce timer
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Add verification interval
  private verificationInterval: ReturnType<typeof setTimeout> | null = null;
  // Track the last time we verified to limit frequency
  private lastVerificationTime: number = 0;
  // Minimum time between verifications (1 hour in milliseconds)
  private readonly MIN_VERIFICATION_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  /**
   * Initialize the service by setting up listeners and sending the initial timezone
   */
  initialize(): void {
    // Send the user's timezone when the app initializes
    this.sendUserTimezone();
    
    // Listen for timezone changes (e.g. when user travels)
    this.listenForTimezoneChanges();
    
    // Setup periodic verification without updating
    this.setupTimezoneVerification();
  }
  
  /**
   * Set up periodic verification of timezone
   * This helps detect if a client has changed timezone without explicitly sending an update
   */
  setupTimezoneVerification(): void {
    // Clear any existing interval
    if (this.verificationInterval) {
      clearInterval(this.verificationInterval);
    }
    
    // Check timezone every hour without updating it
    this.verificationInterval = setInterval(() => {
      this.verifyUserTimezone();
    }, this.MIN_VERIFICATION_INTERVAL); // 1 hour
  }
  
  /**
   * Verify the user's timezone without updating it
   */
  verifyUserTimezone(): void {
    const timezone = getUserTimezone();
    
    // Update last verification time
    this.lastVerificationTime = Date.now();
    
    websocketService.sendUserTimezone(timezone, true);
  }
  
  /**
   * Send the user's current timezone to the server
   */
  sendUserTimezone(): void {
    const timezone = getUserTimezone();
    
    // Don't send if it's the same as what we already sent
    if (this.lastSentTimezone === timezone) {
      console.log('[Timezone] Skipping timezone update - unchanged:', timezone);
      return;
    }
    
    // Update last sent timezone
    this.lastSentTimezone = timezone;
    
    // Update last verification time
    this.lastVerificationTime = Date.now();
    
    // Send timezone through websocket
    websocketService.sendUserTimezone(timezone);
    console.log('[Timezone] Sent timezone update:', timezone);
  }
  
  /**
   * Send timezone with debounce to prevent rapid updates
   */
  debouncedSendTimezone(): void {
    // Clear any pending debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Set a new debounce timer (300ms)
    this.debounceTimer = setTimeout(() => {
      this.sendUserTimezone();
      this.debounceTimer = null;
    }, 300);
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Only check for timezone changes if enough time has passed
        const timeElapsed = Date.now() - this.lastVerificationTime;
        
        if (timeElapsed >= this.MIN_VERIFICATION_INTERVAL / 4) { // Check at most once every 15 minutes
          // Use debounced version to prevent multiple rapid updates
          this.debouncedSendTimezone();
        }
      }
    });
  }
}

export default new TimezoneService(); 