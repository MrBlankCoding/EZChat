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
      const token = await auth.currentUser?.getIdToken();
      
      if (!token) {
        console.error('[WS] Cannot connect: No authentication token available');
        this.connectionState = 'disconnected';
        return;
      }
      
      const wsUrl = `${import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws'}?token=${token}`;
      
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      
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
      return JSON.parse(data);
    } catch (parseError) {
      console.error('Error parsing WebSocket message JSON:', parseError);
      console.log('Raw message data:', data);
      this.notifyErrorHandlers(`Parse error: ${parseError}`);
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
      if (event.data === 'pong') {
        return;
      }
      
      const data = this.parseMessage(event.data);
      if (!data || !data.type) {
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
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
      
      this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    } else {
      console.error('[WS] Maximum reconnect attempts reached.');
    }
  }
  
  private handleError(error: Event) {
    console.error('WebSocket error:', error);
    
    const connectionDetails = {
      readyState: this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'No socket',
      url: this.socket?.url || 'Not connected',
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      userInfo: useAuthStore.getState().user ? 'User authenticated' : 'No user authenticated'
    };
    console.error('WebSocket connection details:', connectionDetails);
    
    this.notifyErrorHandlers(error);
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
      from_user: user.id,
      to_user: contactId,
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
    
    if (status.state !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) {
      this.disconnect();
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.connect();
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