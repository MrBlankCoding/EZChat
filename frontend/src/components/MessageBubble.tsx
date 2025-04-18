import React from 'react';
import { format } from 'date-fns';
import { CheckIcon } from '@heroicons/react/24/outline';

interface Attachment {
  type: string;
  url: string;
  name: string;
  size: number;
}

interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: string | number;
  status: 'sent' | 'delivered' | 'read';
  attachments?: Attachment[];
}

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwn }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  const renderAttachment = (attachment: Attachment, index: number): React.ReactNode => {
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

  return (
    <div className={`flex mb-3 animate-slide-up ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-md ${
          isOwn
            ? 'bg-primary-600 dark:bg-primary-700 text-white rounded-2xl rounded-br-none shadow-soft-md'
            : 'bg-white dark:bg-dark-800 text-gray-800 dark:text-gray-200 rounded-2xl rounded-bl-none shadow-soft'
        }`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="p-2">
            {message.attachments.map((attachment, index) => (
              <React.Fragment key={`${message.id}-attachment-${index}`}>
                {renderAttachment(attachment, index)}
              </React.Fragment>
            ))}
          </div>
        )}
        
        {message.text && (
          <div className={`px-4 py-2.5 ${message.attachments && message.attachments.length > 0 ? 'pt-0' : ''}`}>
            <p className="whitespace-pre-wrap text-sm">{message.text}</p>
          </div>
        )}
        
        <div 
          className={`flex items-center justify-end px-4 pb-1.5 text-xs 
            ${isOwn 
              ? 'text-primary-200 dark:text-primary-300' 
              : 'text-gray-400 dark:text-gray-500'
            }`
          }
        >
          <span>
            {(() => {
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
            })()}
          </span>
          
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
      </div>
    </div>
  );
};

export default MessageBubble; 