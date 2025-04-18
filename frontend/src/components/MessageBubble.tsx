import React, { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { CheckIcon, PencilIcon, TrashIcon, FaceSmileIcon, ArrowUturnLeftIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

interface Attachment {
  type: string;
  url: string;
  name: string;
  size: number;
}

interface Reaction {
  userId: string;
  reaction: string;
  timestamp: string;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string | number;
  status: 'sent' | 'delivered' | 'read';
  attachments?: Attachment[];
  reactions?: Reaction[];
  replyTo?: string;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  deletedAt?: string;
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  contactId: string;
}

// Common emojis for reactions
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn, contactId }) => {
  const { user } = useAuthStore();
  const { contacts } = useContactsStore();
  const { addReaction, removeReaction, editMessage, deleteMessage, sendReply, conversations } = useChatStore();
  
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [replyMode, setReplyMode] = useState(false);
  const [replyText, setReplyText] = useState('');
  
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  
  // Find reply message if this is a reply
  const replyToMessage = message.replyTo 
    ? conversations[contactId]?.messages.find(m => m.id === message.replyTo)
    : undefined;
  
  // Find contact information for sender
  const contact = contacts.find(c => c.contact_id === message.senderId);
  
  // Get username for display
  const senderName = isOwn 
    ? 'You' 
    : (contact?.contact_display_name || 'Unknown');
  
  // Handle outside click for menus
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setShowContextMenu(false);
      }
      
      if (showReactionPicker && !messageRef.current?.contains(event.target as Node)) {
        setShowReactionPicker(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContextMenu, showReactionPicker]);
  
  // Auto focus input when editing
  useEffect(() => {
    if (isEditing && textInputRef.current) {
      textInputRef.current.focus();
      textInputRef.current.setSelectionRange(editText.length, editText.length);
    }
    
    if (replyMode && replyInputRef.current) {
      replyInputRef.current.focus();
    }
  }, [isEditing, replyMode, editText]);
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const renderAttachment = (attachment: Attachment, index: number): React.ReactNode => {
    if (message.isDeleted) return null;
    
    if (attachment.type === 'image') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-soft-md">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-w-xs max-h-60 object-contain"
            loading="lazy"
          />
          <div className="text-xs px-2 py-1 bg-gray-50 dark:bg-dark-800 text-gray-500 dark:text-gray-400">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'video') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-soft-md">
          <video
            src={attachment.url}
            controls
            className="max-w-xs max-h-60"
          />
          <div className="text-xs px-2 py-1 bg-gray-50 dark:bg-dark-800 text-gray-500 dark:text-gray-400">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'audio') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-soft-md bg-gray-50 dark:bg-dark-800 p-2">
          <audio src={attachment.url} controls className="max-w-xs" />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else {
      // Default file attachment
      return (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center p-3 bg-gray-50 dark:bg-dark-800 rounded-xl mb-2 hover:bg-gray-100 dark:hover:bg-dark-700 shadow-soft transition-colors group"
        >
          <svg 
            className="h-8 w-8 mr-3 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 dark:group-hover:text-secondary-400 transition-colors" 
            xmlns="http://www.w3.org/2000/svg" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
            />
          </svg>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-primary-600 dark:text-secondary-400 truncate block">{attachment.name}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(attachment.size)}</span>
          </div>
        </a>
      );
    }
  };
  
  // Handle reaction click
  const handleReaction = (emoji: string) => {
    if (!user) return;
    
    // Check if user already reacted with this emoji
    const existingReaction = message.reactions?.find(r => 
      r.userId === user.id && r.reaction === emoji
    );
    
    if (existingReaction) {
      // Remove reaction
      removeReaction(message.id, contactId, emoji)
        .catch(() => toast.error('Failed to remove reaction'));
    } else {
      // Add reaction
      addReaction(message.id, contactId, emoji)
        .catch(() => toast.error('Failed to add reaction'));
    }
    
    setShowReactionPicker(false);
  };
  
  // Group reactions by emoji
  const groupedReactions = React.useMemo(() => {
    if (!message.reactions || message.reactions.length === 0) return {};
    
    return message.reactions.reduce((acc, reaction) => {
      if (!acc[reaction.reaction]) {
        acc[reaction.reaction] = [];
      }
      acc[reaction.reaction].push(reaction.userId);
      return acc;
    }, {} as Record<string, string[]>);
  }, [message.reactions]);
  
  // Handle edit submission
  const handleEditSubmit = () => {
    if (editText.trim() === '') return;
    
    editMessage(message.id, contactId, editText.trim())
      .then(() => {
        setIsEditing(false);
        toast.success('Message updated');
      })
      .catch(() => toast.error('Failed to update message'));
  };
  
  // Handle delete message
  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      deleteMessage(message.id, contactId)
        .then(() => toast.success('Message deleted'))
        .catch(() => toast.error('Failed to delete message'));
    }
    setShowContextMenu(false);
  };
  
  // Handle reply submission
  const handleReplySubmit = () => {
    if (replyText.trim() === '') return;
    
    sendReply(contactId, replyText.trim(), message.id, [])
      .then(() => {
        setReplyMode(false);
        setReplyText('');
        toast.success('Reply sent');
      })
      .catch(() => toast.error('Failed to send reply'));
  };
  
  // Format timestamp
  const formattedTimestamp = (() => {
    try {
      // Check if timestamp is valid
      if (!message.timestamp) return '';
      
      // Parse the timestamp correctly - handle both string and number formats
      const date = typeof message.timestamp === 'string' 
        ? new Date(message.timestamp) 
        : new Date(Number(message.timestamp));
      
      // Validate the date is valid
      if (isNaN(date.getTime())) return '';
      
      return format(date, 'p');
    } catch (error) {
      console.error('Error formatting message timestamp:', error, message);
      return '';
    }
  })();

  return (
    <div className={`flex mb-3 animate-slide-up ${isOwn ? 'justify-end' : 'justify-start'}`} ref={messageRef}>
      <div className="relative group">
        {!isOwn && (
          <div className="absolute -left-10 -top-1">
            <img 
              src={contact?.contact_avatar_url || 'https://via.placeholder.com/40'} 
              alt={senderName}
              className="h-8 w-8 rounded-full object-cover"
            />
          </div>
        )}
        
        {/* Main message bubble */}
        <div
          className={`max-w-md relative ${
            isOwn
              ? 'bg-primary-600 dark:bg-primary-700 text-white rounded-2xl rounded-br-none shadow-soft-md'
              : 'bg-white dark:bg-dark-800 text-gray-800 dark:text-gray-200 rounded-2xl rounded-bl-none shadow-soft'
          }`}
        >
          {/* Context menu trigger */}
          <button 
            onClick={() => setShowContextMenu(!showContextMenu)}
            className={`absolute top-1 right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${
              isOwn ? 'text-primary-200 hover:text-white hover:bg-primary-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-dark-700'
            }`}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
          
          {/* Context menu */}
          {showContextMenu && (
            <div 
              ref={contextMenuRef}
              className="absolute right-0 top-8 z-10 w-40 bg-white dark:bg-dark-800 rounded-md shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none"
            >
              <div className="py-1">
                <button
                  onClick={() => {
                    setShowReactionPicker(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                >
                  <FaceSmileIcon className="h-4 w-4 mr-2" />
                  React
                </button>
                <button
                  onClick={() => {
                    setReplyMode(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4 mr-2" />
                  Reply
                </button>
                {isOwn && !message.isDeleted && (
                  <>
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setShowContextMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                    >
                      <PencilIcon className="h-4 w-4 mr-2" />
                      Edit
                    </button>
                    <button
                      onClick={handleDelete}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                    >
                      <TrashIcon className="h-4 w-4 mr-2" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          
          {/* Reaction picker */}
          {showReactionPicker && (
            <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-white dark:bg-dark-800 rounded-full shadow-lg p-1 flex z-10">
              {REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-dark-700 rounded-full text-lg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          
          {/* Reply reference */}
          {replyToMessage && (
            <div 
              className={`mx-4 mt-3 pt-2 px-3 pb-1 border-l-2 rounded-sm text-xs ${
                isOwn 
                  ? 'border-primary-300 dark:border-primary-300 bg-primary-700 dark:bg-primary-800'
                  : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-700'
              }`}
            >
              <div className={`font-medium ${isOwn ? 'text-primary-200' : 'text-gray-500 dark:text-gray-400'}`}>
                {replyToMessage.senderId === user?.id ? 'You' : contact?.contact_display_name || 'Unknown'}
              </div>
              <p className={`truncate ${isOwn ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                {replyToMessage.isDeleted ? 'This message was deleted' : replyToMessage.text}
              </p>
            </div>
          )}
          
          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && !message.isDeleted && (
            <div className="p-2">
              {message.attachments.map((attachment, index) => (
                <React.Fragment key={`${message.id}-attachment-${index}`}>
                  {renderAttachment(attachment, index)}
                </React.Fragment>
              ))}
            </div>
          )}
          
          {/* Message text or edit form */}
          {isEditing ? (
            <div className="p-3">
              <textarea
                ref={textInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full p-2 border rounded-md bg-white dark:bg-dark-700 text-gray-800 dark:text-gray-200 focus:ring-primary-500 dark:focus:ring-secondary-500 resize-none"
                rows={2}
              />
              <div className="flex justify-end mt-2 space-x-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-dark-700 rounded-md hover:bg-gray-200 dark:hover:bg-dark-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSubmit}
                  className="px-3 py-1 text-xs text-white bg-primary-600 dark:bg-secondary-600 rounded-md hover:bg-primary-700 dark:hover:bg-secondary-700"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            message.text && (
              <div className={`px-4 py-2.5 ${message.attachments && message.attachments.length > 0 ? 'pt-0' : ''}`}>
                {message.isDeleted ? (
                  <p className="text-sm italic opacity-60">This message was deleted</p>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                )}
                {message.isEdited && !message.isDeleted && (
                  <span className={`text-xs ${isOwn ? 'text-primary-200' : 'text-gray-400 dark:text-gray-500'}`}>
                    (edited)
                  </span>
                )}
              </div>
            )
          )}
          
          {/* Message footer: timestamp and status */}
          <div 
            className={`flex items-center justify-end px-4 pb-1.5 text-xs 
              ${isOwn 
                ? 'text-primary-200 dark:text-primary-300' 
                : 'text-gray-400 dark:text-gray-500'
              }`
            }
          >
            <span>{formattedTimestamp}</span>
            
            {isOwn && (
              <div className="ml-1 flex">
                {message.status === 'sent' && (
                  <CheckIcon className="h-3 w-3" />
                )}
                {message.status === 'delivered' && (
                  <div className="flex">
                    <CheckIcon className="h-3 w-3" />
                    <CheckIcon className="h-3 w-3 -ml-1" />
                  </div>
                )}
                {message.status === 'read' && (
                  <div className="flex text-blue-400">
                    <CheckIcon className="h-3 w-3" />
                    <CheckIcon className="h-3 w-3 -ml-1" />
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Reactions display */}
          {message.reactions && message.reactions.length > 0 && (
            <div className={`flex -bottom-3 px-1 rounded-full text-xs absolute ${
              isOwn ? 'left-0' : 'right-0'
            }`}>
              {Object.entries(groupedReactions).map(([emoji, userIds]) => (
                <div 
                  key={emoji}
                  className={`flex items-center rounded-full px-1.5 py-0.5 mr-1 cursor-pointer
                    ${isOwn
                      ? 'bg-primary-700 text-white hover:bg-primary-800' 
                      : 'bg-white dark:bg-dark-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-dark-600 hover:bg-gray-100 dark:hover:bg-dark-700'
                    }
                    ${userIds.includes(user?.id || '') ? 'ring-1 ring-blue-400' : ''}
                  `}
                  onClick={() => handleReaction(emoji)}
                >
                  <span className="mr-1">{emoji}</span>
                  <span>{userIds.length}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Reply form */}
        {replyMode && (
          <div className={`mt-2 p-2 rounded-xl ${isOwn ? 'bg-primary-50 dark:bg-dark-800' : 'bg-gray-50 dark:bg-dark-700'}`}>
            <textarea
              ref={replyInputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your reply..."
              className="w-full p-2 border rounded-md bg-white dark:bg-dark-700 text-gray-800 dark:text-gray-200 focus:ring-primary-500 dark:focus:ring-secondary-500 resize-none"
              rows={2}
            />
            <div className="flex justify-end mt-2 space-x-2">
              <button
                onClick={() => setReplyMode(false)}
                className="px-3 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-dark-700 rounded-md hover:bg-gray-200 dark:hover:bg-dark-600"
              >
                Cancel
              </button>
              <button
                onClick={handleReplySubmit}
                className="px-3 py-1 text-xs text-white bg-primary-600 dark:bg-secondary-600 rounded-md hover:bg-primary-700 dark:hover:bg-secondary-700"
              >
                Reply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBubble; 