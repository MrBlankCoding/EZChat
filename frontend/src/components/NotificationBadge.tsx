import React from 'react';

interface NotificationBadgeProps {
  count: number;
  className?: string;
}

const NotificationBadge: React.FC<NotificationBadgeProps> = ({ count, className = '' }) => {
  if (count <= 0) return null;

  return (
    <span 
      className={`absolute -top-1 -right-1 flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-xs font-medium text-white bg-red-500 ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

export default NotificationBadge; 