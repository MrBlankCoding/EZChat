import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getMessaging } from 'firebase/messaging';

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

// Initialize Messaging conditionally (only in browser environment)
let messaging = null;
try {
  // Check if we're in a browser environment that supports FCM
  if (typeof window !== 'undefined' && 'Notification' in window) {
    messaging = getMessaging(app);
  }
} catch (error) {
  console.warn('Firebase Messaging initialization failed:', error);
}

export { auth, storage, messaging };
export default app; 