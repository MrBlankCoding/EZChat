import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';

// WebSocket connection states
type ConnectionState = 'connecting' | 'connected' | 'disconnected';

// Message types for WebSocket
enum MessageType {
  AUTH = 'auth',
  MESSAGE = 'message',
  TYPING = 'typing',
  STATUS = 'status',
  DELIVERY_RECEIPT = 'delivery_receipt',
  READ_RECEIPT = 'read_receipt',
  ERROR = 'error',
}

// Interface for WebSocket messages
interface WebSocketMessage {
  type: MessageType;
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
      
      // Connect with token
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'}?token=${token}`;
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
    
    // Send authentication message
    const { user } = useAuthStore.getState();
    if (user) {
      this.sendAuth(user.id);
    }
    
    // Setup ping interval
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 30000); // Send ping every 30 seconds
  }
  
  // Handle WebSocket messages
  private handleMessage(event: MessageEvent) {
    try {
      const data: WebSocketMessage = JSON.parse(event.data);
      const chatStore = useChatStore.getState();
      
      switch (data.type) {
        case MessageType.MESSAGE:
          // Handle incoming message
          chatStore.addMessage(data.payload);
          break;
          
        case MessageType.TYPING:
          // Handle typing indicator
          chatStore.setTypingIndicator(data.payload.senderId, data.payload.isTyping);
          break;
          
        case MessageType.STATUS:
          // Handle status updates
          chatStore.updateContactStatus(data.payload.userId, data.payload.status);
          break;
          
        case MessageType.DELIVERY_RECEIPT:
          // Handle delivery receipt
          chatStore.updateMessageStatus(
            data.payload.messageId, 
            data.payload.contactId, 
            'delivered'
          );
          break;
          
        case MessageType.READ_RECEIPT:
          // Handle read receipt
          chatStore.updateMessageStatus(
            data.payload.messageId, 
            data.payload.contactId, 
            'read'
          );
          break;
          
        case MessageType.ERROR:
          console.error('WebSocket error:', data.payload.message);
          break;
          
        default:
          console.log('Unhandled message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
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
      reconnectAttempts: this.reconnectAttempts
    };
    console.error('WebSocket connection details:', connectionDetails);
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
      console.warn('Cannot send message: WebSocket is not connected');
      
      // Try to reconnect
      if (this.connectionState === 'disconnected') {
        this.connect();
      }
    }
  }
  
  // Send authentication message
  private sendAuth(userId: string) {
    this.send({
      type: MessageType.AUTH,
      payload: { userId }
    });
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
    
    const message = {
      id: messageId,
      senderId: user.id,
      receiverId: contactId,
      text,
      attachments,
      timestamp: Date.now(),
      status: 'sent' as const
    };
    
    // Add message to local store immediately
    useChatStore.getState().addMessage(message);
    
    // Send message through WebSocket
    this.send({
      type: MessageType.MESSAGE,
      payload: message
    });
    
    return messageId;
  }
  
  // Send typing indicator
  sendTypingIndicator(contactId: string, isTyping: boolean) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    this.send({
      type: MessageType.TYPING,
      payload: {
        senderId: user.id,
        receiverId: contactId,
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
      payload: {
        senderId: user.id,
        contactId,
        messageId
      }
    });
  }
  
  // Get connection state
  getConnectionState() {
    return this.connectionState;
  }
}

// Create singleton instance
const websocketService = new WebSocketService();

export default websocketService; 