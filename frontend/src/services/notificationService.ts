import { useAuthStore } from '../stores/authStore';
import apiClient from './apiClient';
import app, { messaging } from './firebaseConfig';

// Define a type for the notification payload
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  icon?: string;
}

// Define the FCM messaging type
type Messaging = import('firebase/messaging').Messaging;

// Check if notifications are supported in this environment
const isNotificationSupported = () => {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    window.isSecureContext &&
    'serviceWorker' in navigator
  );
};

// Service Wrapper for Firebase Cloud Messaging
class NotificationService {
  private isInitialized = false;
  private vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  private fcmSupported = false;
  
  // Initialize Firebase Cloud Messaging
  async initialize() {
    if (!isNotificationSupported()) {
      console.debug('Notifications are not supported in this browser environment');
      return false;
    }
    
    // If messaging is null, FCM is not supported or failed to initialize
    if (!messaging) {
      console.debug('Firebase Cloud Messaging is not available');
      return false;
    }
    
    try {
      // Check if the browser supports FCM through dynamic import to prevent errors
      const fcmModule = await import('firebase/messaging').catch(() => null);
      if (!fcmModule) {
        console.debug('Firebase Cloud Messaging module could not be loaded');
        return false;
      }
      
      const { isSupported } = fcmModule;
      this.fcmSupported = await isSupported().catch(() => false);
      
      if (!this.fcmSupported) {
        console.debug('Firebase Cloud Messaging is not supported in this browser');
        return false;
      }

      this.isInitialized = true;
      console.debug('Firebase Cloud Messaging initialized successfully');
      return true;
    } catch (error) {
      console.debug('Error initializing Firebase Cloud Messaging:', error);
      return false;
    }
  }

  // Request permission for notifications
  async requestPermission() {
    if (!isNotificationSupported()) {
      return false;
    }
    
    try {
      // Request permission from the user
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.debug('Error requesting notification permission:', error);
      return false;
    }
  }

  // Get the FCM token for the current user
  async getToken() {
    if (!this.isInitialized && !(await this.initialize())) {
      return null;
    }

    if (!this.fcmSupported || !messaging) {
      return null;
    }

    try {
      // Dynamically import to prevent errors
      const { getToken } = await import('firebase/messaging');
      
      // Get the FCM token
      const currentToken = await getToken(messaging, {
        vapidKey: this.vapidKey,
        serviceWorkerRegistration: await this.getServiceWorkerRegistration()
      });

      if (currentToken) {
        // Register the token with our backend
        await this.registerTokenWithBackend(currentToken);
        return currentToken;
      } else {
        console.debug('No FCM token available. Request permission first.');
        return null;
      }
    } catch (error) {
      console.debug('Error getting FCM token:', error);
      return null;
    }
  }

  // Get service worker registration
  private async getServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) {
      return undefined;
    }
    
    try {
      return await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    } catch (error) {
      console.debug('Error getting service worker registration:', error);
      return undefined;
    }
  }

  // Register the FCM token with our backend
  async registerTokenWithBackend(token: string) {
    try {
      const { user } = useAuthStore.getState();
      if (!user) {
        console.debug('User not authenticated. Cannot register FCM token.');
        return false;
      }

      await apiClient.post('/user/fcm-token', { token });
      console.debug('FCM token registered with backend');
      return true;
    } catch (error) {
      console.debug('Error registering FCM token with backend:', error);
      return false;
    }
  }

  // Set up a callback for foreground messages
  async onMessage(callback: (payload: NotificationPayload) => void) {
    if (!this.isInitialized && !(await this.initialize())) {
      return () => {}; // Return no-op unsubscribe function
    }

    if (!this.fcmSupported || !messaging) {
      return () => {}; // Return no-op unsubscribe function
    }

    try {
      // Dynamically import to prevent errors
      const { onMessage: fcmOnMessage } = await import('firebase/messaging');
      
      return fcmOnMessage(messaging, (payload) => {
        console.debug('Message received in foreground:', payload);
        
        // Extract notification data from the payload
        const notification: NotificationPayload = {
          title: payload.notification?.title || 'New Message',
          body: payload.notification?.body || '',
          data: payload.data,
          icon: payload.notification?.icon || '/icons/app-icon-192.png'
        };
        
        callback(notification);
      });
    } catch (error) {
      console.debug('Error setting up message listener:', error);
      return () => {}; // Return no-op unsubscribe function
    }
  }

  // Display a notification (for foreground messages)
  async displayNotification(notification: NotificationPayload) {
    if (!isNotificationSupported()) {
      return;
    }

    try {
      if (Notification.permission === 'granted') {
        // Create and show the notification
        const notificationOptions = {
          body: notification.body,
          icon: notification.icon,
          data: notification.data,
        };
        
        new Notification(notification.title, notificationOptions);
      }
    } catch (error) {
      console.debug('Error displaying notification:', error);
    }
  }
}

// Create and export a singleton instance
const notificationService = new NotificationService();
export default notificationService; 