import { useState, useRef, useEffect } from 'react';
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
import { format } from 'date-fns';
import websocketService from '../services/websocketService';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebaseConfig';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';

interface ChatWindowProps {
  contactId: string;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ contactId }) => {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  
  const { user } = useAuthStore();
  const { conversations, typingIndicators } = useChatStore();
  const { contacts } = useContactsStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Check if contacts is defined before accessing a key
  if (!contacts || contacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
        <p className="text-gray-500 dark:text-gray-400">Loading contacts...</p>
      </div>
    );
  }
  
  // Find the contact by ID
  const contact = contacts.find(c => c.contact_id === contactId);
  const conversation = conversations?.[contactId];
  const messages = conversation?.messages || [];
  const isContactTyping = typingIndicators?.[contactId] || false;
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Auto-focus the input field
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [contactId]);
  
  // Handle typing indicator
  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      websocketService.sendTypingIndicator(contactId, true);
    }
    
    // Clear previous timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      setIsTyping(false);
      websocketService.sendTypingIndicator(contactId, false);
    }, 2000);
    
    setTypingTimeout(timeout);
  };
  
  // Handle message input change
  const handleMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    handleTyping();
  };
  
  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileArray = Array.from(e.target.files);
      setFiles(prev => [...prev, ...fileArray]);
      setShowAttachMenu(false);
    }
  };
  
  // Upload files to Firebase Storage
  const uploadFiles = async (): Promise<any[]> => {
    if (files.length === 0) return [];
    
    setUploading(true);
    const uploads = files.map(file => {
      return new Promise<any>((resolve, reject) => {
        const storageRef = ref(storage, `chats/${user?.id}/${contactId}/${Date.now()}_${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);
        
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            // You could track progress here if needed
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log(`Upload is ${progress}% done`);
          },
          (error) => {
            console.error('Upload error:', error);
            reject(error);
          },
          async () => {
            try {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve({
                type: file.type.split('/')[0], // 'image', 'video', etc.
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
  
  // Handle message send
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if ((!message.trim() && files.length === 0) || !user || uploading) return;
    
    try {
      // Upload files if any
      const attachments = await uploadFiles();
      
      // Send message
      websocketService.sendMessage(contactId, message, attachments);
      
      // Reset state
      setMessage('');
      setFiles([]);
      
      // Clear typing indicator
      if (typingTimeout) {
        clearTimeout(typingTimeout);
      }
      setIsTyping(false);
      websocketService.sendTypingIndicator(contactId, false);
      
      // Focus the input field
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };
  
  // Remove a file from the list
  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };
  
  // Handle attachment button click
  const handleAttachmentClick = () => {
    setShowAttachMenu(!showAttachMenu);
    setShowEmojiPicker(false);
  };
  
  // Handle file type selection
  const handleFileTypeSelect = (type: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('accept', type);
      fileInputRef.current.click();
    }
    setShowAttachMenu(false);
  };
  
  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-dark-900 transition-colors duration-200">
        <p className="text-gray-500 dark:text-gray-400">Contact not found</p>
      </div>
    );
  }
  
  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-dark-900 transition-colors duration-200">
      {/* Chat header */}
      <div className="bg-white dark:bg-dark-800 border-b border-gray-200 dark:border-dark-700 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center">
          <div className="flex-shrink-0 relative">
            <img
              className="h-10 w-10 rounded-full object-cover ring-2 ring-gray-100 dark:ring-dark-700"
              src={contact.contact_avatar_url || 'https://via.placeholder.com/150'}
              alt={contact.contact_display_name}
            />
            <div
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-dark-800 ${
                contact.contact_status === 'online'
                  ? 'bg-green-500'
                  : contact.contact_status === 'away'
                  ? 'bg-yellow-500'
                  : 'bg-gray-500'
              }`}
            ></div>
          </div>
          <div className="ml-3">
            <h2 className="text-base font-medium text-gray-900 dark:text-white">{contact.contact_display_name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isContactTyping
                ? 'Typing...'
                : contact.contact_status === 'online'
                ? 'Online'
                : contact.contact_status === 'away'
                ? 'Away'
                : contact.updated_at
                ? (() => {
                    try {
                      // Parse the date safely
                      const date = new Date(contact.updated_at);
                      // Check if the date is valid
                      return !isNaN(date.getTime())
                        ? `Last seen ${format(date, 'p')}`
                        : 'Offline';
                    } catch (error) {
                      return 'Offline';
                    }
                  })()
                : 'Offline'}
            </p>
          </div>
        </div>
      </div>
      
      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.length === 0 ? (
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
        ) : (
          <div className="space-y-1">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.senderId === user?.id}
              />
            ))}
            
            {/* Typing indicator */}
            {isContactTyping && <TypingIndicator />}
            
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      
      {/* Message input */}
      <div className="bg-white dark:bg-dark-800 border-t border-gray-200 dark:border-dark-700 p-3">
        {/* Preview of files to upload */}
        {files.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2 bg-gray-50 dark:bg-dark-700 p-2 rounded-xl max-h-32 overflow-y-auto">
            {files.map((file, index) => (
              <div
                key={index}
                className="group relative bg-white dark:bg-dark-800 rounded-xl p-2 flex items-center text-sm border border-gray-200 dark:border-dark-600 shadow-sm animate-scale-in"
              >
                {file.type.startsWith('image/') ? (
                  <PhotoIcon className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                ) : file.type.startsWith('video/') ? (
                  <FilmIcon className="h-5 w-5 text-purple-500 mr-2 flex-shrink-0" />
                ) : (
                  <DocumentIcon className="h-5 w-5 text-gray-500 mr-2 flex-shrink-0" />
                )}
                <span className="truncate max-w-[140px] text-gray-800 dark:text-gray-200">{file.name}</span>
                <button
                  type="button"
                  className="ml-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
                  onClick={() => removeFile(index)}
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Input form */}
        <form onSubmit={handleSendMessage} className="flex items-end">
          <div className="relative flex-1">
            {/* Attachment options */}
            {showAttachMenu && (
              <div className="absolute bottom-full mb-2 left-0 bg-white dark:bg-dark-800 rounded-xl shadow-soft-lg border border-gray-200 dark:border-dark-700 p-2 animate-slide-up">
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
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
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
            disabled={(!message.trim() && files.length === 0) || uploading}
            className={`ml-2 p-2.5 rounded-full focus:outline-none ${
              (!message.trim() && files.length === 0) || uploading
                ? 'bg-gray-300 dark:bg-dark-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700 dark:bg-secondary-600 dark:hover:bg-secondary-700 text-white shadow-soft transition-colors'
            }`}
          >
            {uploading ? (
              <div className="h-5 w-5 border-2 border-t-transparent border-white rounded-full animate-spin" />
            ) : (
              <PaperAirplaneIcon className="h-5 w-5 transform rotate-90" />
            )}
          </button>
          
          {/* Hidden file input */}
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