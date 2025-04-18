import { useState, useEffect } from 'react';
import websocketService from '../services/websocketService';
import { useAuthStore } from '../stores/authStore';

const WebSocketDebugger = () => {
  const [connectionState, setConnectionState] = useState('unknown');
  const [showDebug, setShowDebug] = useState(false);
  const [lastReconnect, setLastReconnect] = useState<string>('');
  const [lastError, setLastError] = useState<string>('');
  const { user } = useAuthStore();
  
  useEffect(() => {
    // Check connection state every second
    const interval = setInterval(() => {
      setConnectionState(websocketService.getConnectionState());
    }, 1000);
    
    // Subscribe to websocket errors
    const errorHandler = (error: any) => {
      const errorMsg = typeof error === 'string' ? error : 
        (error?.message || JSON.stringify(error));
      setLastError(`${new Date().toLocaleTimeString()}: ${errorMsg}`);
    };
    
    // Add error listener
    websocketService.onError(errorHandler);
    
    return () => {
      clearInterval(interval);
      websocketService.offError(errorHandler);
    };
  }, []);
  
  const handleReconnect = () => {
    setLastReconnect(new Date().toLocaleTimeString());
    websocketService.connect();
  };
  
  const handleSendTestMessage = () => {
    if (!user) {
      alert('You must be logged in to send a test message');
      return;
    }
    
    // Send a test message to yourself
    websocketService.sendMessage(user.id, "Test message from debugger", []);
  };
  
  const handleSendRawMessage = () => {
    if (!user) {
      alert('You must be logged in to send a test message');
      return;
    }
    
    // Create a properly formatted message
    const rawMsg = {
      type: 'message',
      from: user.id,
      to: user.id,
      payload: {
        id: `test-${Date.now()}`,
        text: 'Raw format test message',
        timestamp: new Date().toISOString(),
        status: 'sent'
      }
    };
    
    // Access the private socket directly for testing
    // This uses a global workaround for testing only
    const socket = (websocketService as any).socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(rawMsg));
      console.log('Sent raw test message:', rawMsg);
    } else {
      setLastError(`${new Date().toLocaleTimeString()}: Socket not open`);
    }
  };
  
  if (!showDebug) {
    const indicatorColor = 
      connectionState === 'connected' ? 'bg-green-500' :
      connectionState === 'connecting' ? 'bg-yellow-500' :
      'bg-red-500';
      
    return (
      <button 
        onClick={() => setShowDebug(true)} 
        className="fixed bottom-4 right-4 z-50 p-2 bg-gray-800 text-white rounded-md text-xs flex items-center"
      >
        <div className={`w-2 h-2 rounded-full ${indicatorColor} mr-2`}></div>
        Debug
      </button>
    );
  }
  
  const connectionColor = 
    connectionState === 'connected' ? 'bg-green-500' :
    connectionState === 'connecting' ? 'bg-yellow-500' :
    'bg-red-500';
    
  return (
    <div className="fixed bottom-4 right-4 z-50 p-3 bg-white shadow-lg rounded-md border border-gray-200 w-64">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-bold">WebSocket Debugger</h3>
        <button 
          onClick={() => setShowDebug(false)}
          className="text-gray-500 hover:text-gray-700"
        >
          ×
        </button>
      </div>
      
      <div className="mb-2">
        <div className="flex items-center mb-1">
          <div className={`w-3 h-3 rounded-full ${connectionColor} mr-2`}></div>
          <span className="text-xs">Status: {connectionState}</span>
        </div>
        
        <div className="text-xs mb-1">
          User: {user ? user.id : 'Not logged in'}
        </div>
        
        <div className="text-xs mb-1">
          API URL: {import.meta.env.VITE_API_BASE_URL || 'default'}
        </div>
        
        <div className="text-xs mb-2">
          WS URL: {import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws'}
        </div>
        
        {lastReconnect && (
          <div className="text-xs mb-2">
            Last reconnect: {lastReconnect}
          </div>
        )}
        
        {lastError && (
          <div className="text-xs mb-2 text-red-500 border-t border-red-200 pt-1 mt-1">
            Last error: {lastError}
          </div>
        )}
      </div>
      
      <div className="flex space-x-2 flex-wrap">
        <button 
          onClick={handleReconnect}
          className="text-xs bg-blue-500 text-white py-1 px-2 rounded hover:bg-blue-600 mb-2"
        >
          Reconnect
        </button>
        
        <button 
          onClick={handleSendTestMessage}
          className="text-xs bg-green-500 text-white py-1 px-2 rounded hover:bg-green-600 mb-2"
          disabled={!user || connectionState !== 'connected'}
        >
          Test Message
        </button>
        
        <button 
          onClick={handleSendRawMessage}
          className="text-xs bg-purple-500 text-white py-1 px-2 rounded hover:bg-purple-600 w-full"
          disabled={!user || connectionState !== 'connected'}
        >
          Send Raw Format Message
        </button>
      </div>
    </div>
  );
};

export default WebSocketDebugger; 