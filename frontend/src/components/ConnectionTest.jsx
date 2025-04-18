import { useState, useEffect } from 'react';
import websocketService from '../services/websocketService';

const ConnectionTest = () => {
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [testResult, setTestResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);

  // Test connection on mount
  useEffect(() => {
    checkConnection();
    
    // Set up interval to check connection status every 10 seconds
    const intervalId = setInterval(() => {
      updateConnectionStatus();
    }, 10000);
    
    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, []);

  // Update status without running full test
  const updateConnectionStatus = () => {
    const status = websocketService.getConnectionState();
    setConnectionStatus(status.state);
    setDetails(status);
  };

  // Run full connection test
  const checkConnection = async () => {
    setLoading(true);
    try {
      // Update current status first
      updateConnectionStatus();
      
      // Run actual connection test
      const result = await websocketService.testConnection();
      setTestResult(result);
      
      // Update status again after test
      updateConnectionStatus();
    } catch (error) {
      console.error('Connection test error:', error);
      setTestResult(false);
    } finally {
      setLoading(false);
    }
  };

  // Force a reconnection
  const forceReconnect = async () => {
    setLoading(true);
    try {
      // Disconnect first
      websocketService.disconnect();
      // Wait a moment to ensure disconnect completes
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Reconnect
      await websocketService.connect();
      // Check connection after reconnect
      await checkConnection();
    } catch (error) {
      console.error('Reconnection error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'disconnected': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <div className="p-4 bg-white dark:bg-dark-800 rounded-lg shadow-soft">
      <h2 className="text-lg font-semibold mb-4">WebSocket Connection Test</h2>
      
      <div className="mb-4">
        <div className="flex items-center mb-2">
          <span className="font-medium mr-2">Status:</span>
          <span className={`font-bold ${getStatusColor()}`}>
            {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
          </span>
        </div>
        
        {testResult !== null && (
          <div className="mb-2">
            <span className="font-medium mr-2">Test Result:</span>
            <span className={`font-bold ${testResult ? 'text-green-500' : 'text-red-500'}`}>
              {testResult ? 'Success' : 'Failed'}
            </span>
          </div>
        )}
        
        {details && (
          <div className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            <div>WebSocket state: {details.readyState}</div>
            <div>Connection state: {details.state}</div>
            {details.lastError && <div className="text-red-500">Last error: {details.lastError}</div>}
          </div>
        )}
      </div>
      
      <div className="flex space-x-3">
        <button 
          onClick={checkConnection}
          disabled={loading}
          className="px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Connection'}
        </button>
        
        <button 
          onClick={forceReconnect}
          disabled={loading}
          className="px-4 py-2 bg-secondary-500 text-white rounded-md hover:bg-secondary-600 disabled:opacity-50"
        >
          {loading ? 'Reconnecting...' : 'Force Reconnect'}
        </button>
      </div>
    </div>
  );
};

export default ConnectionTest; 