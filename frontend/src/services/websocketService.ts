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
  PRESENCE = "presence",
  REACTION = "reaction",
  REPLY = "reply",
  EDIT = "edit",
  DELETE = "delete"
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
  reply_to?: string;
  is_edited?: boolean;
  edited_at?: string;
  is_deleted?: boolean;
  deleted_at?: string;
  reactions?: any[];
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
      console.log('[WS] Using WebSocket URL:', wsUrl.replace(/token=.*$/, 'token=***'));
      
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
      attachments: data.payload?.attachments || data.attachments || [],
      reactions: data.payload?.reactions || [],
      replyTo: data.payload?.reply_to || data.reply_to,
      isEdited: data.payload?.is_edited || data.is_edited || false,
      editedAt: data.payload?.edited_at || data.edited_at,
      isDeleted: data.payload?.is_deleted || data.is_deleted || false,
      deletedAt: data.payload?.deleted_at || data.deleted_at
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
          
        case MessageType.REACTION:
          const reactionData = data.payload || {};
          const reactionMessageId = reactionData.messageId;
          const reactionSenderId = data.from || data.from_user;
          const reaction = reactionData.reaction;
          const action = reactionData.action;
          
          if (reactionMessageId && reactionSenderId && reaction && (action === 'add' || action === 'remove')) {
            // Get the contact ID (the other user in the conversation)
            const contactId = user?.id === reactionSenderId ? data.to || data.to_user : reactionSenderId;
            
            if (contactId) {
              chatStore.updateMessageReaction(reactionMessageId, reactionSenderId, contactId, reaction, action);
            }
          }
          break;
          
        case MessageType.EDIT:
          const editData = data.payload || {};
          const editMessageId = editData.messageId;
          const editedText = editData.text;
          const editedAt = editData.editedAt;
          const editorId = data.from || data.from_user;
          
          if (editMessageId && editedText && editorId) {
            // Get the contact ID
            const contactId = user?.id === editorId ? data.to || data.to_user : editorId;
            
            if (contactId) {
              chatStore.updateEditedMessage(editMessageId, contactId, editedText, editedAt);
            }
          }
          break;
          
        case MessageType.DELETE:
          const deleteData = data.payload || {};
          const deleteMessageId = deleteData.messageId;
          const deleterId = data.from || data.from_user;
          
          if (deleteMessageId && deleterId) {
            // Get the contact ID
            const contactId = user?.id === deleterId ? data.to || data.to_user : deleterId;
            
            if (contactId) {
              chatStore.updateDeletedMessage(deleteMessageId, contactId);
            }
          }
          break;
          
        case MessageType.REPLY:
          // Handle like a regular message, addMessage already handles replies
          const replyMessage = this.transformMessage(data);
          
          if (replyMessage.senderId !== 'unknown' && replyMessage.receiverId !== 'unknown') {
            // Make sure to include the replyTo field
            if (data.payload && data.payload.reply_to) {
              // @ts-ignore - Adding replyTo property which is supported in the Message interface
              replyMessage.replyTo = data.payload.reply_to;
            }
            
            chatStore.addMessage(replyMessage);
            
            if (user && user.id !== replyMessage.senderId) {
              this.sendReadReceipt(replyMessage.senderId, replyMessage.id);
            }
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
    console.log(`[WS] Connection closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}, Clean: ${event.wasClean}`);
    this.connectionState = 'disconnected';
    
    // Handle different close codes
    if (event.code === 1000) {
      // Normal closure
      console.log('[WS] Normal closure, no reconnect needed');
      return;
    } else if (event.code === 1006) {
      console.error('[WS] Abnormal closure (1006) - server might be down or network issue');
    } else if (event.code === 1008) {
      console.error('[WS] Policy violation (1008) - authentication may have failed');
    } else if (event.code === 1011) {
      console.error('[WS] Internal server error (1011)');
    } else {
      console.error(`[WS] Connection closed with code ${event.code}`);
    }
    
    // Clear any existing ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Don't reconnect if max attempts reached
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`);
      this.notifyErrorHandlers(`WebSocket disconnected after ${this.maxReconnectAttempts} attempts`);
      return;
    }
    
    // Don't reconnect on authentication failures
    if (event.code === 1008) {
      console.error('[WS] Authentication failure, not attempting reconnect');
      this.notifyErrorHandlers('WebSocket authentication failed');
      return;
    }
    
    // Implement exponential backoff for reconnect
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    console.log(`[WS] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      console.log(`[WS] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      this.connect();
    }, delay);
  }
  
  private handleError(error: Event) {
    console.error('[WS] WebSocket error:', error);
    
    // Try to get more error details
    if (this.socket) {
      console.error(`[WS] Socket state: ${this.getReadyStateLabel(this.socket.readyState)}`);
      try {
        console.error('[WS] Socket info:', {
          bufferedAmount: this.socket.bufferedAmount,
          protocol: this.socket.protocol || 'none',
          extensions: this.socket.extensions || 'none',
          binaryType: this.socket.binaryType
        });
      } catch (e) {
        console.error('[WS] Could not access socket properties:', e);
      }
    }
    
    this.notifyErrorHandlers('WebSocket connection error');
    
    // We're not calling handleClose here as the onclose handler will be called automatically
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
    console.log('[WS] Testing connection...');
    
    // First check if we're connected at all
    if (!this.socket || this.connectionState !== 'connected') {
      console.log('[WS] Not connected, attempting to connect...');
      try {
        await this.connect();
        
        // Return false if we still aren't connected
        if (this.connectionState !== 'connected') {
          console.error('[WS] Failed to establish connection during test');
          return false;
        }
      } catch (error) {
        console.error('[WS] Error during connection attempt:', error);
        return false;
      }
    }
    
    // Check the actual socket state
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error(`[WS] Socket in wrong state: ${this.socket ? this.getReadyStateLabel(this.socket.readyState) : 'null'}`);
      
      // If socket is in CLOSING or CLOSED state, force a reconnect
      if (this.socket && (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED)) {
        console.log('[WS] Socket is closing/closed but connection state was "connected". Fixing state inconsistency...');
        this.connectionState = 'disconnected';
        // Try to reconnect
        try {
          await this.connect();
        } catch (error) {
          console.error('[WS] Error during reconnection attempt:', error);
          return false;
        }
      }
      
      return false;
    }
    
    try {
      // Check if we can send a ping
      console.log('[WS] Socket appears open, sending test ping...');
      
      // Create a promise that resolves on pong or times out
      return await new Promise<boolean>((resolve) => {
        let pingReceived = false;
        const socket = this.socket; // Create a stable reference
        
        if (!socket) {
          console.error('[WS] Socket became null during test');
          resolve(false);
          return;
        }
        
        // Setup a one-time message handler to listen for our test response
        const messageHandler = (event: MessageEvent) => {
          if (event.data === 'pong' || (typeof event.data === 'string' && event.data.includes('ping-response'))) {
            console.log('[WS] Received ping response');
            pingReceived = true;
            socket.removeEventListener('message', messageHandler);
            resolve(true);
          }
        };
        
        // Add temporary listener
        socket.addEventListener('message', messageHandler);
        
        // Send test ping
        try {
          socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (error) {
          console.error('[WS] Error sending test message:', error);
          socket.removeEventListener('message', messageHandler);
          resolve(false);
        }
        
        // Set timeout of 3 seconds
        setTimeout(() => {
          if (!pingReceived) {
            console.error('[WS] Ping test timed out - no response received');
            socket.removeEventListener('message', messageHandler);
            resolve(false);
          }
        }, 3000);
      });
    } catch (error) {
      console.error('[WS] Error during ping test:', error);
      return false;
    }
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
  
  // Check if the WebSocket is connected
  isConnected() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  // Send a reaction to a message
  sendReaction(contactId: string, messageId: string, reaction: string, action: 'add' | 'remove') {
    if (!this.isConnected()) {
      console.error('[WS] Cannot send reaction: Not connected');
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      console.error('[WS] Cannot send reaction: User not authenticated');
      return false;
    }
    
    const reactionMessage = {
      type: MessageType.REACTION,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        reaction,
        action,
        timestamp: new Date().toISOString()
      }
    };
    
    this.send(reactionMessage);
    return true;
  }
  
  // Send an edited message
  editMessage(contactId: string, messageId: string, text: string) {
    if (!this.isConnected()) {
      console.error('[WS] Cannot edit message: Not connected');
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      console.error('[WS] Cannot edit message: User not authenticated');
      return false;
    }
    
    const editMsg = {
      type: MessageType.EDIT,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        text,
        editedAt: new Date().toISOString()
      }
    };
    
    this.send(editMsg);
    return true;
  }
  
  // Delete a message
  deleteMessage(contactId: string, messageId: string) {
    if (!this.isConnected()) {
      console.error('[WS] Cannot delete message: Not connected');
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      console.error('[WS] Cannot delete message: User not authenticated');
      return false;
    }
    
    const deleteMsg = {
      type: MessageType.DELETE,
      from: user.id,
      to: contactId,
      payload: {
        messageId
      }
    };
    
    this.send(deleteMsg);
    return true;
  }
  
  // Send a reply to a message
  sendReply(contactId: string, text: string, replyToMessageId: string, attachments: any[] = []) {
    if (!this.isConnected()) {
      console.error('[WS] Cannot send reply: Not connected');
      return undefined;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      console.error('[WS] Cannot send reply: User not authenticated');
      return undefined;
    }
    
    // Generate a temporary ID for the message
    const messageId = `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create message object
    const replyMsg = {
      type: MessageType.REPLY,
      from: user.id,
      to: contactId,
      payload: {
        id: messageId,
        text,
        timestamp: new Date().toISOString(),
        status: 'sent',
        attachments,
        reply_to: replyToMessageId
      }
    };
    
    // Prepare message data for local state
    const localMessage = {
      id: messageId,
      senderId: user.id,
      receiverId: contactId,
      text,
      timestamp: new Date().toISOString(),
      status: 'sent' as const,
      attachments,
      replyTo: replyToMessageId
    };
    
    // Add message to local state first for immediate UI update
    useChatStore.getState().addMessage(localMessage);
    
    // Send via WebSocket
    this.send(replyMsg);
    
    return messageId;
  }
}

const websocketService = new WebSocketService();

export default websocketService;