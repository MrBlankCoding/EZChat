import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import presenceManager, { PresenceState } from './presenceManager';

type ConnectionState = 'connecting' | 'connected' | 'disconnected';

enum MessageType {
  MESSAGE = "message",
  TYPING = "typing",
  STATUS = "status",
  DELIVERY_RECEIPT = "delivery_receipt",
  READ_RECEIPT = "read_receipt",
  READ_RECEIPT_BATCH = "read_receipt_batch",
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
  payload: any;
  [key: string]: any;
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
  private eventHandlers: Array<() => void> = [];
  private messageHandlers: Array<(event: any) => void> = [];
  private connectingPromise: Promise<void> | null = null;
  private lastConnectAttempt = 0;
  private connectionAttemptDebounceMs = 5000;
  private presenceInterval: ReturnType<typeof setTimeout> | null = null;
  
  private readReceiptQueue: Map<string, Set<string>> = new Map<string, Set<string>>();
  private readReceiptTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly READ_RECEIPT_DELAY = 2000;
  
  async connect() {
    const now = Date.now();
    if (now - this.lastConnectAttempt < this.connectionAttemptDebounceMs) {
      return this.connectingPromise;
    }
    
    this.lastConnectAttempt = now;
    
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    
    if (this.connectionState === 'connecting' && this.connectingPromise) {
      return this.connectingPromise;
    }
    
    if (this.connectionState === 'disconnected') {
      this.reconnectAttempts = 0;
    }
    
    this.connectionState = 'connecting';
    
    this.connectingPromise = new Promise<void>(async (resolve, reject) => {
      try {
        const { user } = useAuthStore.getState();
        if (!user) {
          this.connectionState = 'disconnected';
          this.connectingPromise = null;
          reject(new Error('User not authenticated'));
          return;
        }

        const auth = (await import('./firebaseConfig')).auth;
        
        try {
          await auth.currentUser?.getIdToken(true);
        } catch (refreshError) {
          // Continue with existing token
        }
        
        const token = await auth.currentUser?.getIdToken();
        
        if (!token) {
          this.connectionState = 'disconnected';
          this.connectingPromise = null;
          reject(new Error('No authentication token available'));
          return;
        }
        
        const baseWsUrl = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:8000/ws';
        const wsUrlBase = baseWsUrl.trim();
        const wsUrl = `${wsUrlBase}${wsUrlBase.includes('?') ? '&' : '?'}token=${token}`;
        
        if (this.socket) {
          this.socket.onclose = null;
          this.socket.close();
          this.socket = null;
        }
        
        this.socket = new WebSocket(wsUrl);
        
        const connectionTimeout = setTimeout(() => {
          if (this.connectionState === 'connecting') {
            if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
              this.socket.close();
              this.connectionState = 'disconnected';
              this.connectingPromise = null;
              this.handleClose({ code: 1006, reason: 'Connection timeout', wasClean: false } as CloseEvent);
              reject(new Error('Connection timeout'));
            }
          }
        }, 10000);
        
        this.socket.onopen = () => {
          clearTimeout(connectionTimeout);
          this.handleOpen();
          resolve();
        };
        
        this.socket.onmessage = (event) => {
          this.handleMessage(event).catch(error => {
            this.notifyErrorHandlers(`Message handling error: ${error}`);
          });
        };
        
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
    this.connectionState = 'disconnected';
    
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      
      if (this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
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
    
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }
    
    this.reconnectAttempts = 0;
    this.connectingPromise = null;
  }
  
  private handleOpen() {
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.pingInterval = setInterval(() => this.sendPing(), 30000);
    this.setupPresenceUpdates();
  }

  private parseMessage(data: string): WebSocketMessage | null {
    try {
      if (typeof data === 'string' && (data === 'ping' || data === 'pong')) {
        return null;
      }
      
      try {
        return JSON.parse(data);
      } catch (parseError) {
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
      this.notifyErrorHandlers(`Message handling error: ${error}`);
      return null;
    }
  }

  private transformMessage(data: WebSocketMessage) {
    return {
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
      editedAt: data.payload?.editedAt || data.payload?.edited_at || data.edited_at,
      isDeleted: data.payload?.is_deleted || data.is_deleted || false,
      deletedAt: data.payload?.deletedAt || data.payload?.deleted_at || data.deleted_at
    };
  }
  
  private async handleMessage(event: MessageEvent) {
    try {
      console.log("[WS Service] Raw message received:", event.data);
      
      if (event.data === 'pong' || event.data === 'ping') {
        return;
      }
      
      const data = this.parseMessage(event.data);
      if (!data) {
        return;
      }
      
      console.log("[WS Service] Parsed message data:", data);
      
      if (!data.type) {
        this.notifyErrorHandlers('Malformed message received');
        return;
      }
      
      this.notifyMessageHandlers(data);
      
      const chatStore = useChatStore.getState();
      const { user } = useAuthStore.getState();
      
      console.log(`[WS Service] Handling message type: ${data.type}`);
      
      const ensureConversationLoaded = async (contactId: string) => {
        const conversations = chatStore.conversations;
        if (!conversations[contactId]) {
          try {
            await chatStore.fetchMessagesForContact(contactId);
          } catch (error) {
            // Failed to load conversation
          }
        }
      };
      
      switch (data.type) {
        case MessageType.MESSAGE:
          const message = this.transformMessage(data);
          
          if (user && message.senderId !== user.id) {
            await ensureConversationLoaded(message.senderId);
          } else if (user) {
            await ensureConversationLoaded(message.receiverId);
          }
          
          if (message.senderId !== 'unknown' && message.receiverId !== 'unknown') {
            const contactId = user?.id === message.senderId ? message.receiverId : message.senderId;
            const conversation = chatStore.conversations[contactId];
            
            const isDuplicate = conversation?.messages.some(msg => msg.id === message.id);
            if (!isDuplicate) {
              chatStore.addMessage(message);
              
              if (user && user.id !== message.senderId) {
                this.queueReadReceipt(message.senderId, message.id);
              }
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
          const userId = data.payload?.userId || data.from || data.payload?.from || data.payload?.from_user;
          if (userId) {
            const status = data.payload?.status || 'offline';
            presenceManager.updateContactStatus(userId, status as PresenceState);
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
          // The user who read the message is in 'from' or 'from_user'
          // The user whose messages were read (and needs the UI update) is in 'to' or 'to_user'
          const readerId_single = data.from || data.from_user;
          const originalSenderId_single = data.to || data.to_user; // This is the contactId for the store
          const messageId_single = String(data.message_id || data.payload?.messageId || '');
          
          if (originalSenderId_single && messageId_single) {
            console.log(`[WS Service] Handling READ_RECEIPT for msg ${messageId_single} from reader ${readerId_single} for sender ${originalSenderId_single}`);
            // Use originalSenderId_single as the contactId to update the correct conversation
            chatStore.updateMessageStatus(messageId_single, originalSenderId_single, 'read');
            this.notifyEventHandlers(); // Notify generic handlers
          }
          break;
          
        case MessageType.READ_RECEIPT_BATCH:
          const readerId_batch = data.from || data.from_user;
          const originalSenderId_batch = data.to || data.to_user; // This is the contactId for the store
          const messageIds_batch = (data.message_ids || data.payload?.messageIds || []) as string[];
          
          if (originalSenderId_batch && messageIds_batch.length > 0) {
            console.log(`[WS Service] Handling READ_RECEIPT_BATCH for ${messageIds_batch.length} messages from reader ${readerId_batch} for sender ${originalSenderId_batch}`);
            // Use originalSenderId_batch as the contactId to update the correct conversation
            messageIds_batch.forEach(msgId => {
              chatStore.updateMessageStatus(String(msgId), originalSenderId_batch, 'read');
            });
            this.notifyEventHandlers(); // Notify generic handlers
          }
          break;
          
        case MessageType.PRESENCE:
          const presenceUserId = data.from || data.from_user || data.payload?.userId;
          const presenceStatus = data.payload?.status || data.status || 'offline';
          
          if (presenceUserId) {
            presenceManager.updateContactStatus(presenceUserId, presenceStatus as PresenceState);
          }
          break;
          
        case MessageType.REACTION:
          const reactionData = data.payload || {};
          const reactionMessageId = reactionData.messageId;
          const reactionSenderId = data.from || data.from_user;
          const reaction = reactionData.reaction;
          const action = reactionData.action;
          
          if (reactionMessageId && reactionSenderId && reaction && (action === 'add' || action === 'remove')) {
            const contactId = user?.id === reactionSenderId ? data.to || data.to_user : reactionSenderId;
            
            if (contactId) {
              chatStore.updateMessageReaction(reactionMessageId, reactionSenderId, contactId, reaction, action);
            }
          }
          break;
          
        case MessageType.EDIT:
          const editData = data.payload || {};
          const editMessageId = String(data.message_id || editData.messageId || '');
          const editedText = data.text || editData.text || '';
          const editedAt = data.edited_at || editData.editedAt || new Date().toISOString();
          const editorId = data.from || data.from_user;
          
          if (editMessageId && editedText && editorId) {
            const contactId = user?.id === editorId ? data.to || data.to_user : editorId;
            
            if (contactId) {
              console.log(`[WS Service] Handling EDIT for msg ${editMessageId} in contact ${contactId}`);
              chatStore.updateEditedMessage(editMessageId, contactId, editedText, editedAt);
              this.notifyEventHandlers();
            }
          }
          break;
          
        case MessageType.DELETE:
          const deleteData = data.payload || {};
          const deleteMessageId = String(data.message_id || deleteData.messageId || '');
          const deletedAt = data.deleted_at || deleteData.deletedAt || new Date().toISOString();
          const deleterId = data.from || data.from_user;
          
          if (deleteMessageId && deleterId) {
            const contactId = user?.id === deleterId ? data.to || data.to_user : deleterId;
            
            if (contactId) {
              console.log(`[WS Service] Handling DELETE for msg ${deleteMessageId} in contact ${contactId}`);
              chatStore.updateDeletedMessage(deleteMessageId, contactId, deletedAt);
              this.notifyEventHandlers();
            }
          }
          break;
          
        case MessageType.REPLY:
          const replyMessage = this.transformMessage(data);
          
          if (replyMessage.senderId !== 'unknown' && replyMessage.receiverId !== 'unknown') {
            if (data.payload && data.payload.reply_to) {
              replyMessage.replyTo = data.payload.reply_to;
            }
            
            chatStore.addMessage(replyMessage);
            
            if (user && user.id !== replyMessage.senderId) {
              this.queueReadReceipt(replyMessage.senderId, replyMessage.id);
            }
          }
          break;
          
        case MessageType.ERROR:
          const errorDetails = data.payload?.message || 'Unknown server error';
          this.notifyErrorHandlers(errorDetails);
          break;
      }

      this.notifyEventHandlers();
    } catch (error) {
      this.notifyErrorHandlers(`Message handling error: ${error}`);
    }
  }
  
  private handleClose(event: CloseEvent) {
    if (this.presenceInterval) {
      clearTimeout(this.presenceInterval);
      this.presenceInterval = null;
    }
    
    if (this.socket?.readyState === WebSocket.CLOSED) {
      this.socket = null;
    }
    
    if (this.connectionState === 'connected') {
      this.connectionState = 'disconnected';
      
      if (event.wasClean) {
        return;
      }
      
      if (event.code === 1000 || event.code === 1001) {
        return;
      }
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        return;
      }
      
      this.reconnectAttempts++;
      
      const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
      
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(() => {
          // Reconnect attempt failed
        });
      }, delay);
    } else if (this.connectionState === 'connecting') {
      this.connectionState = 'disconnected';
    }
  }
  
  private handleError(error: Event) {
    this.notifyErrorHandlers("WebSocket connection error");
    
    if (navigator && 'onLine' in navigator && !navigator.onLine) {
      const onlineHandler = () => {
        window.removeEventListener('online', onlineHandler);
        this.connect().catch(() => {
          // Reconnect attempt failed
        });
      };
      
      window.addEventListener('online', onlineHandler);
    }
  }
  
  private send(message: WebSocketMessage): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        this.notifyErrorHandlers("Error sending message: " + error);
        return false;
      }
    }
    
    if (this.socket?.readyState === WebSocket.CLOSING) {
      return false;
    }
    
    if (this.connectionState !== 'connected' || 
        !this.socket || 
        this.socket.readyState !== WebSocket.OPEN) {
      
      this.connect().then(() => {
        setTimeout(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            try {
              this.socket.send(JSON.stringify(message));
            } catch (error) {
              // Error sending message after reconnect
            }
          }
        }, 1000);
      }).catch(() => {
        // Failed to connect before sending message
      });
    }
    
    return false;
  }
  
  private sendPing() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send('ping');
      } catch (error) {
        if (this.connectionState === 'connected') {
          this.connectionState = 'disconnected';
          this.connect().catch(() => {
            // Reconnect attempt failed
          });
        }
      }
    } else if (this.connectionState === 'connected' && 
               (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
      this.connectionState = 'disconnected';
      this.connect().catch(() => {
        // Reconnect attempt failed
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
  
  private queueReadReceipt(contactId: string, messageId: string) {
    if (!contactId || !messageId) {
      return;
    }
    
    if (!this.readReceiptQueue.has(contactId)) {
      this.readReceiptQueue.set(contactId, new Set());
    }
    
    this.readReceiptQueue.get(contactId)?.add(messageId);
    this.scheduleReadReceiptsBatch();
  }
  
  private scheduleReadReceiptsBatch() {
    if (this.readReceiptTimer) {
      return;
    }
    
    this.readReceiptTimer = setTimeout(() => {
      this.readReceiptTimer = null;
      this.sendQueuedReadReceipts();
    }, this.READ_RECEIPT_DELAY);
  }

  private sendQueuedReadReceipts() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.readReceiptQueue.size > 0) {
        this.scheduleReadReceiptsBatch();
      }
      return;
    }
    
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      return;
    }
    
    for (const [recipient, messageIds] of this.readReceiptQueue.entries()) {
      if (messageIds.size === 0) continue;
      
      const messages = Array.from(messageIds);
      
      this.send({
        type: MessageType.READ_RECEIPT_BATCH,
        from: userId,
        to: recipient,
        payload: {
          messageIds: messages,
          contactId: recipient,
          timestamp: new Date().toISOString()
        }
      });
      
      const chatStore = useChatStore.getState();
      messages.forEach((msgId: string) => {
        chatStore.updateMessageStatus(msgId, recipient, 'read');
      });
      
      this.readReceiptQueue.delete(recipient);
    }
  }
  
  sendPendingReadReceipts() {
    if (this.readReceiptTimer) {
      clearTimeout(this.readReceiptTimer);
      this.readReceiptTimer = null;
    }
    
    this.sendQueuedReadReceipts();
  }
  
  sendReadReceipt(contactId: string, messageId: string) {
    if (!contactId || !messageId) {
      return;
    }
    
    const { conversations } = useChatStore.getState();
    const conversation = conversations[contactId];
    
    if (!conversation) {
      return;
    }
    
    const messageExists = conversation.messages.some(msg => msg.id === messageId);
    if (!messageExists) {
      return;
    }
    
    if (!this.socket || this.connectionState !== 'connected') {
      return;
    }
    
    this.queueReadReceipt(contactId, messageId);
  }
  
  getConnectionState() {
    return {
      state: this.connectionState,
      readyState: this.socket ? 
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.socket.readyState] || `UNKNOWN (${this.socket.readyState})` : 
        'No socket',
      reconnectAttempts: this.reconnectAttempts,
      url: this.socket?.url || null
    };
  }
  
  async testConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        resolve(false);
        return;
      }
      
      try {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 3000);
        
        const pingHandler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'pong') {
              clearTimeout(timeout);
              this.socket?.removeEventListener('message', pingHandler);
              resolve(true);
              return;
            }
          } catch (error) {
            // Ignore parsing errors
          }
        };
        
        this.socket.addEventListener('message', pingHandler);
        
        const pingMessage = JSON.stringify({
          type: 'ping',
          timestamp: Date.now()
        });
        
        this.socket.send(pingMessage);
      } catch (error) {
        resolve(false);
      }
    });
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
        // Error in handler
      }
    });
  }
  
  isConnected() {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }
  
  deleteMessage(contactId: string, messageId: string) {
    if (!this.isConnected()) {
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
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
    
    // Let the backend assign the timestamp and update the UI when we get the response
    this.send(deleteMsg);
    this.notifyEventHandlers();
    
    return true;
  }
  
  sendReaction(contactId: string, messageId: string, reaction: string, action: 'add' | 'remove') {
    if (!this.isConnected()) {
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
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
    
    const chatStore = useChatStore.getState();
    chatStore.updateMessageReaction(
      messageId, 
      user.id, 
      contactId, 
      reaction, 
      action
    );
    
    this.send(reactionMessage);
    this.notifyEventHandlers();
    
    return true;
  }
  
  editMessage(contactId: string, messageId: string, text: string) {
    if (!this.isConnected()) {
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      return false;
    }
    
    const editMsg = {
      type: MessageType.EDIT,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        text
      }
    };
    
    // Let the backend assign the timestamp and update the UI when we get the response
    this.send(editMsg);
    this.notifyEventHandlers();
    
    return true;
  }
  
  sendReply(contactId: string, text: string, replyToMessageId: string, attachments: any[] = []) {
    if (!this.isConnected()) {
      return undefined;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      return undefined;
    }
    
    const messageId = `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
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
    
    useChatStore.getState().addMessage(localMessage);
    this.send(replyMsg);
    
    return messageId;
  }

  sendUserTimezone(timezone: string, verifyOnly: boolean = false) {
    if (!this.isConnected() && !verifyOnly) {
      this.connect().then(() => this.sendUserTimezone(timezone, verifyOnly)).catch(() => {
        // Failed to connect
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
          timezone: verifyOnly ? undefined : timezone,
          verify_only: verifyOnly
        }
      };
      
      this.send(message);
    } catch (error) {
      // Error sending timezone
    }
  }

  subscribeToEvents(callback: () => void): () => void {
    this.eventHandlers.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.eventHandlers = this.eventHandlers.filter(handler => handler !== callback);
    };
  }
  
  /**
   * Notify all event handlers
   */
  private notifyEventHandlers(): void {
    this.eventHandlers.forEach(handler => {
      try {
        handler();
      } catch (error) {
        console.error('Error in WebSocket event handler:', error);
      }
    });
  }

  /**
   * Send a test echo packet to help debug connection issues
   * @returns boolean indicating if the message was sent
   */
  sendTestEcho(message: string = 'test') {
    if (!this.isConnected()) {
      console.error('[WS] Cannot send test echo: Not connected');
      return false;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      console.error('[WS] Cannot send test echo: User not authenticated');
      return false;
    }
    
    console.log(`[WS] Sending test echo: ${message}`);
    
    try {
      this.socket?.send(JSON.stringify({
        type: 'echo',
        from: user.id,
        payload: {
          message,
          timestamp: new Date().toISOString()
        }
      }));
      
      this.notifyEventHandlers();
      return true;
    } catch (error) {
      console.error('[WS] Error sending test echo:', error);
      return false;
    }
  }

  /**
   * Setup periodic presence updates to ensure contacts see user's online status
   */
  private setupPresenceUpdates() {
    // Clear any existing interval
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
    }
    
    // Send initial presence
    this.sendPresenceUpdate('online');
    
    // Set up interval to send presence updates every 2 minutes
    this.presenceInterval = setInterval(() => {
      this.sendPresenceUpdate('online');
    }, 120000); // 2 minutes
  }

  /**
   * Send user presence update
   * @param status User's status ('online', 'away', or 'offline')
   */
  sendPresenceUpdate(status: 'online' | 'offline' | 'away' = 'online') {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    console.log(`[WS] Sending presence update: ${status}`);
    
    this.send({
      type: MessageType.PRESENCE,
      from: user.id,
      to: null, // Broadcast to all
      payload: {
        status,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Subscribe to direct WebSocket events with event data 
   * @param handler Function to handle WebSocket message events with data
   */
  onEvent(handler: (event: any) => void): void {
    this.messageHandlers.push(handler);
  }
  
  /**
   * Unsubscribe from direct WebSocket events
   * @param handler Function to remove from handlers
   */
  offEvent(handler: (event: any) => void): void {
    this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
  }
  
  /**
   * Notify all message handlers with the event data
   * @param event The WebSocket event data to pass to handlers
   */
  private notifyMessageHandlers(event: any): void {
    try {
      // Skip system messages like ping/pong
      if (event.type === 'ping' || event.type === 'pong') {
        return;
      }
      
      // Process the event before passing it to handlers
      switch (event.type) {
        case MessageType.REACTION:
          // Make sure reactions have the necessary properties
          if (event.payload) {
            if (!event.payload.user_id && event.from) {
              event.payload.user_id = event.from;
            }
            if (!event.payload.contact_id && event.to) {
              event.payload.contact_id = event.to;
            }
          }
          break;
          
        case MessageType.EDIT:
        case MessageType.DELETE:
          // Make sure edit/delete events have user_id and contact_id
          if (event.payload) {
            if (!event.payload.user_id && event.from) {
              event.payload.user_id = event.from;
            }
            if (!event.payload.contact_id && event.to) {
              event.payload.contact_id = event.to;
            }
          }
          break;
          
        case MessageType.READ_RECEIPT:
          // Make sure read receipts have contact_id
          if (event.payload) {
            if (!event.payload.contact_id && event.from) {
              event.payload.contact_id = event.from;
            }
          }
          break;
      }
      
      // Notify all message handlers
      this.messageHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in WebSocket message handler:', error);
        }
      });
    } catch (error) {
      console.error('Error processing WebSocket event before notifying handlers:', error);
    }
  }
}

const websocketService = new WebSocketService();

export default websocketService;