import { useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';

/**
 * Hook to calculate the total number of unread notifications
 * across all conversations
 */
export function useUnreadNotifications() {
  const { conversations } = useChatStore();
  
  const unreadCount = useMemo(() => {
    return Object.values(conversations).reduce((count, conversation) => {
      if (conversation.isUnread) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [conversations]);

  return unreadCount;
}

export default useUnreadNotifications; 