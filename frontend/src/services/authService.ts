import { User } from '../stores/authStore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, updateProfile, User as FirebaseUser } from 'firebase/auth';
import { auth } from './firebaseConfig';
import apiClient from './apiClient';

// Sign up with email and password
const register = async (email: string, password: string, displayName: string): Promise<User> => {
  try {
    // Create Firebase auth user
    console.log('Starting Firebase registration');
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;
    console.log('Firebase user created:', firebaseUser.uid);
    
    // Update profile with displayName
    try {
      await updateProfile(firebaseUser, { displayName });
      console.log('Firebase profile updated with displayName');
    } catch (profileError) {
      console.error('Error updating Firebase profile:', profileError);
      // Continue despite profile update error
    }
    
    // Get ID token for API registration
    try {
      const idToken = await firebaseUser.getIdToken();
      console.log('Firebase ID token obtained');
      
      // Register with our API
      try {
        console.log('Attempting to register with backend API');
        await apiClient.post('/user/register', {
          email,
          display_name: displayName,
          firebase_uid: firebaseUser.uid,
        }, {
          headers: {
            Authorization: `Bearer ${idToken}`
          }
        });
        console.log('Backend API registration successful');
      } catch (apiError) {
        console.error('Backend API registration failed:', apiError);
        // Continue despite API registration error - user was created in Firebase
      }
    } catch (tokenError) {
      console.error('Error getting Firebase token:', tokenError);
      // Continue despite token error
    }
    
    // Return user object
    return {
      id: firebaseUser.uid,
      email: firebaseUser.email || email,
      displayName: displayName,
      photoURL: firebaseUser.photoURL || undefined,
    };
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

// Sign in with email and password
const login = async (email: string, password: string): Promise<User> => {
  try {
    console.log('Starting Firebase login');
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const firebaseUser = userCredential.user;
    console.log('Firebase login successful:', firebaseUser.uid);
    
    // Return user object
    return {
      id: firebaseUser.uid,
      email: firebaseUser.email || email,
      displayName: firebaseUser.displayName || 'User',
      photoURL: firebaseUser.photoURL || undefined,
    };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

// Sign out
const logout = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
};

// Check if user is authenticated
const checkAuth = (): Promise<User | null> => {
  return new Promise((resolve, reject) => {
    // Using Firebase Auth state change
    const unsubscribe = onAuthStateChanged(auth, 
      (firebaseUser) => {
        unsubscribe();
        if (firebaseUser) {
          // User is signed in
          const user: User = {
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'User',
            photoURL: firebaseUser.photoURL || undefined,
          };
          resolve(user);
        } else {
          // User is signed out
          resolve(null);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
};

// Export individual functions as named exports for the components that need them
export const loginWithEmail = login;
export const registerWithEmail = register;
export const signOut = logout;

const authService = {
  register,
  login,
  logout,
  checkAuth,
};

export default authService; 