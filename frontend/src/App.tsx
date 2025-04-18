import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatPage from './pages/ChatPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import ProtectedRoute from './components/ProtectedRoute';
import ThemeProvider from './components/ThemeProvider';
import { Toaster } from 'react-hot-toast';
import ConnectionTest from './components/ConnectionTest';
import useWebSocketConnection from './hooks/useWebSocketConnection';
import './App.css';

// Debug component that only shows the connection test
const ConnectionDebugPage = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="max-w-md w-full">
        <h1 className="text-xl font-bold text-center mb-4">WebSocket Connection Debug</h1>
        <ConnectionTest />
      </div>
    </div>
  );
};

function App() {
  const { checkAuth } = useAuthStore();
  const [loading, setLoading] = useState(true);
  
  // Initialize WebSocket connection
  useWebSocketConnection();

  useEffect(() => {
    const initAuth = async () => {
      await checkAuth();
      setLoading(false);
    };

    initAuth();
  }, [checkAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-dark-900 transition-colors duration-200">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-secondary-500"></div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <div className="transition-colors duration-200">
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'bg-white dark:bg-dark-800 dark:text-white rounded-xl shadow-soft-md',
            duration: 5000,
          }}
        />
        
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          
          {/* Debug Routes */}
          <Route path="/debug/connection" element={<ConnectionDebugPage />} />
          
          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/chat" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat/:contactId"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/contacts"
            element={
              <ProtectedRoute>
                <ContactsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          
          {/* 404 Route */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </ThemeProvider>
  );
}

export default App; 