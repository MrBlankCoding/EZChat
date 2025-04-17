import { create } from 'zustand';
import authService from '../services/authService';

// Define user interface
export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  status?: 'online' | 'offline' | 'away';
}

// Define auth state interface
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  setUser: (userData: User) => void;
}

// Create auth store with zustand
const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  initialized: false,

  // Login function
  login: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });
      const user = await authService.login(email, password);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      console.error('Login error:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to login',
        isLoading: false,
        isAuthenticated: false
      });
    }
  },

  // Register function
  register: async (email: string, password: string, displayName: string) => {
    try {
      set({ isLoading: true, error: null });
      const user = await authService.register(email, password, displayName);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      console.error('Registration error:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to register',
        isLoading: false 
      });
    }
  },

  // Logout function
  logout: async () => {
    try {
      set({ isLoading: true, error: null });
      await authService.logout();
      set({ user: null, isAuthenticated: false, isLoading: false });
    } catch (error) {
      console.error('Logout error:', error);
      set({ 
        error: error instanceof Error ? error.message : 'Failed to logout',
        isLoading: false 
      });
    }
  },

  // Check authentication status
  checkAuth: async () => {
    try {
      set({ isLoading: true, error: null });
      const user = await authService.checkAuth();
      set({ 
        user, 
        isAuthenticated: !!user, 
        isLoading: false,
        initialized: true
      });
    } catch (error) {
      console.error('Auth check error:', error);
      set({ 
        user: null,
        isAuthenticated: false,
        error: error instanceof Error ? error.message : 'Authentication check failed',
        isLoading: false,
        initialized: true
      });
    }
  },

  // Clear error message
  clearError: () => set({ error: null }),

  // Update user data
  setUser: (userData: User) => set({ user: userData })
}));

export { useAuthStore }; 