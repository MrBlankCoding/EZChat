import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import { useAuthStore } from '../stores/authStore';
import { MagnifyingGlassIcon, XMarkIcon, EllipsisHorizontalIcon, TrashIcon, EnvelopeIcon, MapPinIcon, UserPlusIcon, PlusIcon, ArrowLeftOnRectangleIcon } from '@heroicons/react/24/outline';
import { MapPinIcon as MapPinIconSolid } from '@heroicons/react/24/solid';
import NewChatModal from './NewChatModal';
import NewGroupModal from './NewGroupModal';
import StatusIndicator from './StatusIndicator';
import NotificationBadge from './NotificationBadge';
import presenceManager from '../services/presenceManager';
import { Group } from '../types';
import { formatRelativeTime } from '../utils/dateUtils';
import { generateAvatarUrl } from '../utils/avatarUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ChatsList = () => {
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isNewGroupModalOpen, setIsNewGroupModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  
  const { user } = useAuthStore();
  const { 
    conversations, 
    activeConversationId, 
    groups,
    fetchGroups,
    pinConversation,
    markConversationAsUnread,
    deleteConversation,
    leaveGroup,
    deleteGroup
  } = useChatStore();
  const { contacts } = useContactsStore();
  
  // Load groups on component mount
  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);
  
  // Get chat items (direct chats and group chats)
  const chatItems = useMemo(() => {
    const items = [];
    
    // Process direct chats
    for (const [contactId, conversation] of Object.entries(conversations)) {
      // Skip group conversations - they're handled separately
      if (conversation.isGroup) continue;
      
      const contact = contacts.find(c => c.contact_id === contactId);
      if (!contact) continue;
      
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      
      items.push({
        id: contactId,
        name: contact.contact_display_name,
        avatar: contact.contact_avatar_url,
        lastMessage: lastMessage?.text || '',
        timestamp: lastMessage?.timestamp || conversation._lastUpdated || 0,
        unreadCount: conversation.messages.filter(
          msg => msg.senderId === contactId && msg.status !== 'read'
        ).length,
        isUnread: conversation.isUnread || false,
        status: presenceManager.getContactStatus(contactId),
        isPinned: conversation.isPinned || false,
        isGroup: false
      });
    }
    
    // Process group chats
    for (const [groupId, group] of Object.entries(groups)) {
      const conversation = conversations[groupId];
      
      // Skip if this group doesn't have a conversation entry yet or is missing necessary data
      if (!conversation || !group) continue;
      
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      
      // Find sender name for last message if available
      let lastMessageSender = '';
      if (lastMessage && lastMessage.senderId !== user?.id && group?.members) {
        const sender = group.members.find(m => m.user_id === lastMessage.senderId);
        if (sender) {
          lastMessageSender = sender.display_name.split(' ')[0] + ': ';
        }
      }
      
      items.push({
        id: groupId,
        name: group.name || 'Unnamed Group',
        avatar: group.avatar_url,
        lastMessage: lastMessage ? (lastMessageSender + lastMessage.text) : '',
        timestamp: lastMessage?.timestamp || conversation._lastUpdated || group.created_at || 0,
        unreadCount: conversation.messages.filter(
          msg => msg.senderId !== user?.id && msg.status !== 'read'
        ).length,
        isUnread: conversation.isUnread || false,
        memberCount: group.members?.length || 0,
        isPinned: conversation.isPinned || false,
        isGroup: true,
        ownerId: group.created_by
      });
    }
    
    // Sort by pinned first, then by timestamp
    return items
      .filter(item => {
        if (!searchQuery) return true;
        return item.name.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => {
        // Pinned items at the top
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        
        // Then sort by timestamp (most recent first)
        const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp;
        const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp;
        return timeB - timeA;
      });
  }, [conversations, contacts, searchQuery, groups, user?.id]);
  
  const openChat = (chatId: string) => {
    navigate(`/chat/${chatId}`);
  };
  
  const formatTimestamp = (timestamp: string | number) => {
    if (!timestamp) return '';
    
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      // Today: show time
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      // Yesterday
      return 'Yesterday';
    } else if (diffDays < 7) {
      // Within last week: show day name
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      // Older: show date
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };
  
  return (
    <div className="w-80 flex-shrink-0 border-r border-gray-200 dark:border-dark-700 flex flex-col transition-colors duration-200">
      <div className="p-4 border-b border-gray-200 dark:border-dark-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chats</h2>
          <div className="flex space-x-2">
            <button
              onClick={() => setIsNewChatModalOpen(true)}
              className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-secondary-400 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-dark-600 transition-colors"
              aria-label="New chat"
              title="New chat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M10 2a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H3a1 1 0 110-2h6V3a1 1 0 011-1z" />
              </svg>
            </button>
            <button
              onClick={() => setIsNewGroupModalOpen(true)}
              className="text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-secondary-400 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-dark-600 transition-colors"
              aria-label="New group"
              title="New group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM16 8a2 2 0 100-4 2 2 0 000 4zM17.5 9.25a4 4 0 00-2.5.75v4.5c0 .9.233 1.75.65 2.5h1.85a5 5 0 003-4.5V11a2 2 0 00-3-1.75z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </div>
          <input
            type="text"
            className="block w-full bg-gray-100 dark:bg-dark-700 border-transparent focus:border-primary-500 dark:focus:border-secondary-500 focus:ring-1 focus:ring-primary-500 dark:focus:ring-secondary-500 rounded-md pl-10 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {chatItems.length === 0 ? (
          <div className="p-4 text-center text-gray-500 dark:text-gray-400">
            {searchQuery ? 'No chats found for your search' : 'No chats yet'}
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-dark-700">
            {chatItems.map((chat) => {
              // Log ownerId and userId for groups
              if (chat.isGroup) {
                console.log(`Chat: ${chat.name} (ID: ${chat.id}), Owner ID: ${chat.ownerId}, User ID: ${user?.id}, Is Owner? ${chat.ownerId === user?.id}`);
              }
              
              return (
                <div
                  key={chat.id}
                  className={`relative group p-3 flex items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-dark-800 transition-colors ${
                    activeConversationId === chat.id ? 'bg-gray-100 dark:bg-dark-700' : ''
                  }`}
                  onClick={() => openChat(chat.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <div className="relative flex-shrink-0">
                      {chat.avatar ? (
                        <img src={chat.avatar} alt={chat.name} className="h-12 w-12 rounded-full" />
                      ) : (
                        <div className={`h-12 w-12 rounded-full flex items-center justify-center text-white ${
                          chat.isGroup ? 'bg-primary-600 dark:bg-primary-700' : 'bg-secondary-600 dark:bg-secondary-700'
                        }`}>
                          {chat.isGroup ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                              <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 01-.41-1.518c0-1.347.827-2.455 2.063-2.894.766-.323 1.697-.251 2.457-.130a6.297 6.297 0 012.834 1.097 3.997 3.997 0 01-.566 1.298 8.307 8.307 0 00-2.91-1.148c-.563-.091-1.232-.134-1.745.025-.512.158-.945.526-1.027 1.047a1 1 0 01-.117.27zM18 8a2 2 0 11-4 0 2 2 0 014 0zM16.51 15.326a.78.78 0 00.358-.442 3 3 0 00.41-1.518c0-1.347-.827-2.455-2.063-2.894-.766-.323-1.697-.251-2.457-.13a6.297 6.297 0 00-2.834 1.097 3.997 3.997 0 00.566 1.298 8.307 8.307 0 012.91-1.148c.563-.091 1.232-.134 1.745.025.512.158.945.526 1.027 1.047a1 1 0 00.117.27zM7.31 10.13a1.94 1.94 0 00-.128.32c.562.11 1.116.262 1.649.453.383.144.761.316 1.106.524a1.9 1.9 0 00-.11-.336 1.867 1.867 0 00-1.01-.98 1.872 1.872 0 00-1.507.02z" />
                            </svg>
                          ) : (
                            chat.name.charAt(0).toUpperCase()
                          )}
                        </div>
                      )}
                      {!chat.isGroup && (
                        <StatusIndicator status={chat.status} className="absolute bottom-0 right-0 shadow border-2 border-white dark:border-dark-800" />
                      )}
                      {chat.isGroup && typeof chat.memberCount === 'number' && chat.memberCount > 0 && (
                        <div className="absolute -bottom-1 -right-1 bg-gray-100 dark:bg-dark-600 text-xs font-medium text-gray-800 dark:text-gray-300 rounded-full h-5 min-w-[1.25rem] flex items-center justify-center px-1 border border-white dark:border-dark-800">
                          {chat.memberCount}
                        </div>
                      )}
                    </div>
                    <div className="ml-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center">
                          {chat.name}
                          {chat.isPinned && (
                            <MapPinIconSolid className="w-3 h-3 ml-1 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                          )}
                        </p>
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ml-1">
                          {formatTimestamp(chat.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {chat.lastMessage || (chat.isGroup ? 'New group created' : 'Start chatting')}
                        </p>
                        {chat.unreadCount > 0 && (
                          <NotificationBadge count={chat.unreadCount} />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="absolute top-1/2 right-2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <button
                          className="p-1 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-600 transition-colors"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          aria-label="Chat options"
                        >
                          <EllipsisHorizontalIcon className="w-5 h-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="w-48 bg-white dark:bg-dark-700 border border-gray-200 dark:border-dark-600 rounded-md shadow-lg z-50"
                        align="end"
                      >
                        <DropdownMenuItem
                          className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-600 cursor-pointer"
                          onSelect={() => pinConversation(chat.id, !chat.isPinned)}
                        >
                          {chat.isPinned ? (
                            <>
                              <MapPinIcon className="w-4 h-4 mr-2" /> Unpin Chat
                            </>
                          ) : (
                            <>
                              <MapPinIcon className="w-4 h-4 mr-2" /> Pin Chat
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-600 cursor-pointer"
                          onSelect={() => markConversationAsUnread(chat.id, !chat.isUnread)}
                        >
                          <EnvelopeIcon className="w-4 h-4 mr-2" />
                          {chat.isUnread ? 'Mark as Read' : 'Mark as Unread'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            console.log(`Dropdown selected for chat ID: ${chat.id}, isGroup: ${chat.isGroup}, ownerId: ${chat.ownerId}, userId: ${user?.id}`);
                            if (chat.isGroup) {
                              if (chat.ownerId === user?.id) {
                                console.log('Calling deleteGroup');
                                deleteGroup(chat.id);
                              } else {
                                console.log('Calling leaveGroup');
                                leaveGroup(chat.id);
                              }
                            } else {
                              console.log('Calling deleteConversation');
                              deleteConversation(chat.id);
                            }
                          }}
                          className="px-0 py-0"
                        >
                          {chat.isGroup ? (
                            chat.ownerId === user?.id ? (
                              <div className="flex items-center px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer">
                                <TrashIcon className="w-4 h-4 mr-2" /> Delete Group
                              </div>
                            ) : (
                              <div className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-dark-600 cursor-pointer">
                                <ArrowLeftOnRectangleIcon className="w-4 h-4 mr-2" /> Leave Group
                              </div>
                            )
                          ) : (
                            <div className="flex items-center px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer">
                              <TrashIcon className="w-4 h-4 mr-2" /> Delete Chat
                            </div>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      <NewChatModal isOpen={isNewChatModalOpen} onClose={() => setIsNewChatModalOpen(false)} />
      <NewGroupModal isOpen={isNewGroupModalOpen} onClose={() => setIsNewGroupModalOpen(false)} />
    </div>
  );
};

export default ChatsList; 