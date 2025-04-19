import React from 'react';
import { Attachment } from '../types';

interface AttachmentDisplayProps {
  attachment: Attachment;
  className?: string;
}

export const AttachmentDisplay: React.FC<AttachmentDisplayProps> = ({ attachment, className = '' }) => {
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' bytes';
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    else return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  if (attachment.type === 'image') {
    return (
      <div className={`mb-2 rounded-xl overflow-hidden shadow-md group ${className}`}>
        <div className="relative">
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-w-xs max-h-60 object-contain w-full transition-transform group-hover:scale-[0.98]"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-10 transition-opacity" />
        </div>
        <div className="text-xs px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium truncate">
          {attachment.name} ({formatFileSize(attachment.size)})
        </div>
      </div>
    );
  } else if (attachment.type === 'video') {
    return (
      <div className={`mb-2 rounded-xl overflow-hidden shadow-md ${className}`}>
        <video
          src={attachment.url}
          controls
          className="max-w-xs max-h-60 w-full"
        />
        <div className="text-xs px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-medium truncate">
          {attachment.name} ({formatFileSize(attachment.size)})
        </div>
      </div>
    );
  } else if (attachment.type === 'audio') {
    return (
      <div className={`mb-2 rounded-xl overflow-hidden shadow-md bg-gray-50 dark:bg-gray-800 p-3 ${className}`}>
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
        className={`flex items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-xl mb-2 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-md transition-all group border border-transparent hover:border-gray-200 dark:hover:border-gray-600 ${className}`}
      >
        <div className="h-12 w-12 mr-3 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <svg 
            className="h-6 w-6 text-gray-400 dark:text-gray-500 group-hover:text-primary-500 dark:group-hover:text-primary-400 transition-colors" 
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
          <span className="text-sm font-medium text-primary-600 dark:text-primary-400 truncate block">{attachment.name}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(attachment.size)}</span>
        </div>
        <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="h-5 w-5 text-gray-400 group-hover:text-primary-500 dark:group-hover:text-primary-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </div>
      </a>
    );
  }
};

export default AttachmentDisplay; 