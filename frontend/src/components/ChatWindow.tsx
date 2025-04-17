import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { PaperAirplaneIcon, PaperClipIcon, FaceSmileIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import websocketService from '../services/websocketService';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebaseConfig';
import MessageBubble from './MessageBubble';

interface ChatWindowProps {
  contactId: string;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ contactId }) => {
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  
  const { user } = useAuthStore();
  const { contacts, conversations } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const contact = contacts[contactId];
  const conversation = conversations[contactId];
  const messages = conversation?.messages || [];
  
  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
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
      setFiles(fileArray);
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
    
    if ((!message && files.length === 0) || !user || uploading) return;
    
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
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };
  
  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Contact not found</p>
      </div>
    );
  }
  
  return (
    <div className="flex-1 flex flex-col">
      {/* Chat header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center">
        <div className="flex-shrink-0 relative">
          <img
            className="h-10 w-10 rounded-full object-cover"
            src={contact.photoURL || 'https://via.placeholder.com/150'}
            alt={contact.displayName}
          />
          <div
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
              contact.status === 'online'
                ? 'bg-green-500'
                : contact.status === 'away'
                ? 'bg-yellow-500'
                : 'bg-gray-500'
            }`}
          ></div>
        </div>
        <div className="ml-3">
          <h2 className="text-lg font-medium text-gray-900">{contact.displayName}</h2>
          <p className="text-sm text-gray-500">
            {contact.isTyping
              ? 'Typing...'
              : contact.status === 'online'
              ? 'Online'
              : contact.status === 'away'
              ? 'Away'
              : contact.lastSeen
              ? `Last seen ${format(new Date(contact.lastSeen), 'PPp')}`
              : 'Offline'}
          </p>
        </div>
      </div>
      
      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto bg-gray-50">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-500">No messages yet. Start a conversation!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.senderId === user?.id}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      
      {/* Message input */}
      <div className="bg-white border-t border-gray-200 p-4">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((file, index) => (
              <div
                key={index}
                className="bg-gray-100 rounded-md p-2 flex items-center text-sm"
              >
                <span className="truncate max-w-xs">{file.name}</span>
                <button
                  type="button"
                  className="ml-2 text-gray-500 hover:text-gray-700"
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        
        <form onSubmit={handleSendMessage} className="flex items-center">
          <button
            type="button"
            className="p-2 rounded-full text-gray-500 hover:text-gray-700 focus:outline-none"
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperClipIcon className="h-5 w-5" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={handleFileSelect}
          />
          
          <input
            type="text"
            className="flex-1 border-0 focus:ring-0 focus:outline-none"
            placeholder="Type a message..."
            value={message}
            onChange={handleMessageChange}
          />
          
          <button
            type="button"
            className="p-2 rounded-full text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            <FaceSmileIcon className="h-5 w-5" />
          </button>
          
          <button
            type="submit"
            disabled={(!message && files.length === 0) || uploading}
            className={`ml-2 p-2 rounded-full ${
              (!message && files.length === 0) || uploading
                ? 'bg-gray-300 text-gray-500'
                : 'bg-primary-600 text-white hover:bg-primary-700'
            } focus:outline-none`}
          >
            {uploading ? (
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <PaperAirplaneIcon className="h-5 w-5 rotate-90" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatWindow; 