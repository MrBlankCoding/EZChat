import React, { useState, useRef, useEffect } from 'react';
import { CheckIcon, PencilIcon, TrashIcon, ArrowUturnLeftIcon, EllipsisHorizontalIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { formatMessageTime } from '../utils/dateUtils';
import { generateAvatarUrl } from '../utils/avatarUtils';
import { Message, Attachment } from '../types';
import AttachmentDisplay from './AttachmentDisplay';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  contactId: string;
  onStartEdit: (message: Message) => void;
  onStartReply: (message: Message) => void;
}

const MessageBubble = React.forwardRef<HTMLDivElement, MessageBubbleProps>(({ message, isOwn, contactId, onStartEdit, onStartReply }, ref) => {
  const { user } = useAuthStore();
  const { contacts } = useContactsStore();
  const { deleteMessage, conversations } = useChatStore();
  
  const [showContextMenu, setShowContextMenu] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
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
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showContextMenu]);
  
  const formatFileSize = (bytes: number | undefined): string => {
    if (bytes === undefined) return 'Unknown size';
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const renderAttachment = (attachment: Attachment): React.ReactNode => {
    if (message.isDeleted) return null;
    
    return <AttachmentDisplay attachment={attachment} messageId={message.id} />;
  };
  
  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this message?')) {
      deleteMessage(message.id, contactId)
        .then(() => toast.success('Message deleted'))
        .catch(() => toast.error('Failed to delete message'));
    }
    setShowContextMenu(false);
  };

  const handleEditClick = () => {
    onStartEdit(message);
    setShowContextMenu(false);
  };

  const handleReplyClick = () => {
    onStartReply(message);
    setShowContextMenu(false);
  };

  const getMessageClass = () => {
    // Own messages: Blue if unread/sent, Purple if read.
    // Other messages: Grey.
    const baseClasses = "relative break-words rounded-2xl shadow-sm transition-colors duration-200 ease-in-out max-w-full"; // Adjusted transition
    
    let ownClasses = "bg-blue-500 text-white rounded-br-lg"; // Default blue for own messages
    if (isOwn && message.status === 'read') {
      ownClasses = "bg-purple-600 text-white rounded-br-lg"; // Purple if read
    }

    const otherClasses = "bg-gray-100 dark:bg-dark-700 text-gray-800 dark:text-gray-100 rounded-bl-lg";
    
    return `${baseClasses} ${isOwn ? ownClasses : otherClasses}`;
  }

  const getContextButtonClass = () => {
    let base = "bg-black/5 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10";
    let text = "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300";
    
    if (isOwn) {
      base = "bg-white/10 hover:bg-white/20";
      text = "text-white/60 hover:text-white/90";
    }
    return `${text} ${base}`;
  }

  const getFooterClass = () => {
    return isOwn 
      ? "text-white/70" 
      : "text-gray-400 dark:text-gray-500";
  }

  return (
    <div
      ref={ref}
      data-message-id={message.id}
      data-sender-id={message.senderId}
      className={`group/msg relative w-full ${isOwn ? 'flex justify-end' : ''}`}
    >
      <div className={`flex items-end ${isOwn ? 'flex-row-reverse' : 'flex-row'} max-w-[75%] md:max-w-[70%] lg:max-w-[65%]`}>
        <div className={`relative group/bubble`}>
          <div className={`px-3 py-2 ${getMessageClass()}`}>
            {/* Reply Context - Enhanced UI */}
            {replyToMessage && (
              <div 
                className={`mb-2 p-2 rounded-md border-l-2 flex items-start space-x-2 \
                  ${isOwn 
                    ? 'bg-white/15 border-white/30' 
                    : 'bg-black/5 dark:bg-white/5 border-gray-400 dark:border-gray-500' 
                  }`}
              >
                <ArrowUturnLeftIcon 
                  className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${isOwn ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}
                />
                <div className="flex-1 min-w-0 text-xs">
                  <div className={`font-medium mb-0.5 ${isOwn ? 'text-white/90' : 'text-gray-700 dark:text-gray-200'}`}>
                    {replyToMessage.senderId === user?.id ? 'You' : contacts.find(c => c.contact_id === replyToMessage.senderId)?.contact_display_name || 'Unknown'}
                  </div>
                  <p className={`whitespace-nowrap overflow-hidden text-ellipsis ${isOwn ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                    {replyToMessage.isDeleted 
                      ? <span className="italic">Original message deleted</span> 
                      : replyToMessage.text 
                        ? replyToMessage.text 
                        : (replyToMessage.attachments && replyToMessage.attachments.length > 0 
                          ? `Attachment${replyToMessage.attachments.length > 1 ? 's' : ''} (${replyToMessage.attachments.length})` 
                          : 'Empty message')
                    }
                  </p>
                </div>
              </div>
            )}
            
            {message.attachments && message.attachments.length > 0 && (
              <div className={`my-1.5 grid gap-1.5`}>
                {message.attachments.map((att, index) => (
                  <div key={att.id || index}>{renderAttachment(att)}</div>
                ))}
              </div>
            )}
            
            {message.isDeleted ? (
              <span className="italic text-sm opacity-70">Message deleted</span>
            ) : message.text && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
            )}
            
            {!message.isDeleted && (
              <div className={`text-right mt-1 text-[10px] ${isOwn ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'} space-x-1`}>
                {message.isEdited && <span className="italic opacity-80">edited</span>}
              </div>
            )}
          </div>
          
          {!message.isDeleted && (
            <div className={`absolute ${isOwn ? 'left-0 -translate-x-full ml-[-4px]' : 'right-0 translate-x-full mr-[-4px]'} bottom-1 transition-opacity duration-150 opacity-0 group-hover/bubble:opacity-100`}>
              <button
                onClick={() => setShowContextMenu(!showContextMenu)}
                className={`p-1.5 rounded-full ${getContextButtonClass()} focus:outline-none shadow-sm`}>
                <EllipsisHorizontalIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          
          {showContextMenu && (
            <div
              ref={contextMenuRef}
              className={`absolute z-20 w-36 rounded-lg shadow-xl bg-white dark:bg-dark-700 ring-1 ring-black/5 dark:ring-white/10 focus:outline-none py-1 ${isOwn ? 'right-full mr-2' : 'left-full ml-2'} bottom-0 mb-1 animate-fade-in-fast`}>
              <MenuItem icon={ArrowUturnLeftIcon} onClick={handleReplyClick}>Reply</MenuItem>
              {isOwn && <MenuItem icon={PencilIcon} onClick={handleEditClick}>Edit</MenuItem>}
              {isOwn && <MenuItem icon={TrashIcon} onClick={handleDelete}>Delete</MenuItem>}
            </div>
          )}
        </div>
      </div>
      
      {!message.isDeleted && (
        <div 
          className={`absolute -bottom-4 text-[10px] text-gray-400 dark:text-gray-500 transition-opacity duration-150 opacity-0 group-hover/msg:opacity-100 \
                     ${isOwn ? 'right-0' : 'left-0'}`}
        >
          {formattedTimestamp}
        </div>
      )}
    </div>
  );
});

const MenuItem: React.FC<{icon: React.ElementType, onClick: () => void, children: React.ReactNode}> = ({ icon: Icon, onClick, children }) => (
  <button
    onClick={onClick}
    className="flex items-center w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-600 hover:text-gray-900 dark:hover:text-gray-100 transition-colors duration-100"
  >
    <Icon className="mr-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true" />
    {children}
  </button>
);

export default MessageBubble;