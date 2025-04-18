import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { useAuthStore } from '../stores/authStore';
import apiClient from './apiClient';
import app from './firebaseConfig';

// Define a type for the notification payload
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  icon?: string;
}

// Service Wrapper for Firebase Cloud Messaging
class NotificationService {
  private messaging: any = null;
  private vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  private isInitialized = false;

  // Initialize Firebase Cloud Messaging
  async initialize() {
    try {
      // Check if the browser supports FCM
      const isMessagingSupported = await isSupported();
      if (!isMessagingSupported) {
        console.warn('Firebase Cloud Messaging is not supported in this browser');
        return false;
      }

      // Initialize messaging
      this.messaging = getMessaging(app);
      this.isInitialized = true;
      
      console.log('Firebase Cloud Messaging initialized');
      return true;
    } catch (error) {
      console.error('Error initializing Firebase Cloud Messaging:', error);
      return false;
    }
  }

  // Request permission for notifications
  async requestPermission() {
    if (!this.isInitialized && !(await this.initialize())) {
      return false;
    }

    try {
      // Request permission from the user
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return false;
    }
  }

  // Get the FCM token for the current user
  async getToken() {
    if (!this.isInitialized && !(await this.initialize())) {
      return null;
    }

    try {
      // Get the FCM token
      const currentToken = await getToken(this.messaging, {
        vapidKey: this.vapidKey,
        serviceWorkerRegistration: await this.getServiceWorkerRegistration()
      });

      if (currentToken) {
        // Register the token with our backend
        await this.registerTokenWithBackend(currentToken);
        return currentToken;
      } else {
        console.warn('No FCM token available. Request permission first.');
        return null;
      }
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  // Get service worker registration
  private async getServiceWorkerRegistration() {
    try {
      return await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    } catch (error) {
      console.error('Error getting service worker registration:', error);
      return undefined;
    }
  }

  // Register the FCM token with our backend
  async registerTokenWithBackend(token: string) {
    try {
      const { user } = useAuthStore.getState();
      if (!user) {
        console.warn('User not authenticated. Cannot register FCM token.');
        return false;
      }

      await apiClient.post('/user/fcm-token', { token });
      console.log('FCM token registered with backend');
      return true;
    } catch (error) {
      console.error('Error registering FCM token with backend:', error);
      return false;
    }
  }

  // Set up a callback for foreground messages
  onMessage(callback: (payload: NotificationPayload) => void) {
    if (!this.isInitialized) {
      console.warn('FCM not initialized. Call initialize() first.');
      return () => {}; // Return no-op unsubscribe function
    }

    return onMessage(this.messaging, (payload) => {
      console.log('Message received in foreground:', payload);
      
      // Extract notification data from the payload
      const notification: NotificationPayload = {
        title: payload.notification?.title || 'New Message',
        body: payload.notification?.body || '',
        data: payload.data,
        icon: payload.notification?.icon || '/icons/app-icon-192.png'
      };
      
      callback(notification);
    });
  }

  // Display a notification (for foreground messages)
  async displayNotification(notification: NotificationPayload) {
    if (!('Notification' in window)) {
      console.warn('This browser does not support desktop notifications');
      return;
    }

    if (Notification.permission === 'granted') {
      // Create and show the notification
      const notificationOptions = {
        body: notification.body,
        icon: notification.icon,
        data: notification.data,
      };
      
      new Notification(notification.title, notificationOptions);
    }
  }
}

// Create and export a singleton instance
const notificationService = new NotificationService();
export default notificationService; 