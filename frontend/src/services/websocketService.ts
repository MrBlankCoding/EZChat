import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import presenceManager, { PresenceState } from './presenceManager';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/api/notification";
import { useContactsStore } from "../stores/contactsStore";
import { Message } from "../stores/chatStore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

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
  REPLY = "reply",
  EDIT = "edit",
  DELETE = "delete",
  TIMEZONE = "timezone",
  GROUP_CREATED = "group_created",
  GROUP_UPDATED = "group_updated",
  GROUP_DELETED = "group_deleted",
  GROUP_MEMBER_ADDED = "group_member_added",
  GROUP_MEMBER_REMOVED = "group_member_removed",
  GROUP_MEMBER_UPDATED = "group_member_updated"
}

interface WebSocketMessage {
  type: MessageType;
  from?: string;
  to?: string | null;
  payload: any;
  [key: string]: any;
}

interface FileAttachment {
  type: string;
  url: string;
  name: string;
  size?: number;
  fileType?: string;
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
  private notificationAudio: HTMLAudioElement | null = null;
  
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
    const attachments = (data.payload?.attachments || data.attachments || []).map((att: any) => {
      // Ensure attachments follow our FileAttachment interface
      if (typeof att === 'object' && att !== null) {
        // Determine the primary type (image, video, audio, file) from fileType or MIME type
        let type = att.type || 'file';
        const fileType = att.fileType || '';
        
        // If fileType is a MIME type, extract the primary type
        if (fileType && fileType.includes('/')) {
          type = fileType.split('/')[0];
        }
        
        return {
          type: type,
          url: att.url || '',
          name: att.name || 'Unknown file',
          size: att.size,
          fileType: att.fileType
        };
      }
      return att;
    });
    
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
      attachments: attachments,
      replyTo: data.payload?.reply_to || data.payload?.replyTo || data.reply_to || data.replyTo,
      isEdited: data.payload?.is_edited || data.payload?.isEdited || false,
      isDeleted: data.payload?.is_deleted || data.payload?.isDeleted || false,
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
      
