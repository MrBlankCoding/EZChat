import axios from 'axios';
import { auth } from './firebaseConfig';

// Log API base URL
console.log('API Base URL:', import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api');

// Create axios instance
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  // We're using Bearer token auth, not cookies, so disable withCredentials
  withCredentials: false,
});

// Add a request interceptor to add the auth token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      }
      console.log(`Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
      return config;
    } catch (error) {
      console.error('Error getting auth token:', error);
      return config;
    }
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Add a response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    console.log(`Response from ${response.config.url}: Status ${response.status}`);
    return response;
  },
  (error) => {
    // Handle common errors (e.g., unauthorized, server errors)
    if (error.response) {
      const { status, data } = error.response;
      console.error(`API error ${status} from ${error.config?.url}:`, data);
      
      if (status === 401) {
        console.log('Session expired. Please login again.');
        // Optionally trigger logout or redirect to login
      } else if (status === 500) {
        console.error('Internal server error');
      } else if (status === 404) {
        console.error('Endpoint not found');
      } else if (status === 403) {
        console.error('Forbidden: Access denied');
      }
    } else if (error.request) {
      console.error('No response received from server. Possible CORS or network issue:', error.request);
      console.error('Request details:', {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
      });
    } else {
      console.error('Error setting up request:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// Add named export for the apiClient
export { apiClient };

// Default export
export default apiClient; 