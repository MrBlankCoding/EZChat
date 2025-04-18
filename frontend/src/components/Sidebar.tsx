import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import ThemeToggle from './ThemeToggle';
import {
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  UserGroupIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

const Sidebar = () => {
  const { user } = useAuthStore();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className={`bg-white dark:bg-dark-900 border-r border-gray-200 dark:border-dark-700 ${isOpen ? 'w-64' : 'w-16'} transition-all duration-300 flex flex-col shadow-soft h-full`}>
      {/* Sidebar header with toggle button */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-dark-700">
        {isOpen && (
          <div className="font-semibold text-lg text-primary-600 dark:text-secondary-400 animate-fade-in">
            EZ<span className="text-gray-800 dark:text-white">Chat</span>
          </div>
        )}
        <button
          className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-dark-800 dark:hover:bg-dark-700 text-gray-500 dark:text-gray-300 focus:outline-none transition-colors"
          onClick={toggleSidebar}
        >
          {isOpen ? (
            <ChevronLeftIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* User Profile */}
      <div className={`p-4 flex ${isOpen ? 'items-center' : 'justify-center'} border-b border-gray-200 dark:border-dark-700`}>
        <div className="relative">
          <img
            className="h-10 w-10 rounded-full object-cover ring-2 ring-primary-200 dark:ring-secondary-700"
            src={user?.photoURL || 'https://via.placeholder.com/150'}
            alt="User avatar"
          />
          <div className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-dark-800 ${
            user?.status === 'online'
              ? 'bg-green-500'
              : user?.status === 'away'
              ? 'bg-yellow-500'
              : 'bg-gray-500'
          }`}></div>
        </div>
        {isOpen && (
          <div className="ml-3 overflow-hidden animate-fade-in">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.displayName || 'User'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="mt-5 flex-1 px-2 space-y-1">
        <NavLink
          to="/chat"
          className={({ isActive }) =>
            `${
              isActive 
                ? 'bg-primary-50 dark:bg-dark-800 text-primary-600 dark:text-secondary-400' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-800 hover:text-primary-600 dark:hover:text-secondary-400'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200`
          }
        >
          <ChatBubbleLeftRightIcon className="mr-3 h-6 w-6 flex-shrink-0" />
          {isOpen && <span className="flex-1 animate-fade-in">Chats</span>}
        </NavLink>

        <NavLink
          to="/contacts"
          className={({ isActive }) =>
            `${
              isActive 
                ? 'bg-primary-50 dark:bg-dark-800 text-primary-600 dark:text-secondary-400' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-800 hover:text-primary-600 dark:hover:text-secondary-400'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200`
          }
        >
          <UserGroupIcon className="mr-3 h-6 w-6 flex-shrink-0" />
          {isOpen && <span className="flex-1 animate-fade-in">Contacts</span>}
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${
              isActive 
                ? 'bg-primary-50 dark:bg-dark-800 text-primary-600 dark:text-secondary-400' 
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-800 hover:text-primary-600 dark:hover:text-secondary-400'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200`
          }
        >
          <Cog6ToothIcon className="mr-3 h-6 w-6 flex-shrink-0" />
          {isOpen && <span className="flex-1 animate-fade-in">Settings</span>}
        </NavLink>
      </nav>

      {/* Footer with theme toggle */}
      <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-dark-700">
        <div className="flex items-center justify-between">
          {isOpen && (
            <div className="text-xs text-gray-400 dark:text-gray-500 animate-fade-in">
              <span>EZChat v0.1.0</span>
            </div>
          )}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;