      this.notifyEventHandlers();
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
            console.error(`[WS Service] Failed to load conversation for ${contactId}:`, error);
            // Failed to load conversation
          }
        }
      };
      
      switch (data.type) {
        case MessageType.MESSAGE:
          await this.handleTextMessage(data);
          break;
        case MessageType.TYPING:
          this.handleTypingIndicator(data);
          break;
        case MessageType.DELIVERY_RECEIPT:
          this.handleDeliveryReceipt(data);
          break;
        case MessageType.READ_RECEIPT:
          this.handleReadReceipt(data);
          break;
        case MessageType.READ_RECEIPT_BATCH:
          this.handleReadReceiptBatch(data);
          break;
        case MessageType.PRESENCE:
          this.handlePresenceUpdate(data);
          break;
        case MessageType.REPLY:
          await this.handleReplyMessage(data);
          break;
        case MessageType.EDIT:
          this.handleEditMessage(data);
          break;
        case MessageType.DELETE:
          this.handleDeleteMessage(data);
          break;
        case MessageType.STATUS:
          // Status messages are just acknowledgments
          break;
        case MessageType.ERROR:
          this.handleErrorMessage(data);
          break;
        case MessageType.GROUP_CREATED:
          this.handleGroupCreated(data);
          break;
        case MessageType.GROUP_UPDATED:
          this.handleGroupUpdated(data);
          break;
        case MessageType.GROUP_DELETED:
          this.handleGroupDeleted(data);
          break;
        case MessageType.GROUP_MEMBER_ADDED:
          this.handleGroupMemberAdded(data);
          break;
        case MessageType.GROUP_MEMBER_REMOVED:
          this.handleGroupMemberRemoved(data);
          break;
        case MessageType.GROUP_MEMBER_UPDATED:
          this.handleGroupMemberUpdated(data);
          break;
      }

      this.notifyEventHandlers();
    } catch (error) {
      this.notifyErrorHandlers(`Message handling error: ${error}`);
      console.error("[WS Service] Error in handleMessage:", error);
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
  
  /**
   * Upload file to Firebase Storage and return the download URL
   * @param file File to upload
   * @returns Promise with download URL
   */
  async uploadFileToStorage(file: File): Promise<FileAttachment> {
    const { user } = useAuthStore.getState();
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    try {
      // Initialize Firebase Storage
      const firebaseApp = (await import('./firebaseConfig')).default;
      const storage = getStorage(firebaseApp);
      
      // Create a unique file path: users/{userId}/uploads/{timestamp}_{filename}
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `users/${user.id}/uploads/${fileName}`;
      const storageRef = ref(storage, filePath);
      
      // Upload the file
      await uploadBytes(storageRef, file);
      
      // Get the download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      return {
        type: 'file',
        url: downloadURL,
        name: file.name,
        size: file.size,
        fileType: file.type
      };
    } catch (error) {
      console.error('Error uploading file to Firebase Storage:', error);
      throw error;
    }
  }
  
  /**
   * Upload multiple files to Firebase Storage
   * @param files Array of files to upload
   * @returns Promise with array of download URLs and metadata
   */
  async uploadFilesToStorage(files: File[]): Promise<FileAttachment[]> {
    const uploadPromises = files.map(file => this.uploadFileToStorage(file));
    return Promise.all(uploadPromises);
  }
  
  // Modified to handle file uploads
  async sendMessage(contactId: string, text: string, attachments: (File | FileAttachment)[] = []) {
    const { user } = useAuthStore.getState();
    if (!user) return;
    
    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();
    
    // Process attachments - upload files and collect metadata
    let processedAttachments: FileAttachment[] = [];
    
    if (attachments.length > 0) {
      try {
        // Separate Files from already processed FileAttachments
        const filesToUpload = attachments.filter(att => att instanceof File) as File[];
        const existingAttachments = attachments.filter(att => !(att instanceof File)) as FileAttachment[];
        
        // Upload new files if any
        if (filesToUpload.length > 0) {
          const uploadedFiles = await this.uploadFilesToStorage(filesToUpload);
          processedAttachments = [...existingAttachments, ...uploadedFiles];
        } else {
          processedAttachments = existingAttachments;
        }
      } catch (error) {
        console.error('Error processing attachments:', error);
        // Continue with sending the message but without attachments
        processedAttachments = [];
      }
    }
    
    const message = {
      id: messageId,
      senderId: user.id,
      receiverId: contactId,
      text,
      attachments: processedAttachments,
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
        attachments: processedAttachments
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
  
  sendDeliveryReceipt(contactId: string, messageId: string) {
    if (!contactId || !messageId) {
      return;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      return;
    }
    
    this.send({
      type: MessageType.DELIVERY_RECEIPT,
      from: user.id,
      to: contactId,
      payload: {
        messageId,
        contactId
      }
    });
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
  
  // Modified to handle file uploads
  async sendReply(contactId: string, text: string, replyToMessageId: string, attachments: (File | FileAttachment)[] = []) {
    if (!this.isConnected()) {
      return undefined;
    }
    
    const { user } = useAuthStore.getState();
    if (!user) {
      return undefined;
    }
    
    const messageId = `tmp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Process attachments - upload files and collect metadata
    let processedAttachments: FileAttachment[] = [];
    
    if (attachments.length > 0) {
      try {
        // Separate Files from already processed FileAttachments
        const filesToUpload = attachments.filter(att => att instanceof File) as File[];
        const existingAttachments = attachments.filter(att => !(att instanceof File)) as FileAttachment[];
        
        // Upload new files if any
        if (filesToUpload.length > 0) {
          const uploadedFiles = await this.uploadFilesToStorage(filesToUpload);
          processedAttachments = [...existingAttachments, ...uploadedFiles];
        } else {
          processedAttachments = existingAttachments;
        }
      } catch (error) {
        console.error('Error processing attachments:', error);
        // Continue with sending the message but without attachments
        processedAttachments = [];
      }
    }
    
    const replyMsg = {
      type: MessageType.REPLY,
      from: user.id,
      to: contactId,
      payload: {
        id: messageId,
        text,
        timestamp: new Date().toISOString(),
        status: 'sent',
        attachments: processedAttachments,
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
      attachments: processedAttachments,
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
    
    // console.log(`[WS] Sending presence update: ${status}`);
    
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

  private async _playNotificationSound() {
    // Using the correct public path for sounds
    const soundPath = '/sounds/notification.mp3'; 
    if (!this.notificationAudio) {
      this.notificationAudio = new Audio(soundPath);
    }
    try {
      // Ensure the previous sound is stopped before playing again
      this.notificationAudio.pause();
      this.notificationAudio.currentTime = 0;
      await this.notificationAudio.play().catch(error => {
        console.error("Error playing notification sound:", error);
        // This might be due to missing file or autoplay policy
        if (error.name === "NotSupportedError" || error.name === "NotFoundError") {
          console.error(`Sound file not found at ${soundPath}. Make sure it exists in the public directory.`);
        }
      });
    } catch (error) {
      console.error("Error playing notification sound:", error);
    }
  }

  private async _notifyUser(message: Message & { senderName?: string }) {
    const isGroupMessage = !!message.groupId;
    
    try {
      // Play notification sound
      await this._playNotificationSound();
      
      // Get title for notification
      let title;
      if (isGroupMessage) {
        const group = useChatStore.getState().groups[message.groupId!];
        title = group ? `${message.senderName || 'Someone'} in ${group.name}` : message.senderName || 'New message';
      } else {
        title = message.senderName || 'New message';
      }
      
      // Build body text for notification
      const body = message.text || (message.attachments?.length ? 'Sent an attachment' : 'New message');
      
      // For Tauri app, use their notification API
      if (typeof isPermissionGranted === 'function') {
        let permissionGranted = await isPermissionGranted();
        if (!permissionGranted) {
          const permission = await requestPermission();
          permissionGranted = permission === "granted";
        }
        
        if (permissionGranted) {
          sendNotification({
            title,
            body,
            icon: 'icon.png'
          });
        }
      }
      // For web app, use browser notifications
      else if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/icon.png'
          });
        } else if (Notification.permission !== 'denied') {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            new Notification(title, {
              body,
              icon: '/icon.png'
            });
          }
        }
      }
    } catch (error) {
      console.error('[Notification Error]', error);
    }
  }

  private async handleTextMessage(data: WebSocketMessage) {
    try {
      // Get the message data from the payload
      const {
        id: messageId,
        text,
        timestamp,
        status,
        attachments
      } = data.payload || {};
      
      // Skip if missing required fields
      if (!messageId || !text) {
        return;
      }
      
      // Determine if this is a group message
      const isGroupMessage = !!data.group_id;
      
      // Create a new message object
      const newMessage: Message = {
        id: messageId,
        senderId: data.from || '',
        receiverId: data.to || '',
        text,
        timestamp,
        status: status || 'sent',
        attachments,
        groupId: isGroupMessage ? data.group_id : undefined
      };
      
      // Access the chat store
      const chatStore = useChatStore.getState();
      
      // Get the sender's display name
      let senderName = data.from || '';
      if (isGroupMessage) {
        // For group messages, look up the sender name in the group members
        const group = chatStore.groups[data.group_id];
        if (group) {
          const sender = group.members.find(m => m.user_id === data.from);
          if (sender) {
            senderName = sender.display_name;
          }
        }
      } else {
        // For direct messages, check if the sender is a contact
        const contacts = useContactsStore.getState().contacts;
        const sender = contacts.find(c => c.contact_id === data.from);
        if (sender) {
          senderName = sender.contact_display_name;
        }
      }
      
      // Add the message to the store
      chatStore.addMessage(newMessage);
      
      // If message is from someone else, send a read receipt
      if (data.from !== useAuthStore.getState().user?.id) {
        const conversationId = isGroupMessage ? data.group_id : data.from;
        
        // Only automatically send read receipt if we're viewing this conversation
        if (chatStore.activeConversationId === conversationId) {
          this.sendReadReceipt(conversationId, messageId);
        }
        
        // For direct messages, also send delivery receipt
        if (!isGroupMessage && data.to) {
          this.sendDeliveryReceipt(data.from || '', messageId);
        }
        
        // Show notification if not the active conversation
        if (chatStore.activeConversationId !== conversationId) {
          await this._notifyUser({
            ...newMessage,
            senderName // Add sender name for notification
          } as any);
        }
      }
    } catch (error) {
      console.error('Error handling text message:', error);
      this.notifyErrorHandlers(error);
    }
  }

  private async handleGroupCreated(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const groupData = data.payload;
    
    // Update groups in store
    if (groupData && groupData.id) {
      const existingGroups = { ...chatStore.groups };
      existingGroups[groupData.id] = groupData;
      
      useChatStore.setState({
        groups: existingGroups
      });
    }
  }
  
  private async handleGroupUpdated(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const groupData = data.payload;
    
    if (groupData && groupData.id) {
      const existingGroups = { ...chatStore.groups };
      
      // Merge with existing group data if available
      if (existingGroups[groupData.id]) {
        existingGroups[groupData.id] = {
          ...existingGroups[groupData.id],
          ...groupData
        };
      } else {
        existingGroups[groupData.id] = groupData;
      }
      
      useChatStore.setState({
        groups: existingGroups
      });
    }
  }
  
  private async handleGroupDeleted(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const groupId = data.payload?.group_id;
    
    if (groupId) {
      const { [groupId]: _, ...remainingGroups } = chatStore.groups;
      const { [groupId]: __, ...remainingConversations } = chatStore.conversations;
      
      useChatStore.setState({
        groups: remainingGroups,
        conversations: remainingConversations,
        // Reset active conversation if it was this group
        activeConversationId: chatStore.activeConversationId === groupId ? null : chatStore.activeConversationId
      });
    }
  }
  
  private async handleGroupMemberAdded(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const { group_id, added_member_id } = data.payload || {};
    
    if (group_id) {
      // Refresh the group data from the server
      await chatStore.fetchGroup(group_id);
      
      // If the added member is the current user, make sure conversation is created
      const { user } = useAuthStore.getState();
      if (added_member_id === user?.id && !chatStore.conversations[group_id]) {
        chatStore.setActiveGroup(group_id);
      }
    }
  }
  
  private async handleGroupMemberRemoved(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const { group_id, removed_member_id } = data.payload || {};
    
    if (group_id) {
      // Refresh the group data from the server
      await chatStore.fetchGroup(group_id);
      
      // If the removed member is the current user, remove the group from active conversations
      const { user } = useAuthStore.getState();
      if (removed_member_id === user?.id) {
        const { [group_id]: _, ...remainingConversations } = chatStore.conversations;
        
        useChatStore.setState({
          conversations: remainingConversations,
          // Reset active conversation if it was this group
          activeConversationId: chatStore.activeConversationId === group_id ? null : chatStore.activeConversationId
        });
      }
    }
  }
  
  private async handleGroupMemberUpdated(data: WebSocketMessage) {
    const chatStore = useChatStore.getState();
    const { group_id } = data.payload || {};
    
    if (group_id) {
      // Simply refresh the group data from the server
      await chatStore.fetchGroup(group_id);
    }
  }
  
  async sendGroupMessage(groupId: string, text: string, attachments: (File | FileAttachment)[] = []) {
    const { user } = useAuthStore.getState();
    if (!user) {
      throw new Error('User not authenticated');
    }
    
    try {
      // First, upload any file attachments
      const processedAttachments: FileAttachment[] = [];
      
      for (const attachment of attachments) {
        if (attachment instanceof File) {
          const fileAttachment = await this.uploadFileToStorage(attachment);
          processedAttachments.push(fileAttachment);
        } else {
          processedAttachments.push(attachment);
        }
      }
      
      // Generate message ID
      const messageId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      
      // Create the message to send
      const message: WebSocketMessage = {
        type: MessageType.MESSAGE,
        from: user.id,
        group_id: groupId,
        payload: {
          id: messageId,
          text,
          timestamp,
          status: 'sent',
          attachments: processedAttachments.length > 0 ? processedAttachments : undefined
        }
      };
      
      // Add the message to the chat store optimistically
      const chatStore = useChatStore.getState();
      const newMessage: Message = {
        id: messageId,
        senderId: user.id,
        receiverId: '', // Not applicable for group messages
        text,
        timestamp,
        status: 'sent',
        attachments: processedAttachments,
        groupId
      };
      
      chatStore.addMessage(newMessage);
      
      // Send the message
      this.send(message);
      
      return messageId;
    } catch (error) {
      console.error('Error sending group message:', error);
      throw error;
    }
  }

  private handleTypingIndicator(data: WebSocketMessage) {
    const senderId = data.from || data.from_user || data.sender_id || data.payload?.sender_id;
    const isTyping = data.payload?.isTyping ?? data.is_typing;
    
    if (senderId) {
      useChatStore.getState().setTypingIndicator(senderId, !!isTyping);
    }
  }
  
  private handleDeliveryReceipt(data: WebSocketMessage) {
    if (data.payload?.messageId && data.payload?.contactId) {
      useChatStore.getState().updateMessageStatus(
        data.payload.messageId, 
        data.payload.contactId, 
        'delivered'
      );
    }
  }
  
  private handleReadReceipt(data: WebSocketMessage) {
    // The user who read the message is in 'from' or 'from_user'
    // The user whose messages were read (and needs the UI update) is in 'to' or 'to_user'
    const readerId = data.from || data.from_user;
    const originalSenderId = data.to || data.to_user; // This is the contactId for the store
    const messageId = String(data.message_id || data.payload?.messageId || '');
    
    if (originalSenderId && messageId) {
      // Use originalSenderId as the contactId to update the correct conversation
      useChatStore.getState().updateMessageStatus(messageId, originalSenderId, 'read');
      this.notifyEventHandlers(); // Notify generic handlers
    }
  }
  
  private handleReadReceiptBatch(data: WebSocketMessage) {
    const readerId = data.from || data.from_user;
    // Use contact_id from the message payload, as this correctly identifies
    // the conversation partner (original sender) even when the message is
    // received by the reader's other devices.
    const contactId = data.contact_id || data.payload?.contactId;
    const messageIds = (data.message_ids || data.payload?.messageIds || []) as string[];
    
    if (contactId && messageIds.length > 0) {
      // Use contactId to update the correct conversation in the store
      messageIds.forEach(msgId => {
        useChatStore.getState().updateMessageStatus(String(msgId), contactId, 'read');
      });
      this.notifyEventHandlers(); // Notify generic handlers
    }
  }
  
  private handlePresenceUpdate(data: WebSocketMessage) {
    const presenceUserId = data.from || data.from_user || data.payload?.userId;
    const presenceStatus = data.payload?.status || data.status || 'offline';
    
    if (presenceUserId) {
      presenceManager.updateContactStatus(presenceUserId, presenceStatus as PresenceState);
    }
  }
  
  private async handleReplyMessage(data: WebSocketMessage) {
    try {
      // Get the message data from the payload
      const {
        id: messageId,
        text,
        timestamp,
        status,
        attachments,
        reply_to: replyTo
      } = data.payload || {};
      
      // Skip if missing required fields
      if (!messageId || !text) {
        return;
      }
      
      // Determine if this is a group message
      const isGroupMessage = !!data.group_id;
      
      // Create a new message object
      const newMessage: Message = {
        id: messageId,
        senderId: data.from || '',
        receiverId: data.to || '',
        text,
        timestamp,
        status: status || 'sent',
        attachments,
        replyTo,
        groupId: isGroupMessage ? data.group_id : undefined
      };
      
      // Add the message to the store
      const chatStore = useChatStore.getState();
      chatStore.addMessage(newMessage);
      
      // If message is from someone else, send a read receipt
      if (data.from !== useAuthStore.getState().user?.id) {
        const conversationId = isGroupMessage ? data.group_id : data.from;
        
        // Only automatically send read receipt if we're viewing this conversation
        if (chatStore.activeConversationId === conversationId) {
          this.sendReadReceipt(conversationId, messageId);
        }
        
        // Show notification if not the active conversation
        if (chatStore.activeConversationId !== conversationId) {
          // Get the sender's display name
          let senderName = data.from || '';
          if (isGroupMessage) {
            // For group messages, look up the sender name in the group members
            const group = chatStore.groups[data.group_id];
            if (group) {
              const sender = group.members.find(m => m.user_id === data.from);
              if (sender) {
                senderName = sender.display_name;
              }
            }
          } else {
            // For direct messages, check if the sender is a contact
            const contacts = useContactsStore.getState().contacts;
            const sender = contacts.find(c => c.contact_id === data.from);
            if (sender) {
              senderName = sender.contact_display_name;
            }
          }
          
          await this._notifyUser({
            ...newMessage,
            senderName
          } as any);
        }
      }
    } catch (error) {
      console.error('Error handling reply message:', error);
      this.notifyErrorHandlers(error);
    }
  }
  
  private handleEditMessage(data: WebSocketMessage) {
    const editData = data.payload || {};
    const editMessageId = String(data.message_id || editData.messageId || '');
    const editedText = data.text || editData.text || '';
    const editedAt = data.edited_at || editData.editedAt || new Date().toISOString();
    const editorId = data.from || data.from_user;
    
    if (editMessageId && editedText && editorId) {
      const user = useAuthStore.getState().user;
      const contactId = user?.id === editorId ? data.to || data.to_user : editorId;
      
      if (contactId) {
        useChatStore.getState().updateEditedMessage(editMessageId, contactId, editedText, editedAt);
        this.notifyEventHandlers();
      }
    }
  }
  
  private handleDeleteMessage(data: WebSocketMessage) {
    const deleteData = data.payload || {};
    const deleteMessageId = String(data.message_id || deleteData.messageId || '');
    const deletedAt = data.deleted_at || deleteData.deletedAt || new Date().toISOString();
    const deleterId = data.from || data.from_user;
    
    if (deleteMessageId && deleterId) {
      const user = useAuthStore.getState().user;
      const contactId = user?.id === deleterId ? data.to || data.to_user : deleterId;
      
      if (contactId) {
        useChatStore.getState().updateDeletedMessage(deleteMessageId, contactId, deletedAt);
        this.notifyEventHandlers();
      }
    }
  }
  
  private handleErrorMessage(data: WebSocketMessage) {
    const errorDetails = data.payload?.message || 'Unknown server error';
    this.notifyErrorHandlers(errorDetails);
  }
}

const websocketService = new WebSocketService();

export default websocketService;