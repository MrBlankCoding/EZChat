import React, { useState, useRef, useEffect } from 'react';
import { CheckIcon, PencilIcon, TrashIcon, FaceSmileIcon, ArrowUturnLeftIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { formatMessageTime } from '../utils/dateUtils';
import { generateAvatarUrl } from '../utils/avatarUtils';

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
  
  const replyToMessage = message.replyTo 
    ? conversations[contactId]?.messages.find(m => m.id === message.replyTo)
    : undefined;
  
  const contact = contacts.find(c => c.contact_id === message.senderId);
  const senderName = isOwn ? 'You' : (contact?.contact_display_name || 'Unknown');
  const formattedTimestamp = message.timestamp ? formatMessageTime(message.timestamp) : '';
  
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

  const renderAttachment = (attachment: Attachment): React.ReactNode => {
    if (message.isDeleted) return null;
    
    if (attachment.type === 'image') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-md group">
          <div className="relative">
            <img
              src={attachment.url}
              alt={attachment.name}
              className="max-w-xs max-h-60 object-contain w-full transition-transform group-hover:scale-[0.98]"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 transition-opacity" />
          </div>
          <div className="text-xs px-3 py-1.5 bg-gray-50 dark:bg-dark-800 text-gray-500 dark:text-gray-400 font-medium truncate">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'video') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-md">
          <video
            src={attachment.url}
            controls
            className="max-w-xs max-h-60 w-full"
          />
          <div className="text-xs px-3 py-1.5 bg-gray-50 dark:bg-dark-800 text-gray-500 dark:text-gray-400 font-medium truncate">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'audio') {
      return (
        <div className="mb-2 rounded-xl overflow-hidden shadow-md bg-gray-50 dark:bg-dark-800 p-3">
          <audio src={attachment.url} controls className="max-w-xs w-full" />
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-medium">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else {
      return (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center p-3 bg-gray-50 dark:bg-dark-800 rounded-xl mb-2 hover:bg-gray-100 dark:hover:bg-dark-700 shadow-md transition-all group border border-transparent hover:border-gray-200 dark:hover:border-dark-600"
        >
          <div className="h-12 w-12 mr-3 rounded-lg bg-gray-100 dark:bg-dark-700 flex items-center justify-center">
            <svg 
              className="h-6 w-6 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 dark:group-hover:text-secondary-400 transition-colors" 
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
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-primary-600 dark:text-secondary-400 truncate block">{attachment.name}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(attachment.size)}</span>
          </div>
          <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <svg className="h-5 w-5 text-gray-400 group-hover:text-primary-500 dark:group-hover:text-secondary-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
        </a>
      );
    }
  };
  
  const handleReaction = (emoji: string) => {
    if (!user) return;
    
    const existingReaction = message.reactions?.find(r => 
      r.userId === user.id && r.reaction === emoji
    );
    
    if (existingReaction) {
      removeReaction(message.id, contactId, emoji)
        .catch(() => toast.error('Failed to remove reaction'));
    } else {
      addReaction(message.id, contactId, emoji)
        .catch(() => toast.error('Failed to add reaction'));
    }
    
    setShowReactionPicker(false);
  };
  
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
  
  const handleEditSubmit = () => {
    if (editText.trim() === '') return;
    
    editMessage(message.id, contactId, editText.trim())
      .then(() => {
        setIsEditing(false);
        toast.success('Message updated');
      })
      .catch(() => toast.error('Failed to update message'));
  };
  
  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      deleteMessage(message.id, contactId)
        .then(() => toast.success('Message deleted'))
        .catch(() => toast.error('Failed to delete message'));
    }
    setShowContextMenu(false);
  };
  
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

  const getMessageClass = () => {
    const baseClasses = "relative rounded-2xl shadow-md transition-all";
    const ownClasses = "bg-gradient-to-br from-primary-500 to-primary-600 dark:from-primary-600 dark:to-primary-700 text-white rounded-br-md";
    const otherClasses = "bg-white dark:bg-dark-800 text-gray-800 dark:text-gray-200 rounded-bl-md border border-gray-100 dark:border-dark-700";
    
    return `${baseClasses} ${isOwn ? ownClasses : otherClasses}`;
  }

  const getContextButtonClass = () => {
    return isOwn 
      ? "text-white/70 hover:text-white bg-primary-700/30 hover:bg-primary-700/50" 
      : "text-gray-400 hover:text-gray-600 bg-gray-100/70 hover:bg-gray-200/70 dark:bg-dark-700/50 dark:hover:bg-dark-600/70";
  }

  const getFooterClass = () => {
    return isOwn 
      ? "text-white/70" 
      : "text-gray-400 dark:text-gray-500";
  }

  const getReactionBtnClass = (userIds: string[]) => {
    const baseClass = "flex items-center rounded-full px-2 py-1 mr-1.5 cursor-pointer transition-all transform hover:scale-105";
    const ownClass = userIds.includes(user?.id || '') 
      ? "bg-primary-700/80 text-white shadow-md" 
      : "bg-primary-700/40 text-white hover:bg-primary-700/60";
    const otherClass = userIds.includes(user?.id || '') 
      ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 shadow-md" 
      : "bg-white dark:bg-dark-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-dark-600 hover:bg-gray-50 dark:hover:bg-dark-700/70";
    
    return `${baseClass} ${isOwn ? ownClass : otherClass}`;
  }

  const renderMessageStatus = () => {
    if (!isOwn) return null;
    
    if (message.status === 'sent') {
      return <CheckIcon className="h-3.5 w-3.5" />;
    } else if (message.status === 'delivered') {
      return (
        <div className="flex">
          <CheckIcon className="h-3.5 w-3.5" />
          <CheckIcon className="h-3.5 w-3.5 -ml-1.5" />
        </div>
      );
    } else if (message.status === 'read') {
      return (
        <div className="flex text-blue-400">
          <CheckIcon className="h-3.5 w-3.5" />
          <CheckIcon className="h-3.5 w-3.5 -ml-1.5" />
        </div>
      );
    }
    
    return null;
  };

  return (
    <div 
      className={`flex mb-4 animate-fade-in ${isOwn ? 'justify-end' : 'justify-start'} group/msg`} 
      ref={messageRef}
    >
      <div className="relative max-w-md">
        {!isOwn && (
          <div className="absolute -left-12 top-0">
            <div className="relative">
              <img 
                src={contact?.contact_avatar_url || generateAvatarUrl(contact?.contact_display_name || '', 40)} 
                alt={senderName}
                className="h-8 w-8 rounded-full object-cover shadow-md ring-2 ring-white dark:ring-dark-900"
              />
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 ring-2 ring-white dark:ring-dark-900"></div>
            </div>
          </div>
        )}
        
        <div className={getMessageClass()}>
          <button 
            onClick={() => setShowContextMenu(!showContextMenu)}
            className={`absolute top-2 right-2 p-1.5 rounded-full opacity-0 group-hover/msg:opacity-100 transition-opacity ${getContextButtonClass()}`}
          >
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </button>
          
          {showContextMenu && (
            <div 
              ref={contextMenuRef}
              className="absolute right-0 top-10 z-10 w-44 bg-white dark:bg-dark-800 rounded-lg shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none overflow-hidden"
            >
              <div className="py-1">
                <button
                  onClick={() => {
                    setShowReactionPicker(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                >
                  <FaceSmileIcon className="h-4 w-4 mr-2.5 text-gray-500 dark:text-gray-400" />
                  React
                </button>
                <button
                  onClick={() => {
                    setReplyMode(true);
                    setShowContextMenu(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                >
                  <ArrowUturnLeftIcon className="h-4 w-4 mr-2.5 text-gray-500 dark:text-gray-400" />
                  Reply
                </button>
                {isOwn && !message.isDeleted && (
                  <>
                    <div className="border-t border-gray-200 dark:border-dark-600 my-1"></div>
                    <button
                      onClick={() => {
                        setIsEditing(true);
                        setShowContextMenu(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-700 flex items-center"
                    >
                      <PencilIcon className="h-4 w-4 mr-2.5 text-gray-500 dark:text-gray-400" />
                      Edit
                    </button>
                    <button
                      onClick={handleDelete}
                      className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center"
                    >
                      <TrashIcon className="h-4 w-4 mr-2.5" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          
          {showReactionPicker && (
            <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-white dark:bg-dark-800 rounded-full shadow-lg p-1.5 flex z-10 border border-gray-100 dark:border-dark-700">
              {REACTIONS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-dark-700 rounded-full text-lg transition-transform hover:scale-110"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          
          {replyToMessage && (
            <div className={`mx-4 mt-3 pt-2 px-3 pb-1.5 border-l-2 rounded-sm text-xs ${
              isOwn 
                ? 'border-primary-300/70 dark:border-primary-300/50 bg-primary-700/30 dark:bg-primary-800/30'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-700/50'
            }`}>
              <div className={`font-medium ${isOwn ? 'text-white/90' : 'text-gray-600 dark:text-gray-300'}`}>
                {replyToMessage.senderId === user?.id ? 'You' : contact?.contact_display_name || 'Unknown'}
              </div>
              <p className={`truncate ${isOwn ? 'text-white/80' : 'text-gray-600 dark:text-gray-300'}`}>
                {replyToMessage.isDeleted ? 'This message was deleted' : replyToMessage.text}
              </p>
            </div>
          )}
          
          {message.attachments && message.attachments.length > 0 && !message.isDeleted && (
            <div className="p-3">
              {message.attachments.map((attachment, index) => (
                <React.Fragment key={`${message.id}-attachment-${index}`}>
                  {renderAttachment(attachment)}
                </React.Fragment>
              ))}
            </div>
          )}
          
          {isEditing ? (
            <div className="p-4">
              <textarea
                ref={textInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full p-3 border rounded-lg bg-white dark:bg-dark-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-transparent resize-none shadow-inner"
                rows={2}
              />
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-dark-700 rounded-md hover:bg-gray-200 dark:hover:bg-dark-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSubmit}
                  className="px-4 py-1.5 text-sm text-white bg-primary-600 dark:bg-secondary-600 rounded-md hover:bg-primary-700 dark:hover:bg-secondary-700 transition-colors shadow-sm"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            message.text && (
              <div className={`px-4 py-3 ${message.attachments && message.attachments.length > 0 ? 'pt-0' : ''}`}>
                {message.isDeleted ? (
                  <p className="text-sm italic opacity-60 flex items-center">
                    <TrashIcon className="h-3.5 w-3.5 mr-1 opacity-70" />
                    This message was deleted
                  </p>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
                )}
                {message.isEdited && !message.isDeleted && (
                  <span className={`text-xs ml-1 ${isOwn ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>
                    (edited)
                  </span>
                )}
              </div>
            )
          )}
        </div>
        
        {message.reactions && message.reactions.length > 0 && (
          <div className={`flex -bottom-4 px-1 rounded-full text-xs absolute ${isOwn ? 'left-1' : 'right-1'}`}>
            {Object.entries(groupedReactions).map(([emoji, userIds]) => (
              <div 
                key={emoji}
                className={getReactionBtnClass(userIds)}
                onClick={() => handleReaction(emoji)}
              >
                <span className="mr-1">{emoji}</span>
                <span className="font-medium">{userIds.length}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Timestamp moved outside bubble */}
      <div className={`text-xs mt-1 ${isOwn ? 'text-right' : 'text-left'} opacity-0 group-hover/msg:opacity-100 transition-opacity ${getFooterClass()}`}>
        <span className="font-medium">{formattedTimestamp}</span>
        
        {isOwn && (
          <span className="ml-1.5 inline-flex">
            {renderMessageStatus()}
          </span>
        )}
      </div>
      
      {replyMode && (
        <div className={`mt-3 p-3 rounded-xl bg-white dark:bg-dark-800 shadow-md border ${isOwn ? 'border-primary-100 dark:border-primary-900/30' : 'border-gray-100 dark:border-dark-700'}`}>
          <textarea
            ref={replyInputRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your reply..."
            className="w-full p-3 border rounded-lg bg-white dark:bg-dark-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-primary-500 dark:focus:ring-secondary-500 focus:border-transparent resize-none shadow-inner"
            rows={2}
          />
          <div className="flex justify-end mt-3 space-x-2">
            <button
              onClick={() => setReplyMode(false)}
              className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-dark-700 rounded-md hover:bg-gray-200 dark:hover:bg-dark-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleReplySubmit}
              className="px-4 py-1.5 text-sm text-white bg-primary-600 dark:bg-secondary-600 rounded-md hover:bg-primary-700 dark:hover:bg-secondary-700 transition-colors shadow-sm"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageBubble;