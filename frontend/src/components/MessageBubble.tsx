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
        <div className="mb-1 rounded-lg overflow-hidden">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-w-xs max-h-60 object-contain"
            loading="lazy"
          />
          <div className="text-xs text-gray-500 mt-1">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'video') {
      return (
        <div className="mb-1 rounded-lg overflow-hidden">
          <video
            src={attachment.url}
            controls
            className="max-w-xs max-h-60"
          />
          <div className="text-xs text-gray-500 mt-1">
            {attachment.name} ({formatFileSize(attachment.size)})
          </div>
        </div>
      );
    } else if (attachment.type === 'audio') {
      return (
        <div className="mb-1">
          <audio src={attachment.url} controls className="max-w-xs" />
          <div className="text-xs text-gray-500 mt-1">
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
          className="flex items-center p-2 bg-gray-100 rounded-md mb-1 hover:bg-gray-200"
        >
          <svg 
            className="h-6 w-6 mr-2 text-gray-500" 
            xmlns="http://www.w3.org/2000/svg" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
            />
          </svg>
          <span className="text-sm text-blue-600">{attachment.name}</span>
          <span className="ml-2 text-xs text-gray-500">({formatFileSize(attachment.size)})</span>
        </a>
      );
    }
  };

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-md rounded-lg px-4 py-2 ${
          isOwn
            ? 'bg-primary-600 text-white rounded-br-none'
            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'
        }`}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2">
            {message.attachments.map((attachment, index) => (
              <React.Fragment key={`${message.id}-attachment-${index}`}>
                {renderAttachment(attachment, index)}
              </React.Fragment>
            ))}
          </div>
        )}
        
        {message.text && <p className="whitespace-pre-wrap">{message.text}</p>}
        
        <div className={`flex items-center justify-end mt-1 text-xs ${isOwn ? 'text-primary-200' : 'text-gray-500'}`}>
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
                <div className="flex text-blue-500">
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