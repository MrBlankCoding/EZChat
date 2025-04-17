import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  UserIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

const Sidebar = () => {
  const { user } = useAuthStore();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(true);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className={`bg-white border-r border-gray-200 ${isOpen ? 'w-64' : 'w-16'} transition-all duration-300 flex flex-col`}>
      {/* Mobile toggle button */}
      <button
        className="md:hidden p-4 text-gray-500 hover:text-gray-900 focus:outline-none"
        onClick={toggleSidebar}
      >
        <svg
          className="h-6 w-6"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* User Profile */}
      <div className={`p-4 flex ${isOpen ? 'items-center' : 'justify-center'}`}>
        <div className="relative">
          <img
            className="h-10 w-10 rounded-full object-cover"
            src={user?.photoURL || 'https://via.placeholder.com/150'}
            alt="User avatar"
          />
          <div className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-white ${
            user?.status === 'online'
              ? 'bg-green-500'
              : user?.status === 'away'
              ? 'bg-yellow-500'
              : 'bg-gray-500'
          }`}></div>
        </div>
        {isOpen && (
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.displayName || 'User'}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="mt-5 flex-1 px-2 space-y-1">
        <NavLink
          to="/chat"
          className={({ isActive }) =>
            `${
              isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-md`
          }
        >
          <ChatBubbleLeftRightIcon className="mr-3 h-6 w-6 text-gray-500" />
          {isOpen && <span className="flex-1">Chat</span>}
        </NavLink>

        <NavLink
          to="/contacts"
          className={({ isActive }) =>
            `${
              isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-md`
          }
        >
          <UserGroupIcon className="mr-3 h-6 w-6 text-gray-500" />
          {isOpen && <span className="flex-1">Contacts</span>}
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `${
              isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            } group flex items-center px-2 py-2 text-sm font-medium rounded-md`
          }
        >
          <Cog6ToothIcon className="mr-3 h-6 w-6 text-gray-500" />
          {isOpen && <span className="flex-1">Settings</span>}
        </NavLink>
      </nav>

      {/* Version */}
      <div className="flex-shrink-0 p-4">
        {isOpen && (
          <div className="text-xs text-gray-400">
            <span>EZChat v0.1.0</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar; 