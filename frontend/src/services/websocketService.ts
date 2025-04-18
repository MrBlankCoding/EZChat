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
  DELETE = "delete",
  TIMEZONE = "timezone"
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
  timezone?: string;
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
  private connectingPromise: Promise<void> | null = null;
  private lastConnectAttempt = 0;
  private connectionAttemptDebounceMs = 5000; // Prevent multiple connect calls within 5 seconds
  
  async connect() {
    // Debounce connect attempts to prevent multiple simultaneous connections
    const now = Date.now();
    if (now - this.lastConnectAttempt < this.connectionAttemptDebounceMs) {
      console.log('[WS] Connect attempt debounced, another attempt was made recently');
      return this.connectingPromise;
    }
    
    this.lastConnectAttempt = now;
    
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected, skipping connection');
      return Promise.resolve();
    }
    
    if (this.connectionState === 'connecting' && this.connectingPromise) {
      console.log('[WS] Connection already in progress, returning existing promise');
      return this.connectingPromise;
    }
    
    // Reset any previous reconnect attempts if this is a fresh connection
    if (this.connectionState === 'disconnected') {
      this.reconnectAttempts = 0;
    }
    
    this.connectionState = 'connecting';
    console.log('[WS] Initiating connection...');
    
    // Create a new connection promise
    this.connectingPromise = new Promise<void>(async (resolve, reject) => {
      try {
        const { user } = useAuthStore.getState();
        if (!user) {
          console.error('[WS] Cannot connect: User not authenticated');
          this.connectionState = 'disconnected';
          this.connectingPromise = null;
          reject(new Error('User not authenticated'));
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
          this.connectingPromise = null;
          reject(new Error('No authentication token available'));
          return;
        }
        
        // Log connection details to help debugging
        console.log('[WS] Connecting with user:', user.id);
        
        // Extract WebSocket URL from environment or use fallback
        const baseWsUrl = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws';
        
        // Sanitize the WebSocket URL to ensure it has the correct format
        const wsUrlBase = baseWsUrl.trim();
        const wsUrl = `${wsUrlBase}${wsUrlBase.includes('?') ? '&' : '?'}token=${token}`;
        
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
        try {
          this.socket = new WebSocket(wsUrl);
        } catch (wsError) {
          console.error('[WS] Error creating WebSocket connection:', wsError);
          this.connectionState = 'disconnected';
          this.connectingPromise = null;
          reject(new Error(`Failed to create WebSocket connection: ${wsError}`));
          return;
        }
        
        // Set a connection timeout
        const connectionTimeout = setTimeout(() => {
          if (this.connectionState === 'connecting') {
            console.error('[WS] Connection timeout');
            if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
              this.socket.close();
              this.connectionState = 'disconnected';
              this.connectingPromise = null;
              this.handleClose({ code: 1006, reason: 'Connection timeout', wasClean: false } as CloseEvent);
              reject(new Error('Connection timeout'));
            }
          }
        }, 10000); // 10 second timeout
        
        // Set up event handlers
        this.socket.onopen = (event) => {
          clearTimeout(connectionTimeout);
          this.handleOpen();
          resolve();
        };
        
        this.socket.onmessage = this.handleMessage.bind(this);
        
        this.socket.onclose = (event) => {
          clearTimeout(connectionTimeout);
          this.handleClose(event);
          if (this.connectionState === 'connecting') {
            reject(new Error(`WebSocket closed during connection: ${event.code}`));
          }
        };
        
        this.socket.onerror = (event) => {
          clearTimeout(connectionTimeout);
          this.handleError(event);
          if (this.connectionState === 'connecting') {
            reject(new Error('WebSocket connection error'));
          }
        };
      } catch (error) {
        console.error('[WS] Error connecting to WebSocket:', error);
        this.connectionState = 'disconnected';
        this.connectingPromise = null;
        this.handleClose({ code: 1006, reason: `Connection setup failed: ${error}`, wasClean: false } as CloseEvent);
        reject(error);
      }
    });
    
    return this.connectingPromise.finally(() => {
      this.connectingPromise = null;
    });
  }
  
  disconnect() {
    console.log('[WS] Disconnecting WebSocket...');
    
    // Set connection state to disconnected first before closing the socket
    // This prevents attempts to send messages during socket closure
    this.connectionState = 'disconnected';
    
    if (this.socket) {
      try {
        // Prevent reconnect on intentional close
        this.socket.onclose = null;
        this.socket.onerror = null;
        
        // Only attempt to close if not already closed
        if (this.socket.readyState !== WebSocket.CLOSED) {
          this.socket.close();
        }
      } catch (e) {
        console.warn('[WS] Error during disconnect:', e);
      }
      this.socket = null;
    }
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    this.reconnectAttempts = 0;
    this.connectingPromise = null;
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
            // Check if the function exists before calling it
            if (typeof chatStore.updateContactStatus === 'function') {
              chatStore.updateContactStatus(data.payload.userId, data.payload.status);
            } else {
              console.warn('[WS] Received status update but updateContactStatus not implemented in chatStore');
            }
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
            // Check if the function exists before calling it
            if (typeof chatStore.updateContactStatus === 'function') {
              chatStore.updateContactStatus(data.from, data.payload.status);
            } else {
              console.warn('[WS] Received presence update but updateContactStatus not implemented in chatStore');
            }
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
    console.log(`[WS] Connection closed: ${event.code} ${event.reason || ''}`);
    
    // Set socket to null to prevent sending messages to a closed socket
    if (this.socket?.readyState === WebSocket.CLOSED) {
      this.socket = null;
    }
    
    // Only attempt reconnection if we were previously connected
    if (this.connectionState === 'connected') {
      this.connectionState = 'disconnected';
      
      // Don't reconnect if it was a clean close by us
      if (event.wasClean) {
        console.log('[WS] Clean connection close, not reconnecting');
        return;
      }
      
      // Status Code 1000 (Normal Closure) or 1001 (Going Away) shouldn't trigger a reconnect
      if (event.code === 1000 || event.code === 1001) {
        console.log(`[WS] Normal closure (${event.code}), not reconnecting`);
        return;
      }
      
      // Don't reconnect if we've exceeded our max attempts
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error(`[WS] Maximum reconnect attempts (${this.maxReconnectAttempts}) exceeded`);
        return;
      }
      
      this.reconnectAttempts++;
      
      // Exponential backoff for reconnect
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
      console.log(`[WS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      this.reconnectTimer = setTimeout(() => {
        console.log(`[WS] Attempting reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect().catch(error => {
          console.error('[WS] Reconnect attempt failed:', error);
        });
      }, delay);
    } else if (this.connectionState === 'connecting') {
      // Handle case where connection closes during connection attempt
      this.connectionState = 'disconnected';
      console.log('[WS] Connection closed during connection attempt');
    }
  }
  
  private handleError(error: Event) {
    console.error('[WS] WebSocket error:', error);
    this.notifyErrorHandlers("WebSocket connection error");
    
    // Check if we can determine if this is a network connectivity issue
    if (navigator && 'onLine' in navigator && !navigator.onLine) {
      console.log('[WS] Browser is offline, waiting for online status');
      
      // Set up a one-time event listener for when we go back online
      const onlineHandler = () => {
        console.log('[WS] Browser is back online, attempting to reconnect');
        window.removeEventListener('online', onlineHandler);
        this.connect().catch(err => {
          console.error('[WS] Reconnect attempt after going online failed:', err);
        });
      };
      
      window.addEventListener('online', onlineHandler);
    }
  }
  
  private getReadyStateLabel(readyState: number): string {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[readyState] || `UNKNOWN (${readyState})`;
  }
  
  private send(message: WebSocketMessage) {
    // Check socket exists and is in OPEN state (not CLOSING or CLOSED)
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('[WS] Error sending message:', error);
        this.notifyErrorHandlers("Error sending message: " + error);
        return false;
      }
    }
    
    // Don't attempt to reconnect if socket is in CLOSING state
    if (this.socket?.readyState === WebSocket.CLOSING) {
      console.warn('[WS] Cannot send message: WebSocket is closing');
      return false;
    }
    
    // Handle case where we're not properly connected
    if (this.connectionState !== 'connected' || 
        !this.socket || 
        this.socket.readyState !== WebSocket.OPEN) {
      
      console.log('[WS] Socket not ready, attempting to connect before sending message');
      this.connect().then(() => {
        setTimeout(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            try {
              this.socket.send(JSON.stringify(message));
            } catch (error) {
              console.error('[WS] Error sending message after reconnect:', error);
            }
          } else {
            console.warn('[WS] Socket still not ready after reconnect attempt');
          }
        }, 1000);
      }).catch(error => {
        console.error('[WS] Failed to connect before sending message:', error);
      });
    }
    
    return false;
  }
  
  private sendPing() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send('ping');
      } catch (error) {
        console.error('[WS] Error sending ping:', error);
        
        // If we can't send a ping, the connection might be broken
        // Force a reconnect
        if (this.connectionState === 'connected') {
          console.warn('[WS] Reconnecting due to ping failure');
          this.connectionState = 'disconnected';
          this.connect().catch(err => {
            console.error('[WS] Reconnect attempt after ping failure failed:', err);
          });
        }
      }
    } else if (this.connectionState === 'connected' && 
               (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
      // Connection state is inconsistent, try to fix it
      console.warn('[WS] Ping failed: connection state inconsistent');
      this.connectionState = 'disconnected';
      this.connect().catch(err => {
        console.error('[WS] Reconnect attempt after ping inconsistency failed:', err);
      });
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

  /**
   * Send user's timezone information to the server
   * @param timezone User's timezone (e.g. 'America/New_York')
   */
  sendUserTimezone(timezone: string) {
    if (!this.isConnected()) {
      console.warn('[WS] Cannot send timezone, not connected');
      // Queue the timezone send for when we connect
      this.connect().then(() => this.sendUserTimezone(timezone)).catch(err => {
        console.error('[WS] Failed to connect to send timezone:', err);
      });
      return;
    }
    
    try {
      const { user } = useAuthStore.getState();
      if (!user) return;
      
      const message: WebSocketMessage = {
        type: MessageType.TIMEZONE,
        from: user.id,
        to: null,
        payload: {
          timezone
        }
      };
      
      this.send(message);
      console.log('[WS] Sent timezone information:', timezone);
    } catch (error) {
      console.error('[WS] Error sending timezone:', error);
    }
  }
}

const websocketService = new WebSocketService();

export default websocketService;