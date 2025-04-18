import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

enum MessageType {
  MESSAGE = "message",
  TYPING = "typing",
  STATUS = "status",
  DELIVERY_RECEIPT = "delivery_receipt",
  READ_RECEIPT = "read_receipt",
  ERROR = "error",
  PRESENCE = "presence"
}

interface WebSocketMessage {
  type: MessageType;
  from?: string;
  to?: string | null;
  from_user?: string;
  to_user?: string;
  message_id?: string;
  _id?: string;
  sender_id?: string;
  recipient_id?: string;
  text?: string;
  timestamp?: string;
  created_at?: string;
  status?: 'sent' | 'delivered' | 'read';
  attachments?: any[];
  is_typing?: boolean;
  payload: any;
}

class WebSocketService {
  private socket: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private errorHandlers: Array<(error: any) => void> = [];
  
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.connectionState === 'connecting') {
      console.log('[WS] Already connected or connecting, skipping connection');
      return;
    }
    
    // Reset any previous reconnect attempts if this is a fresh connection
    if (this.connectionState === 'disconnected') {
      this.reconnectAttempts = 0;
    }
    
    this.connectionState = 'connecting';
    console.log('[WS] Initiating connection...');
    
    try {
      const { user } = useAuthStore.getState();
      if (!user) {
        console.error('[WS] Cannot connect: User not authenticated');
        this.connectionState = 'disconnected';
        return;
      }

      const auth = (await import('./firebaseConfig')).auth;
      
      // Try to refresh the token to ensure it's valid
      try {
        await auth.currentUser?.getIdToken(true); // Force refresh token
      } catch (refreshError) {
        console.warn('[WS] Token refresh failed:', refreshError);
        // Continue with the existing token
      }
      
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        console.error('[WS] Cannot connect: No authentication token available');
        this.connectionState = 'disconnected';
        return;
      }
      
      // Log connection details to help debugging
      console.log('[WS] Connecting with user:', user.id);
      
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws'}?token=${token}`;
      
      // Close any existing connection properly
      if (this.socket) {
        try {
          this.socket.onclose = null; // Prevent reconnect trigger on intentional close
          this.socket.close();
        } catch (err) {
          console.warn('[WS] Error closing existing socket:', err);
        }
        this.socket = null;
      }
      
      // Create and configure new WebSocket
      this.socket = new WebSocket(wsUrl);
      
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (this.connectionState === 'connecting') {
          console.error('[WS] Connection timeout');
          if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
            this.connectionState = 'disconnected';
            this.handleClose({ code: 1006, reason: 'Connection timeout', wasClean: false } as CloseEvent);
          }
        }
      }, 10000); // 10 second timeout
      
      // Set up event handlers
      this.socket.onopen = (event) => {
        clearTimeout(connectionTimeout);
        this.handleOpen();
      };
      
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('[WS] Error connecting to WebSocket:', error);
      this.connectionState = 'disconnected';
      this.handleClose({ code: 1006, reason: `Connection setup failed: ${error}`, wasClean: false } as CloseEvent);
    }
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.connectionState = 'disconnected';
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    this.reconnectAttempts = 0;
  }
  
  private handleOpen() {
    console.log('[WS] Connection ESTABLISHED successfully');
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.pingInterval = setInterval(() => this.sendPing(), 30000);
  }

  private parseMessage(data: string): WebSocketMessage | null {
    try {
      // First check if it's a plain string message
      if (typeof data === 'string' && (data === 'ping' || data === 'pong')) {
        return null;
      }
      
      // Handle potential non-JSON messages 
      try {
        return JSON.parse(data);
      } catch (parseError) {
        console.error('Error parsing WebSocket message JSON:', parseError);
        console.log('Raw message data:', data);
        
        // If it's not valid JSON but looks like a string message, create a structured error message
        if (typeof data === 'string') {
          return {
            type: MessageType.ERROR,
            payload: {
              message: `Invalid JSON format: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`
            }
          };
        }
        this.notifyErrorHandlers(`Parse error: ${parseError}`);
        return null;
      }
    } catch (error) {
      console.error('Unexpected error handling message data:', error);
      this.notifyErrorHandlers(`Message handling error: ${error}`);
      return null;
    }
  }

  private transformMessage(data: WebSocketMessage) {
    const message = {
      id: data.payload?.id || data.payload?._id || data.payload?.message_id || 
          data.message_id || data._id || `msg-${Date.now()}`,
      senderId: data.payload?.senderId || data.payload?.sender_id || 
                data.from || data.from_user || data.sender_id || 
                data.payload?.from_user || 'unknown',
      receiverId: data.payload?.receiverId || data.payload?.recipient_id || 
                  data.to || data.to_user || data.recipient_id || 
                  data.payload?.to_user || 'unknown',
      text: data.payload?.text || data.text || '',
      timestamp: data.payload?.timestamp || data.payload?.created_at || 
                 data.timestamp || data.created_at || new Date().toISOString(),
      status: (data.payload?.status as 'sent' | 'delivered' | 'read') || 
              (data.status as 'sent' | 'delivered' | 'read') || 'sent',
      attachments: data.payload?.attachments || data.attachments || []
    };

    return message;
  }
  
  private handleMessage(event: MessageEvent) {
    try {
      if (event.data === 'pong' || event.data === 'ping') {
        // Ignore ping/pong heartbeat messages
        return;
      }
      
      const data = this.parseMessage(event.data);
      if (!data) {
        return; // Already logged in parseMessage
      }
      
      if (!data.type) {
        console.warn('Received malformed WebSocket message:', event.data);
        this.notifyErrorHandlers('Malformed message received');
        return;
      }
      
      const chatStore = useChatStore.getState();
      const { user } = useAuthStore.getState();
      
      switch (data.type) {
        case MessageType.MESSAGE:
          const message = this.transformMessage(data);
          
          if (message.senderId !== 'unknown' && message.receiverId !== 'unknown') {
            chatStore.addMessage(message);
            
            if (user && user.id !== message.senderId) {
              this.sendReadReceipt(message.senderId, message.id);
            }
          }
          break;
          
        case MessageType.TYPING:
          const senderId = data.from || data.from_user || data.sender_id || data.payload?.sender_id;
          const isTyping = data.payload?.isTyping ?? data.is_typing;
          
          if (senderId) {
            chatStore.setTypingIndicator(senderId, isTyping);
          }
          break;
          
        case MessageType.STATUS:
          if (data.payload?.userId) {
            chatStore.updateContactStatus(data.payload.userId, data.payload.status);
          }
          break;
          
        case MessageType.DELIVERY_RECEIPT:
          if (data.payload?.messageId && data.payload?.contactId) {
            chatStore.updateMessageStatus(
              data.payload.messageId, 
              data.payload.contactId, 
              'delivered'
            );
          }
          break;
          
        case MessageType.READ_RECEIPT:
          if (data.payload?.messageId && data.payload?.contactId) {
            chatStore.updateMessageStatus(
              data.payload.messageId, 
              data.payload.contactId, 
              'read'
            );
          }
          break;
          
        case MessageType.PRESENCE:
          if (data.payload?.status && data.from) {
            chatStore.updateContactStatus(data.from, data.payload.status);
          }
          break;
          
        case MessageType.ERROR:
          const errorDetails = data.payload?.message || 'Unknown server error';
          console.error('WebSocket error from server:', errorDetails);
          this.notifyErrorHandlers(errorDetails);
          break;
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.notifyErrorHandlers(`Message handling error: ${error}`);
    }
  }
  
  private handleClose(event: CloseEvent) {
    console.log(`[WS] Connection CLOSED: Code ${event.code} - Reason: "${event.reason}" - Clean: ${event.wasClean}`);
    this.connectionState = 'disconnected';
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Don't reconnect for normal closures (1000) or if auth failed (1008)
    if (event.code === 1000 || event.code === 1008) {
      console.log(`[WS] Clean disconnect or auth failure - not reconnecting`);
      this.reconnectAttempts = 0;
      return;
    }
    
    // Don't reconnect if user is not authenticated
    const { user } = useAuthStore.getState();
    if (!user) {
      console.log(`[WS] No authenticated user - not reconnecting`);
      this.reconnectAttempts = 0;
      return;
    }
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
      
      console.log(`[WS] Reconnect attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} scheduled in ${Math.round(delay/1000)}s`);
      
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        console.log(`[WS] Attempting reconnect #${this.reconnectAttempts}...`);
        this.connect();
      }, delay);
    } else {
      console.error('[WS] Maximum reconnect attempts reached. Connection lost.');
      // Notify application about permanent connection failure
      this.notifyErrorHandlers({
        type: 'connection_failed',
        message: 'Failed to establish a stable connection after multiple attempts'
      });
    }
  }
  
  private handleError(error: Event) {
    console.error('WebSocket error:', error);
    
    // Check for connection issues
    const isNetworkError = !navigator.onLine;
    if (isNetworkError) {
      console.error('[WS] Network connection unavailable');
    }
    
    const connectionDetails = {
      readyState: this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'No socket',
      url: this.socket?.url || 'Not connected',
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      networkOnline: navigator.onLine,
      userInfo: useAuthStore.getState().user ? 'User authenticated' : 'No user authenticated'
    };
    console.error('WebSocket connection details:', connectionDetails);
    
    // If we're in CONNECTING state, this is likely a connection failure
    if (this.socket?.readyState === WebSocket.CONNECTING) {
      console.error('[WS] Error occurred during connection attempt');
      
      // Force a socket close to trigger reconnect
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          // Ignore errors on closing
        }
      }
    }
    
    this.notifyErrorHandlers({
      type: 'websocket_error',
      originalError: error,
      connectionDetails
    });
  }
  
  private getReadyStateLabel(readyState: number): string {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[readyState] || `UNKNOWN (${readyState})`;
  }
  
  private send(message: WebSocketMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    
    if (this.connectionState !== 'connected') {
      this.connect().then(() => {
        setTimeout(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
          }
        }, 1000);
      });
    }
    
    return false;
  }
  
  private sendPing() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send('ping');
    }
  }
  
  sendMessage(contactId: string, text: string, attachments: any[] = []) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    const message = {
      id: messageId,
      senderId: user.id,
      receiverId: contactId,
      text,
      attachments,
      timestamp,
      status: 'sent' as const
    };
    
    useChatStore.getState().addMessage(message);
    
    this.send({
      type: MessageType.MESSAGE,
      from: user.id,
      to: contactId,
      payload: {
        id: messageId,
        sender_id: user.id,
        recipient_id: contactId,
        text,
        timestamp,
        status: 'sent',
        attachments
      }
    });
    
    return messageId;
  }
  
  sendTypingIndicator(contactId: string, isTyping: boolean) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    this.send({
      type: MessageType.TYPING,
      from: user.id,
      to: contactId,
      is_typing: isTyping,
      payload: {
        isTyping
      }
    });
  }
  
  sendReadReceipt(contactId: string, messageId: string) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    this.send({
      type: MessageType.READ_RECEIPT,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        contactId,
        status: 'read',
        timestamp: new Date().toISOString()
      }
    });
  }
  
  getConnectionState() {
    return {
      state: this.connectionState,
      readyState: this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'No socket',
      reconnectAttempts: this.reconnectAttempts,
      url: this.socket?.url || null
    };
  }
  
  async testConnection() {
    const status = this.getConnectionState();
    const { user } = useAuthStore.getState();
    
    // Not connected or no user - reconnect
    if (status.state !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) {
      this.disconnect();
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.connect();
    }
    
    // Check if we're connected with the right user ID
    if (user && this.socket?.url) {
      const socketUrl = this.socket.url;
      // If the URL contains a different user ID, reconnect
      if (!socketUrl.includes(user.id) && 
          this.connectionState === 'connected') {
        console.log('[WS] User ID mismatch, reconnecting with correct ID');
        this.disconnect();
        await new Promise(resolve => setTimeout(resolve, 500));
        return this.connect();
      }
    }
    
    this.sendPing();
    return Promise.resolve();
  }
  
  onError(handler: (error: any) => void): void {
    this.errorHandlers.push(handler);
  }
  
  offError(handler: (error: any) => void): void {
    this.errorHandlers = this.errorHandlers.filter(h => h !== handler);
  }
  
  private notifyErrorHandlers(error: any): void {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (e) {
        console.error('Error in WebSocket error handler:', e);
      }
    });
  }
}

const websocketService = new WebSocketService();

export default websocketService;