import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div className="flex mb-3 animate-slide-up justify-start">
      <div className="bg-white dark:bg-dark-800 text-gray-800 dark:text-gray-200 rounded-2xl rounded-bl-none shadow-soft px-4 py-3">
        <div className="typing-indicator">
          <span className="typing-dot"></span>
          <span className="typing-dot"></span>
          <span className="typing-dot"></span>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator; 