import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';

// WebSocket connection states
type ConnectionState = 'connecting' | 'connected' | 'disconnected';

// Message types for WebSocket
enum MessageType {
  MESSAGE = "message",
  TYPING = "typing",
  STATUS = "status",
  DELIVERY_RECEIPT = "delivery_receipt",
  READ_RECEIPT = "read_receipt",
  ERROR = "error",
  PRESENCE = "presence"
}

// Interface for WebSocket messages
interface WebSocketMessage {
  type: MessageType;
  from?: string;
  to?: string | null;
  payload: any;
}

class WebSocketService {
  private socket: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Initial delay in ms
  private errorHandlers: Array<(error: any) => void> = [];
  
  // Connect to WebSocket server
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.connectionState === 'connecting') {
      return;
    }
    
    this.connectionState = 'connecting';
    
    try {
      // Get current user
      const { user } = useAuthStore.getState();
      if (!user) {
        console.error('Cannot connect to WebSocket: User not authenticated');
        return;
      }

      // Get Firebase token
      const auth = (await import('./firebaseConfig')).auth;
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        console.error('Cannot connect to WebSocket: No authentication token available');
        return;
      }
      
      // Connect with token - Use 127.0.0.1 instead of localhost to avoid name resolution issues
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws'}?token=${token}`;
      console.log('Connecting to WebSocket:', wsUrl);
      this.socket = new WebSocket(wsUrl);
      
      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      this.connectionState = 'disconnected';
      this.handleClose({ code: 1006, reason: 'Connection setup failed', wasClean: false } as CloseEvent);
    }
  }
  
  // Disconnect from WebSocket server
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
  
  // Handle WebSocket connection open
  private handleOpen() {
    console.log('WebSocket connection established');
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;
    
    // Setup ping interval
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 30000); // Send ping every 30 seconds
  }
  
  // Handle WebSocket messages
  private handleMessage(event: MessageEvent) {
    try {
      // Check if it's a ping response
      if (event.data === 'pong') {
        console.log('Received pong from server');
        return;
      }
      
      // Try to parse the JSON and log the raw data for debugging
      let data: WebSocketMessage;
      try {
        data = JSON.parse(event.data);
      } catch (parseError) {
        console.error('Error parsing WebSocket message JSON:', parseError);
        console.log('Raw message data:', event.data);
        this.notifyErrorHandlers(`Parse error: ${parseError}`);
        return;
      }
      
      const chatStore = useChatStore.getState();
      
      if (!data || !data.type) {
        console.warn('Received malformed WebSocket message:', event.data);
        this.notifyErrorHandlers('Malformed message received');
        return;
      }
      
      switch (data.type) {
        case MessageType.MESSAGE:
          // Handle incoming message
          if (data.payload) {
            console.log('Received message payload:', data.payload);
            
            // Convert the message format to match our frontend Message interface
            const transformedMessage = {
              id: data.payload.id || data.payload._id,
              senderId: data.payload.senderId || data.payload.sender_id || data.from,
              receiverId: data.payload.receiverId || data.payload.recipient_id || data.to,
              text: data.payload.text || '',
              timestamp: data.payload.timestamp || data.payload.created_at || new Date().toISOString(),
              status: data.payload.status || 'sent',
              attachments: data.payload.attachments || []
            };
            
            // Log for debugging
            console.log('Transformed message:', transformedMessage);
            
            chatStore.addMessage(transformedMessage);
          } else {
            console.warn('Received message with missing payload:', data);
          }
          break;
          
        case MessageType.TYPING:
          // Handle typing indicator
          if (data.payload && data.payload.senderId) {
            chatStore.setTypingIndicator(data.payload.senderId, data.payload.isTyping);
          }
          break;
          
        case MessageType.STATUS:
          // Handle status updates
          if (data.payload && data.payload.userId) {
            chatStore.updateContactStatus(data.payload.userId, data.payload.status);
          }
          break;
          
        case MessageType.DELIVERY_RECEIPT:
          // Handle delivery receipt
          if (data.payload && data.payload.messageId && data.payload.contactId) {
            chatStore.updateMessageStatus(
              data.payload.messageId, 
              data.payload.contactId, 
              'delivered'
            );
          }
          break;
          
        case MessageType.READ_RECEIPT:
          // Handle read receipt
          if (data.payload && data.payload.messageId && data.payload.contactId) {
            chatStore.updateMessageStatus(
              data.payload.messageId, 
              data.payload.contactId, 
              'read'
            );
          }
          break;
          
        case MessageType.ERROR:
          const errorDetails = data.payload && data.payload.message 
            ? data.payload.message 
            : 'Unknown server error';
          
          if (data.payload && data.payload.message) {
            console.error('WebSocket error from server:', data.payload.message, data.payload);
          } else {
            console.error('WebSocket error with no details, full data:', data);
            // Add more detailed diagnostics
            console.log('ERROR message structure:', {
              hasPayload: !!data.payload,
              payloadType: data.payload ? typeof data.payload : 'undefined', 
              payloadKeys: data.payload ? Object.keys(data.payload) : [],
              fullMessage: data
            });
          }
          
          // Notify error handlers
          this.notifyErrorHandlers(errorDetails);
          break;
          
        default:
          console.log('Unhandled message type:', data.type, data);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      console.log('Original message data:', event.data);
      this.notifyErrorHandlers(`Message handling error: ${error}`);
    }
  }
  
  // Handle WebSocket connection close
  private handleClose(event: CloseEvent) {
    this.connectionState = 'disconnected';
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    console.log(`WebSocket connection closed: ${event.code} ${event.reason}`);
    
    // Attempt reconnection if not explicitly disconnected
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectTimer = setTimeout(() => {
        console.log(`Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
        this.reconnectAttempts++;
        this.connect();
      }, this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts)); // Exponential backoff
    } else {
      console.error('Maximum reconnect attempts reached.');
    }
  }
  
  // Handle WebSocket errors
  private handleError(error: Event) {
    console.error('WebSocket error:', error);
    
    // Log extra details about the connection state
    const connectionDetails = {
      readyState: this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'No socket',
      url: this.socket?.url || 'Not connected',
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      userInfo: useAuthStore.getState().user ? 'User authenticated' : 'No user authenticated'
    };
    console.error('WebSocket connection details:', connectionDetails);
    
    // Notify error listeners
    this.notifyErrorHandlers(error);
  }
  
  // Get readable WebSocket ready state
  private getReadyStateLabel(readyState: number): string {
    switch (readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return `UNKNOWN (${readyState})`;
    }
  }
  
  // Send a message through WebSocket
  private send(message: WebSocketMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket is not connected (readyState: ' + 
                   (this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'null') + ')');
      
      // Store message to send later when connection is established
      if (this.connectionState !== 'connected') {
        console.log('Attempting to reconnect WebSocket...');
        this.connect().then(() => {
          // Add a slight delay to ensure connection is established
          setTimeout(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
              console.log('Connection established, sending queued message.');
              this.socket.send(JSON.stringify(message));
            } else {
              console.error('Still not connected after reconnect attempt.');
            }
          }, 1000);
        });
      }
    }
  }
  
  // Send authentication message
  private sendAuth(userId: string) {
    // Note: Auth happens automatically via token in the URL
    // No need to send a separate auth message
    console.log('Authentication handled via token in connection URL');
  }
  
  // Send ping message
  private sendPing() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send('ping');
    }
  }
  
  // Send a chat message
  sendMessage(contactId: string, text: string, attachments: any[] = []) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Convert timestamp to ISO string format for server compatibility
    const timestamp = new Date().toISOString();
    
    // Create message in our frontend format
    const message = {
      id: messageId,
      senderId: user.id,
      receiverId: contactId,
      text,
      attachments,
      timestamp: timestamp,
      status: 'sent' as const
    };
    
    // Log the outgoing message
    console.log('Sending message:', message);
    
    // Add message to local store immediately with the correct sender ID
    useChatStore.getState().addMessage(message);
    
    // Send message through WebSocket with the format expected by backend
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
  
  // Send typing indicator
  sendTypingIndicator(contactId: string, isTyping: boolean) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    this.send({
      type: MessageType.TYPING,
      from: user.id,
      to: contactId,
      payload: {
        isTyping
      }
    });
  }
  
  // Send read receipt
  sendReadReceipt(contactId: string, messageId: string) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    this.send({
      type: MessageType.READ_RECEIPT,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        status: 'read',
        timestamp: new Date().toISOString()
      }
    });
  }
  
  // Get connection state
  getConnectionState() {
    return this.connectionState;
  }
  
  // New methods for error event handling
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

// Create singleton instance
const websocketService = new WebSocketService();

export default websocketService; 