import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { useContactsStore } from '../stores/contactsStore';
import { 
  PaperAirplaneIcon, 
  PaperClipIcon, 
  FaceSmileIcon, 
  MicrophoneIcon,
  XMarkIcon,
  PhotoIcon,
  DocumentIcon,
  FilmIcon,
} from '@heroicons/react/24/outline';
import websocketService from '../services/websocketService';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebaseConfig';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import StatusIndicator from './StatusIndicator';
import { generateAvatarUrl } from '../utils/avatarUtils';
import { useWebSocketConnection } from '../hooks/useWebSocketConnection';
import EmojiPicker, { EmojiClickData, Theme, EmojiStyle, Categories } from 'emoji-picker-react';

interface ChatWindowProps {
  contactId: string;
}

type ActivityType = 'react' | 'reply' | 'edit' | 'delete' | 'read';

interface ActivityNotification {
  id: string;
  type: ActivityType;
  userId: string;
  messageId?: string;
  timestamp: number;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ contactId }) => {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [activityNotifications, setActivityNotifications] = useState<ActivityNotification[]>([]);
  const observedMessagesRef = useRef<Set<string>>(new Set());
  
  // Keep a reference to the previous conversation state to compare for changes
  const previousMessagesRef = useRef<Record<string, any>>({});
  
  const { user } = useAuthStore();
  const { conversations, typingIndicators } = useChatStore();
  const { contacts } = useContactsStore();
  const { connectionStatus } = useWebSocketConnection();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageObserverRef = useRef<IntersectionObserver | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  
  if (!contacts || contacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
        <p className="text-gray-500 dark:text-gray-400">Loading contacts...</p>
      </div>
    );
  }
  
  const contact = contacts.find(c => c.contact_id === contactId);
  const conversation = conversations?.[contactId];
  const messages = conversation?.messages || [];
  const isContactTyping = typingIndicators?.[contactId] || false;
  
  const messageRefCallback = useCallback((node: HTMLDivElement | null, messageId: string) => {
    if (node) {
      messageRefs.current.set(messageId, node);
    } else {
      messageRefs.current.delete(messageId);
    }
  }, []);
  
  const handleMessageInView = useCallback((messageId: string, senderId: string) => {
    if (senderId !== user?.id && !observedMessagesRef.current.has(messageId)) {
      websocketService.sendReadReceipt(contactId, messageId);
      observedMessagesRef.current.add(messageId);
    }
  }, [contactId, user?.id]);
  
  useEffect(() => {
    observedMessagesRef.current = new Set();
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const messageId = entry.target.getAttribute('data-message-id');
            const senderId = entry.target.getAttribute('data-sender-id');
            
            if (messageId && senderId) {
              handleMessageInView(messageId, senderId);
            }
          }
        });
      },
      { threshold: 0.5 }
    );
    
    messageObserverRef.current = observer;
    
    return () => observer.disconnect();
  }, [contactId, handleMessageInView]);
  
  useEffect(() => {
    const observer = messageObserverRef.current;
    if (!observer) return;
    
    observer.disconnect();
    
    messageRefs.current.forEach((node) => {
      observer.observe(node);
    });
  }, [messages]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user && contactId) {
        const conversation = conversations?.[contactId];
        if (!conversation?.messages?.length) return;
        
        const unreadMessages = conversation.messages.filter(
          msg => msg.senderId === contactId && msg.status !== 'read'
        );
        
        if (unreadMessages.length > 0) {
          const lastMessage = unreadMessages[unreadMessages.length - 1];
          websocketService.sendReadReceipt(contactId, lastMessage.id);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [contactId, user, conversations]);
  
  useEffect(() => {
    inputRef.current?.focus();
  }, [contactId]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showEmojiPicker) {
        setShowEmojiPicker(false);
      }
    };
    
    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [showEmojiPicker]);
  
  // Define the showActivityNotification function before using it in useEffect
  const showActivityNotification = useCallback((type: ActivityType, userId: string, messageId?: string) => {
    if (userId === user?.id) return;
    
    const id = `${type}-${userId}-${messageId || ''}-${Date.now()}`;
    
    setActivityNotifications(prev => [
      ...prev,
      { id, type, userId, messageId, timestamp: Date.now() }
    ]);
    
    setTimeout(() => {
      setActivityNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  }, [user?.id]);
  
  // Effect to watch for changes in messages, particularly edits, deletes, and reactions
  useEffect(() => {
    if (!contactId || !user) return;
    
    const currentMessages = conversations[contactId]?.messages || [];
    const currentMessagesById = Object.fromEntries(
      currentMessages.map(msg => [msg.id, msg])
    );
    
    // Initialize the previous messages reference if it doesn't exist for this contact
    if (!previousMessagesRef.current[contactId]) {
      previousMessagesRef.current[contactId] = { ...currentMessagesById };
      return; // First load, nothing to compare
    }
    
    const prevMessagesById = previousMessagesRef.current[contactId] || {};
    
    // Check for changes in existing messages
    Object.keys(currentMessagesById).forEach(msgId => {
      const currentMsg = currentMessagesById[msgId];
      const prevMsg = prevMessagesById[msgId];
      
      // Skip if message is new (not in previous state)
      if (!prevMsg) return;
      
      // Check for reaction changes
      if (JSON.stringify(prevMsg.reactions) !== JSON.stringify(currentMsg.reactions)) {
        console.log(`[ChatWindow] Detected reaction change for message ${msgId}`);
        showActivityNotification('react', currentMsg.senderId, msgId);
      }
      
      // Check for edits
      if (prevMsg.text !== currentMsg.text && currentMsg.isEdited) {
        console.log(`[ChatWindow] Detected edit for message ${msgId}`);
        showActivityNotification('edit', currentMsg.senderId, msgId);
      }
      
      // Check for deletions
      if (!prevMsg.isDeleted && currentMsg.isDeleted) {
        console.log(`[ChatWindow] Detected deletion for message ${msgId}`);
        showActivityNotification('delete', currentMsg.senderId, msgId);
      }
      
      // Check for read receipts
      if (prevMsg.status !== 'read' && currentMsg.status === 'read') {
        console.log(`[ChatWindow] Detected read receipt for message ${msgId}`);
        showActivityNotification('read', contactId, msgId);
      }
    });
    
    // Update the previous messages reference
    previousMessagesRef.current[contactId] = { ...currentMessagesById };
  }, [contactId, user, conversations, showActivityNotification]);
  
  // Force a refresh on WebSocket events to ensure UI updates
  useEffect(() => {
    if (!contactId) return;
    
    console.log('[ChatWindow] Setting up WebSocket event subscription for', contactId);
    
    const handleWebSocketEvent = () => {
      console.log('[ChatWindow] WebSocket event received, forcing state refresh');
      
      // Force a complete rebuild of the previous messages reference
      // This ensures the next comparison will detect changes
      const currentConversation = conversations[contactId];
      if (currentConversation && currentConversation.messages) {
        // Set to empty object first to ensure we'll detect all changes
        previousMessagesRef.current[contactId] = {};
        
        // Force a re-render by updating state
        setActivityNotifications(prev => [...prev]);
      }
    };
    
    const unsubscribe = websocketService.subscribeToEvents(handleWebSocketEvent);
    
    return () => {
      console.log('[ChatWindow] Cleaning up WebSocket event subscription');
      if (unsubscribe) unsubscribe();
    };
  }, [contactId, conversations]);
  
  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      websocketService.sendTypingIndicator(contactId, true);
    }
    
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    const timeout = setTimeout(() => {
      setIsTyping(false);
      websocketService.sendTypingIndicator(contactId, false);
    }, 2000);
    
    setTypingTimeout(timeout);
  };
  
  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    handleTyping();
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileArray = Array.from(e.target.files);
      setFiles(prev => [...prev, ...fileArray]);
      setShowAttachMenu(false);
    }
  };
  
  const uploadFiles = async (): Promise<any[]> => {
    if (files.length === 0) return [];
    
    setUploading(true);
    const uploads = files.map(file => {
      return new Promise<any>((resolve, reject) => {
        const storageRef = ref(storage, `chats/${user?.id}/${contactId}/${Date.now()}_${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);
        
        uploadTask.on(
          'state_changed',
          () => {},
          (error) => reject(error),
          async () => {
            try {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve({
                type: file.type.split('/')[0],
                url: downloadURL,
                name: file.name,
                size: file.size,
              });
            } catch (error) {
              reject(error);
            }
          }
        );
      });
    });
    
    try {
      const attachments = await Promise.all(uploads);
      setUploading(false);
      setFiles([]);
      return attachments;
    } catch (error) {
      console.error('Error uploading files:', error);
      setUploading(false);
      return [];
    }
  };
  
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if ((!message.trim() && files.length === 0) || !user || uploading) return;
    
    try {
      const attachments = await uploadFiles();
      websocketService.sendMessage(contactId, message, attachments);
      
      setMessage('');
      setFiles([]);
      
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      setIsTyping(false);
      websocketService.sendTypingIndicator(contactId, false);
      
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };
  
  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };
  
  const handleAttachmentClick = () => {
    setShowAttachMenu(!showAttachMenu);
    setShowEmojiPicker(false);
  };
  
  const handleFileTypeSelect = (type: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('accept', type);
      fileInputRef.current.click();
    }
    setShowAttachMenu(false);
  };
  
  const renderActivityNotifications = () => {
    if (activityNotifications.length === 0) return null;
    
    const recentNotifications = [...activityNotifications]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 2);
    
    return (
      <div className="absolute top-0 left-0 right-0 z-10">
        {recentNotifications.map(notification => {
          const contact = contacts.find(c => c.contact_id === notification.userId);
          const name = contact?.contact_display_name || 'Someone';
          
          let message = '';
          switch (notification.type) {
            case 'react':
              message = `${name} reacted to a message`;
              break;
            case 'reply':
              message = `${name} replied to a message`;
              break;
            case 'edit':
              message = `${name} edited a message`;
              break;
            case 'delete':
              message = `${name} deleted a message`;
              break;
            case 'read':
              message = `${name} read your messages`;
              break;
          }
          
          return (
            <div 
              key={notification.id}
              className="bg-primary-50 dark:bg-primary-900/20 border-l-4 border-primary-500 dark:border-primary-400 px-4 py-2 m-2 rounded shadow-md animate-fadeIn"
            >
              <p className="text-sm text-primary-700 dark:text-primary-300">{message}</p>
            </div>
          );
        })}
      </div>
    );
  };
  
  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
        <p className="text-gray-500 dark:text-gray-400">Contact not found</p>
      </div>
    );
  }
  
  const renderFilePreview = (file: File, index: number) => {
    const FileIcon = file.type.startsWith('image/') 
      ? PhotoIcon 
      : file.type.startsWith('video/') 
        ? FilmIcon 
        : DocumentIcon;
    
    const iconColorClass = file.type.startsWith('image/') 
      ? 'text-blue-500' 
      : file.type.startsWith('video/') 
        ? 'text-purple-500' 
        : 'text-gray-500';
    
    return (
      <div key={index} className="group relative bg-white dark:bg-dark-800 rounded-xl p-2 flex items-center text-sm border border-gray-200 dark:border-dark-600 shadow-sm animate-scale-in">
        <FileIcon className={`h-5 w-5 ${iconColorClass} mr-2 flex-shrink-0`} />
        <span className="truncate max-w-[140px] text-gray-800 dark:text-gray-200">{file.name}</span>
        <button
          type="button"
          className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
          onClick={() => removeFile(index)}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    );
  };
  
  const renderAttachmentMenu = () => (
    <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-dark-800 rounded-xl shadow-lg border border-gray-200 dark:border-dark-700 p-2 animate-slide-up">
      <div className="flex space-x-2">
        <button
          type="button"
          onClick={() => handleFileTypeSelect('image/*')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <PhotoIcon className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => handleFileTypeSelect('video/*')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <FilmIcon className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={() => handleFileTypeSelect('*')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-700 text-gray-600 dark:text-gray-300 transition-colors"
        >
          <DocumentIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
  
  const renderEmptyChat = () => (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md px-4 animate-fade-in">
        <div className="mx-auto w-16 h-16 bg-gray-100 dark:bg-dark-800 rounded-full flex items-center justify-center mb-4">
          <PaperAirplaneIcon className="h-8 w-8 text-gray-400 dark:text-gray-500 transform rotate-90" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">Start a conversation</h3>
        <p className="mt-2 text-gray-500 dark:text-gray-400">
          Send a message to {contact.contact_display_name} to start chatting
        </p>
      </div>
    </div>
  );
  
  const renderMessages = () => (
    <div className="space-y-1 pl-16 pr-4">
      {messages.map((msg) => (
        <div 
          key={msg.id}
          ref={(node) => messageRefCallback(node, msg.id)}
          data-message-id={msg.id}
          data-sender-id={msg.senderId}
        >
          <MessageBubble
            message={msg}
            isOwn={msg.senderId === user?.id}
            contactId={contactId}
          />
        </div>
      ))}
      
      {isContactTyping && <TypingIndicator />}
      <div ref={messagesEndRef} />
    </div>
  );
  
  const isMessageInputDisabled = (!message.trim() && files.length === 0) || uploading;
  
  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessage(prevMessage => prevMessage + emojiData.emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };
  
  // Define emoji picker categories with correct type
  const emojiCategories = [
    {
      name: "Recently Used",
      category: Categories.SUGGESTED
    },
    {
      name: "Smileys & People",
      category: Categories.SMILEYS_PEOPLE
    },
    {
      name: "Animals & Nature",
      category: Categories.ANIMALS_NATURE
    },
    {
      name: "Food & Drink",
      category: Categories.FOOD_DRINK
    },
    {
      name: "Travel & Places",
      category: Categories.TRAVEL_PLACES
    },
    {
      name: "Activities",
      category: Categories.ACTIVITIES
    },
    {
      name: "Objects",
      category: Categories.OBJECTS
    },
    {
      name: "Symbols",
      category: Categories.SYMBOLS
    },
    {
      name: "Flags",
      category: Categories.FLAGS
    }
  ];
  
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="bg-white dark:bg-dark-800 shadow-sm p-3 flex items-center border-b border-gray-200 dark:border-dark-700">
        <div className="flex-1 flex items-center">
          <div className="relative w-10 h-10 rounded-full overflow-hidden mr-3 bg-gray-200 dark:bg-dark-700 flex-shrink-0">
            <img 
              src={contact?.contact_avatar_url || generateAvatarUrl(contact?.contact_display_name || 'User')} 
              alt={contact?.contact_display_name || 'User'} 
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute bottom-0 right-0">
              <StatusIndicator 
                status={conversation?.contactStatus || contact?.contact_status || 'offline'} 
                size="sm"
              />
            </div>
          </div>
          <div className="flex items-center flex-1">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {contact?.contact_display_name || 'Loading...'}
              </h2>
              <div className="flex items-center">
                <StatusIndicator 
                  status={conversation?.contactStatus || contact?.contact_status || 'offline'} 
                  size="sm" 
                  showLabel={true} 
                />
                {isContactTyping && <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">• Typing...</span>}
              </div>
            </div>
          </div>
        </div>
        {connectionStatus.state !== 'connected' && (
          <div className="px-2 py-1 bg-yellow-100 dark:bg-yellow-800 rounded text-xs text-yellow-800 dark:text-yellow-200">
            Reconnecting...
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 relative bg-gray-50 dark:bg-dark-900">
        {renderActivityNotifications()}
        <div className="space-y-4 pb-2">
          {messages.length === 0 ? renderEmptyChat() : renderMessages()}
        </div>
      </div>
      
      <div className="bg-white dark:bg-dark-800 border-t border-gray-200 dark:border-dark-700 p-3">
        {files.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2 bg-gray-50 dark:bg-dark-700 p-2 rounded-xl max-h-32 overflow-y-auto">
            {files.map((file, index) => renderFilePreview(file, index))}
          </div>
        )}
        
        <form onSubmit={handleSendMessage} className="flex items-end">
          <div className="relative flex-1">
            {showAttachMenu && renderAttachmentMenu()}
            
            {showEmojiPicker && (
              <div 
                ref={emojiPickerRef}
                className="absolute bottom-12 right-0 z-50 animate-fade-in"
                style={{ boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' }}
              >
                <div className="p-1 bg-white dark:bg-dark-800 rounded-lg border border-gray-200 dark:border-dark-700 overflow-hidden">
                  <EmojiPicker 
                    onEmojiClick={handleEmojiClick} 
                    theme={document.documentElement.classList.contains('dark') ? Theme.DARK : Theme.LIGHT}
                    width={320}
                    height={400}
                    lazyLoadEmojis={true}
                    searchDisabled={false}
                    skinTonesDisabled={false}
                    emojiStyle={document.documentElement.classList.contains('dark') ? EmojiStyle.NATIVE : EmojiStyle.APPLE}
                    previewConfig={{
                      showPreview: true,
                      defaultCaption: "Choose your emoji..."
                    }}
                    categories={emojiCategories}
                  />
                </div>
                <div className="absolute w-4 h-4 bg-white dark:bg-dark-800 transform rotate-45 right-5 -bottom-2 border-r border-b border-gray-200 dark:border-dark-700"></div>
              </div>
            )}
            
            <div className="flex items-center bg-gray-100 dark:bg-dark-700 rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 dark:focus-within:ring-secondary-500 transition-all">
              <button
                type="button"
                onClick={handleAttachmentClick}
                className={`text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 mr-2 focus:outline-none transition-colors ${showAttachMenu ? 'text-primary-600 dark:text-secondary-400' : ''}`}
              >
                <PaperClipIcon className="h-5 w-5" />
              </button>
              
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={handleMessageChange}
                placeholder="Type a message..."
                className="flex-1 bg-transparent border-0 focus:ring-0 text-gray-700 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              />
              
              <div className="flex items-center ml-2 space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiPicker(!showEmojiPicker);
                    setShowAttachMenu(false);
                  }}
                  className={`text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 focus:outline-none transition-colors ${showEmojiPicker ? 'text-primary-600 dark:text-secondary-400' : ''}`}
                >
                  <FaceSmileIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-secondary-400 focus:outline-none transition-colors"
                >
                  <MicrophoneIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
          
          <button
            type="submit"
            disabled={isMessageInputDisabled}
            className={`ml-2 p-2.5 rounded-full focus:outline-none ${
              isMessageInputDisabled
                ? 'bg-gray-300 dark:bg-dark-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700 dark:bg-secondary-600 dark:hover:bg-secondary-700 text-white shadow-md transition-colors'
            }`}
          >
            {uploading ? (
              <div className="h-5 w-5 border-2 border-t-transparent border-white rounded-full animate-spin" />
            ) : (
              <PaperAirplaneIcon className="h-5 w-5 transform rotate-90" />
            )}
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </form>
      </div>
    </div>
  );
};

export default ChatWindow;