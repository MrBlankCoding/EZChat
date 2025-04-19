import React from 'react';
import { PresenceState } from '../services/presenceManager';

interface StatusIndicatorProps {
  status?: PresenceState | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

/**
 * A reusable status indicator component that displays online/away/offline status
 */
const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status = PresenceState.OFFLINE,
  size = 'md',
  showLabel = false,
  className = ''
}) => {
  // Convert any string status to PresenceState for consistency
  const normalizedStatus = typeof status === 'string' 
    ? (status === 'online' 
      ? PresenceState.ONLINE 
      : status === 'away' 
        ? PresenceState.AWAY 
        : PresenceState.OFFLINE) 
    : status;
  
  // Set size dimensions
  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4'
  };
  
  // Set status color
  const statusColor = 
    normalizedStatus === PresenceState.ONLINE ? 'bg-green-500' :
    normalizedStatus === PresenceState.AWAY ? 'bg-yellow-500' : 'bg-gray-500';
  
  // Set status label
  const statusLabel = 
    normalizedStatus === PresenceState.ONLINE ? 'Online' :
    normalizedStatus === PresenceState.AWAY ? 'Away' : 'Offline';
  
  return (
    <div className={`flex items-center ${className}`}>
      <div 
        className={`${sizeClasses[size]} ${statusColor} rounded-full border-2 border-white dark:border-dark-900`}
        aria-label={statusLabel}
      />
      
      {showLabel && (
        <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">
          {statusLabel}
        </span>
      )}
    </div>
  );
};

export default StatusIndicator; 