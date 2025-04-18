import React from 'react';
import { useAuthStore } from '../stores/authStore';
import usePresence from '../hooks/usePresence';
import StatusIndicator from './StatusIndicator';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import { PresenceState } from '../services/presenceManager';
import { Fragment } from 'react';

interface UserStatusHeaderProps {
  className?: string;
}

// Define the type for the render props from @headlessui/react Menu.Item
interface MenuItemRenderProps {
  active: boolean;
  disabled: boolean;
  close: () => void;
}

const UserStatusHeader: React.FC<UserStatusHeaderProps> = ({ className = '' }) => {
  const { user } = useAuthStore();
  const { currentStatus, setStatus } = usePresence();
  
  if (!user) return null;
  
  const statusOptions = [
    { value: PresenceState.ONLINE, label: 'Online' },
    { value: PresenceState.AWAY, label: 'Away' },
    { value: PresenceState.OFFLINE, label: 'Appear Offline' }
  ];
  
  return (
    <div className={`flex items-center ${className}`}>
      <Menu as="div" className="relative inline-block text-left w-full">
        <div>
          <Menu.Button className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-800 rounded-lg transition-colors">
            <div className="flex items-center">
              <StatusIndicator status={currentStatus} size="sm" />
              <span className="ml-2 capitalize">{currentStatus}</span>
            </div>
            <ChevronDownIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </Menu.Button>
        </div>
        
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 mt-2 w-56 origin-top-right rounded-md bg-white dark:bg-dark-800 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
            <div className="px-1 py-1">
              {statusOptions.map((option) => (
                <Menu.Item key={option.value}>
                  {({ active }: MenuItemRenderProps) => (
                    <button
                      onClick={() => setStatus(option.value)}
                      className={`${
                        active || currentStatus === option.value
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-200'
                      } group flex w-full items-center rounded-md px-2 py-2 text-sm`}
                    >
                      <StatusIndicator 
                        status={option.value} 
                        size="sm" 
                        className="mr-2"
                      />
                      {option.label}
                    </button>
                  )}
                </Menu.Item>
              ))}
            </div>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  );
};

export default UserStatusHeader; 