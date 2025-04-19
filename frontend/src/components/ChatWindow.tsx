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
  PencilIcon,
  ArrowUturnLeftIcon,
} from '@heroicons/react/24/outline';
import websocketService from '../services/websocketService';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebaseConfig';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import StatusIndicator from './StatusIndicator';
import { formatMessageTime } from '../utils/dateUtils';
import { Message, Attachment } from '../types';
import { useWebSocketConnection } from '../hooks/useWebSocketConnection';
import { generateAvatarUrl } from '../utils/avatarUtils';
import EmojiPicker, { EmojiClickData, Theme, EmojiStyle, Categories } from 'emoji-picker-react';
import { toast } from 'react-hot-toast';

interface ChatWindowProps {
  contactId: string;
}

type ActionMode = 'edit' | 'reply' | 'none';

const ChatWindow: React.FC<ChatWindowProps> = ({ contactId }) => {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  
  // Force a refresh every time there's a websocket event
  const [wsEventCounter, setWsEventCounter] = useState(0);
  
  const { user } = useAuthStore();
  const { 
    messages, 
    typingIndicator, 
    contactStatus,
  } = useChatStore(state => {
    const conversation = state.conversations[contactId];
    return {
      messages: conversation?.messages || [],
      typingIndicator: state.typingIndicators[contactId] || false,
      contactStatus: conversation?.contactStatus || 'offline', // Assuming status is stored here
    };
  }, (oldState, newState) => {
    // Custom equality check: re-render if messages array ref, typing, status changes, OR message statuses change.
    const oldStatuses = oldState.messages.map(m => m.status).join(',');
    const newStatuses = newState.messages.map(m => m.status).join(',');
    
    return oldState.messages === newState.messages && 
           oldState.typingIndicator === newState.typingIndicator &&
           oldState.contactStatus === newState.contactStatus &&
           oldStatuses === newStatuses; // Add check for message statuses
  });
  
  // Select actions separately (they don't change)
  const { editMessage, sendReply } = useChatStore(state => ({ 
    editMessage: state.editMessage, 
    sendReply: state.sendReply 
  }));
  
  const { contacts } = useContactsStore();
  const { connectionStatus } = useWebSocketConnection();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageObserverRef = useRef<IntersectionObserver | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const observedMessagesRef = useRef<Set<string>>(new Set());
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  
  if (!contacts || contacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
        <p className="text-gray-500 dark:text-gray-400">Loading contacts...</p>
      </div>
    );
  }
  
  const contact = contacts.find(c => c.contact_id === contactId);
  const isContactTyping = typingIndicator;
  
  // Find the *current* target message data based on ID
  const currentTargetMessage = targetMessageId ? messages.find(m => m.id === targetMessageId) : null;

  // Define cancelAction *before* the effect that uses it
  const cancelAction = useCallback(() => {
    setTargetMessageId(null);
    setActionMode('none');
    setMessage('');
    setFiles([]);
  }, []);

  // Effect to auto-cancel action if target message disappears (e.g., deleted)
  useEffect(() => {
    if (targetMessageId && !currentTargetMessage) {
      console.warn('Target message for action not found, cancelling action.');
      cancelAction();
    }
  }, [targetMessageId, currentTargetMessage, cancelAction]); // Depend on currentTargetMessage derived from messages
  
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
        // Get latest state directly from store inside handler
        const conversation = useChatStore.getState().conversations[contactId];
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
  }, [contactId, user]); // Removed conversations from dependency array
  
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
  
  // Subscribe to WebSocket events to handle UI updates
  useEffect(() => {
    if (!contactId) return;
    
    const handleWebSocketEvent = () => {
      // Keep the logic to fetch messages if none are loaded, triggered by an event
      const currentConversation = useChatStore.getState().conversations[contactId];
      if (!currentConversation || currentConversation.messages?.length === 0) {
        useChatStore.getState().fetchMessagesForContact(contactId);
      }
      
      // Check for any missed read receipts
      const conversation = useChatStore.getState().conversations[contactId]; // Get latest state
      if (conversation?.messages?.length > 0) {
        const unreadMessages = conversation.messages.filter(
          msg => msg.senderId === contactId && msg.status !== 'read'
        );
        
        if (unreadMessages.length > 0) {
          unreadMessages.forEach(msg => {
            // Use the queuing mechanism in websocketService
            websocketService.sendReadReceipt(contactId, msg.id);
          });
        }
      }
    };
    
    const unsubscribe = websocketService.subscribeToEvents(handleWebSocketEvent);
    
    return () => {
      websocketService.sendPendingReadReceipts(); // Send any pending read receipts before unmounting
      if (unsubscribe) unsubscribe();
    };
  }, [contactId]);
  
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
              
              // Determine the primary type (image, video, audio, file)
              let primaryType = 'file';
              if (file.type.startsWith('image/')) {
                primaryType = 'image';
              } else if (file.type.startsWith('video/')) {
                primaryType = 'video';
              } else if (file.type.startsWith('audio/')) {
                primaryType = 'audio';
              }
              
              resolve({
                type: primaryType,
                url: downloadURL,
                name: file.name,
                size: file.size,
                fileType: file.type, // Store the full MIME type for reference
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
    if ((message.trim() === '' && files.length === 0) || !user || !contactId || uploading) return;

    // Stop typing indicator immediately
    if (isTyping) {
      clearTimeout(typingTimeout!);
      setIsTyping(false);
      websocketService.sendTypingIndicator(contactId, false);
      setTypingTimeout(null);
    }

    try {
      let uploadedFiles: any[] = [];
      if (files.length > 0) {
        uploadedFiles = await uploadFiles();
      }

      if (actionMode === 'edit' && targetMessageId) {
        // Edit message logic
        await editMessage(targetMessageId, contactId, message.trim());
        toast.success('Message updated');
      } else if (actionMode === 'reply' && targetMessageId) {
        // Reply message logic
        await sendReply(contactId, message.trim(), targetMessageId, uploadedFiles);
        toast.success('Reply sent');
      } else {
        // Send new message logic
        websocketService.sendMessage(contactId, message.trim(), uploadedFiles);
      }

      // Reset state after sending/editing/replying
      setTargetMessageId(null);
      setActionMode('none');
      setMessage('');
      setFiles([]);

    } catch (error) {
      console.error('Error sending/editing/replying message:', error);
      toast.error('Failed to process message.');
      setUploading(false); // Ensure uploading state is reset on error
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
  
  // Add handlers for starting edit/reply
  const handleStartEdit = useCallback((msg: Message) => {
    setTargetMessageId(msg.id);
    setActionMode('edit');
    setMessage(msg.text);
    inputRef.current?.focus();
  }, []);

  const handleStartReply = useCallback((msg: Message) => {
    setTargetMessageId(msg.id);
    setActionMode('reply');
    setMessage('');
    inputRef.current?.focus();
  }, []);

  // Reset action mode when contact changes
  useEffect(() => {
    cancelAction();
  }, [contactId, cancelAction]);
  
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
  
  const renderMessages = () => {
    return (
      <div className="space-y-2 px-4">
        {messages.map((msg) => {
          const isOwn = msg.senderId === user?.id;
          const msgContact = !isOwn ? contacts.find(c => c.contact_id === msg.senderId) : null;
          
          return (
            <div 
              key={msg.id}
              ref={(node) => messageRefCallback(node, msg.id)}
              data-message-id={msg.id}
              data-sender-id={msg.senderId}
              className={`flex items-end ${isOwn ? 'justify-end' : 'justify-start'} gap-2`}
            >
              {!isOwn && (
                <img
                  src={msgContact?.contact_avatar_url || generateAvatarUrl(msgContact?.contact_display_name || '', 32)}
                  alt={msgContact?.contact_display_name || 'User'}
                  className="h-8 w-8 rounded-full object-cover shadow-sm mb-1 flex-shrink-0"
                />
              )}
              <MessageBubble
                message={msg}
                isOwn={isOwn}
                contactId={contactId}
                onStartEdit={handleStartEdit}
                onStartReply={handleStartReply}
              />
            </div>
          );
        })}
        
        {isContactTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>
    );
  };
  
  const isMessageInputDisabled = (!message.trim() && files.length === 0) || uploading;
  
  const handleEmojiClick = (emojiData: EmojiClickData) => {
    setMessage(prevMessage => prevMessage + emojiData.emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };
  
  // Define emoji picker categories with correct type
  const emojiCategories = [
    { name: "Recently Used", category: Categories.SUGGESTED },
    { name: "Smileys & People", category: Categories.SMILEYS_PEOPLE },
    { name: "Animals & Nature", category: Categories.ANIMALS_NATURE },
    { name: "Food & Drink", category: Categories.FOOD_DRINK },
    { name: "Travel & Places", category: Categories.TRAVEL_PLACES },
    { name: "Activities", category: Categories.ACTIVITIES },
    { name: "Objects", category: Categories.OBJECTS },
    { name: "Symbols", category: Categories.SYMBOLS },
    { name: "Flags", category: Categories.FLAGS }
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
                status={contactStatus || contact?.contact_status || 'offline'} 
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
                  status={contactStatus || contact?.contact_status || 'offline'} 
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
        <div className="space-y-4 pb-2">
          {messages.length === 0 ? renderEmptyChat() : renderMessages()}
        </div>
      </div>
      
      {/* Input Area Container */}
      <div className="bg-white dark:bg-dark-800 border-t border-gray-200 dark:border-dark-700">

        {/* Action Context Area */}
        {actionMode !== 'none' && currentTargetMessage && (
          <div className="px-3 py-2 border-b border-gray-200 dark:border-dark-700 bg-gray-50 dark:bg-dark-800 text-xs flex items-center justify-between transition-all duration-150 ease-in-out animate-fade-in-fast">
            <div className="flex items-center min-w-0">
              {/* Icon indicating action type */}
              {actionMode === 'edit' ? (
                <PencilIcon className="h-4 w-4 text-blue-500 dark:text-blue-400 mr-2 flex-shrink-0" />
              ) : (
                <ArrowUturnLeftIcon className="h-4 w-4 text-green-500 dark:text-green-400 mr-2 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-700 dark:text-gray-300 mb-0.5">
                  {actionMode === 'edit' ? 'Editing Message' : `Replying to ${currentTargetMessage.senderId === user?.id ? 'yourself' : contacts.find(c => c.contact_id === currentTargetMessage.senderId)?.contact_display_name || 'Unknown'}`}
                </div>
                <p className="truncate italic text-gray-500 dark:text-gray-400">
                  {currentTargetMessage.isDeleted ? 'Original message was deleted' :
                    currentTargetMessage.text ? currentTargetMessage.text :
                      (currentTargetMessage.attachments && currentTargetMessage.attachments.length > 0 ?
                        `${currentTargetMessage.attachments.length} attachment${currentTargetMessage.attachments.length > 1 ? 's' : ''}`
                        : 'Empty message')
                  }
                </p>
              </div>
            </div>
            <button
              onClick={cancelAction}
              className="ml-3 p-1 rounded-full text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-700 focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-offset-gray-50 dark:focus:ring-offset-dark-850 focus:ring-primary-500 dark:focus:ring-secondary-400"
              aria-label="Cancel action"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* File Previews */}
        {files.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-2 bg-gray-50 dark:bg-dark-700 max-h-28 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-dark-600">
            {files.map((file, index) => renderFilePreview(file, index))}
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSendMessage} className="flex items-end p-3">
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