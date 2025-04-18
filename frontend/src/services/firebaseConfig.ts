import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import type { Messaging } from 'firebase/messaging';

// Ensure the browser polyfill is loaded
import './browserPolyfill';

// Your Firebase configuration
// Replace with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const storage = getStorage(app);

// Initialize Messaging conditionally (only in supported browsers)
let messaging: Messaging | null = null;

// Check if the browser supports FCM
const isFCMSupported = () => {
  if (typeof window === 'undefined') return false;
  
  // Check if running in a secure context
  if (!window.isSecureContext) return false;
  
  // Check if service workers are supported
  if (!('serviceWorker' in navigator)) return false;
  
  // Check if notification API is available
  if (!('Notification' in window)) return false;
  
  return true;
};

// Only try to initialize messaging if browser supports it
if (isFCMSupported()) {
  try {
    // Dynamically import to prevent errors in unsupported browsers
    import('firebase/messaging').then(({ getMessaging }) => {
      try {
        messaging = getMessaging(app);
        console.log('Firebase Cloud Messaging initialized successfully');
      } catch (e) {
        console.debug('Failed to initialize messaging:', e);
        messaging = null;
      }
    }).catch(error => {
      console.debug('Firebase Cloud Messaging not available:', error);
      // Silent fallback - no need to show error to users
    });
  } catch (error) {
    console.debug('Firebase Messaging import failed:', error);
    // Silent fallback - no need to show error to users
  }
} else {
  console.debug('Firebase Cloud Messaging not supported in this browser');
}

// Safe way to get messaging - returns null if not available
export const getMessagingInstance = () => messaging;

export { auth, storage, messaging };
export default app; 