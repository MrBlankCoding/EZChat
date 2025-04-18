import React, { useState } from 'react';
import usePresence from '../hooks/usePresence';
import { PresenceState } from '../services/presenceManager';
import StatusIndicator from './StatusIndicator';

interface PresenceSettingsProps {
  className?: string;
}

const PresenceSettings: React.FC<PresenceSettingsProps> = ({ className = '' }) => {
  const { currentStatus, setStatus, idleThreshold, setIdleThreshold } = usePresence();
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Available status options
  const statusOptions = [
    { value: PresenceState.ONLINE, label: 'Online' },
    { value: PresenceState.AWAY, label: 'Away' },
    { value: PresenceState.OFFLINE, label: 'Appear Offline' }
  ];
  
  // Available auto-away timeout options (in minutes)
  const timeoutOptions = [
    { value: 5, label: '5 minutes' },
    { value: 10, label: '10 minutes' },
    { value: 15, label: '15 minutes' },
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' }
  ];
  
  return (
    <div className={`bg-white dark:bg-dark-800 rounded-lg shadow-sm p-4 ${className}`}>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Presence Settings</h3>
      
      {/* Current Status */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Your Status
        </label>
        <div className="flex space-x-2">
          {statusOptions.map(option => (
            <button
              key={option.value}
              onClick={() => setStatus(option.value)}
              className={`flex items-center px-3 py-2 rounded-lg transition-colors ${
                currentStatus === option.value
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                  : 'bg-gray-100 dark:bg-dark-700 hover:bg-gray-200 dark:hover:bg-dark-600 text-gray-700 dark:text-gray-300 border border-transparent'
              }`}
            >
              <StatusIndicator status={option.value} size="sm" className="mr-2" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Advanced Settings Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 mb-3 underline"
      >
        {showAdvanced ? 'Hide advanced settings' : 'Show advanced settings'}
      </button>
      
      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="pt-2 border-t border-gray-200 dark:border-dark-700">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Auto Away After
            </label>
            <select
              value={idleThreshold}
              onChange={(e) => setIdleThreshold(Number(e.target.value))}
              className="w-full bg-gray-100 dark:bg-dark-700 text-gray-900 dark:text-white rounded-lg p-2 border border-gray-300 dark:border-dark-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400"
            >
              {timeoutOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Your status will automatically change to Away after this period of inactivity
            </p>
          </div>
          
          <div>
            <div className="flex items-center mb-2">
              <input
                type="checkbox"
                id="showOfflineToAll"
                className="h-4 w-4 text-primary-600 dark:text-primary-500 rounded border-gray-300 dark:border-dark-600 focus:ring-primary-500 dark:focus:ring-primary-400"
              />
              <label htmlFor="showOfflineToAll" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                Show as offline to everyone
              </label>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When enabled, you'll appear offline to all contacts even when you're using the app
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresenceSettings; 