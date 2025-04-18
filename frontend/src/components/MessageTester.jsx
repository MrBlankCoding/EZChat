import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useContactsStore } from '../stores/contactsStore';
import websocketService from '../services/websocketService';

const MessageTester = () => {
  const [contactId, setContactId] = useState('');
  const [messageId, setMessageId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [reactionEmoji, setReactionEmoji] = useState('👍');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  
  const { user } = useAuthStore();
  const { contacts } = useContactsStore();
  const { conversations } = useChatStore();
  
  const handleSendMessage = async () => {
    try {
      setResult(null);
      setError(null);
      
      if (!contactId) {
        setError('Please select a contact');
        return;
      }
      
      if (!messageText) {
        setError('Please enter a message');
        return;
      }
      
      const result = await websocketService.sendMessage(contactId, messageText);
      setResult(`Message sent successfully! ID: ${result}`);
      setMessageId(result);
      setMessageText('');
    } catch (err) {
      setError(`Failed to send message: ${err.message || err}`);
    }
  };
  
  const handleSendReaction = async (action) => {
    try {
      setResult(null);
      setError(null);
      
      if (!contactId) {
        setError('Please select a contact');
        return;
      }
      
      if (!messageId) {
        setError('Please enter a message ID');
        return;
      }
      
      await websocketService.sendReaction(contactId, messageId, reactionEmoji, action);
      setResult(`Reaction ${action === 'add' ? 'added' : 'removed'} successfully!`);
    } catch (err) {
      setError(`Failed to send reaction: ${err.message || err}`);
    }
  };
  
  const handleEditMessage = async () => {
    try {
      setResult(null);
      setError(null);
      
      if (!contactId) {
        setError('Please select a contact');
        return;
      }
      
      if (!messageId) {
        setError('Please enter a message ID');
        return;
      }
      
      if (!messageText) {
        setError('Please enter new message text');
        return;
      }
      
      await websocketService.editMessage(contactId, messageId, messageText);
      setResult('Message edited successfully!');
      setMessageText('');
    } catch (err) {
      setError(`Failed to edit message: ${err.message || err}`);
    }
  };
  
  const handleDeleteMessage = async () => {
    try {
      setResult(null);
      setError(null);
      
      if (!contactId) {
        setError('Please select a contact');
        return;
      }
      
      if (!messageId) {
        setError('Please enter a message ID');
        return;
      }
      
      await websocketService.deleteMessage(contactId, messageId);
      setResult('Message deleted successfully!');
    } catch (err) {
      setError(`Failed to delete message: ${err.message || err}`);
    }
  };
  
  const handleSendReply = async () => {
    try {
      setResult(null);
      setError(null);
      
      if (!contactId) {
        setError('Please select a contact');
        return;
      }
      
      if (!messageId) {
        setError('Please enter a message ID to reply to');
        return;
      }
      
      if (!messageText) {
        setError('Please enter reply text');
        return;
      }
      
      await websocketService.sendReply(contactId, messageText, messageId);
      setResult('Reply sent successfully!');
      setMessageText('');
    } catch (err) {
      setError(`Failed to send reply: ${err.message || err}`);
    }
  };
  
  // Get messages for selected contact
  const messages = contactId ? 
    (conversations[contactId]?.messages || []).slice(-10).reverse() : 
    [];
  
  if (!user) {
    return <div className="p-4 text-red-500">You must be logged in to use this tool</div>;
  }
  
  return (
    <div className="p-4 border rounded-lg shadow-md max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">Message Tester</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Contact</label>
        <select 
          className="w-full p-2 border rounded"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">Select a contact</option>
          {contacts.map((contact) => (
            <option key={contact.contact_id} value={contact.contact_id}>
              {contact.contact_display_name || contact.contact_email}
            </option>
          ))}
        </select>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Message ID</label>
        <div className="flex space-x-2">
          <input 
            type="text"
            className="flex-1 p-2 border rounded"
            placeholder="Message ID"
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
          />
          <select 
            className="p-2 border rounded"
            onChange={(e) => {
              if (e.target.value) setMessageId(e.target.value);
            }}
          >
            <option value="">Select existing</option>
            {messages.map((msg) => (
              <option key={msg.id} value={msg.id}>
                {msg.text.substring(0, 20)}{msg.text.length > 20 ? '...' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Message Text</label>
        <textarea 
          className="w-full p-2 border rounded"
          placeholder="Message text"
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          rows={3}
        />
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Reaction</label>
        <select 
          className="w-full p-2 border rounded"
          value={reactionEmoji}
          onChange={(e) => setReactionEmoji(e.target.value)}
        >
          <option value="👍">👍 Thumbs Up</option>
          <option value="❤️">❤️ Heart</option>
          <option value="😂">😂 Laugh</option>
          <option value="😮">😮 Wow</option>
          <option value="😢">😢 Sad</option>
          <option value="🙏">🙏 Thank You</option>
        </select>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button 
          onClick={handleSendMessage}
          className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Send Message
        </button>
        <button 
          onClick={() => handleSendReaction('add')}
          className="p-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Add Reaction
        </button>
        <button 
          onClick={() => handleSendReaction('remove')}
          className="p-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Remove Reaction
        </button>
        <button 
          onClick={handleEditMessage}
          className="p-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Edit Message
        </button>
        <button 
          onClick={handleDeleteMessage}
          className="p-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Delete Message
        </button>
        <button 
          onClick={handleSendReply}
          className="p-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
        >
          Send Reply
        </button>
      </div>
      
      {result && (
        <div className="p-3 bg-green-100 border border-green-300 rounded text-green-700 mb-4">
          {result}
        </div>
      )}
      
      {error && (
        <div className="p-3 bg-red-100 border border-red-300 rounded text-red-700 mb-4">
          {error}
        </div>
      )}
      
      {messages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-2">Recent Messages</h3>
          <div className="overflow-y-auto max-h-60 border rounded p-2">
            {messages.map((msg) => (
              <div key={msg.id} className="text-sm border-b py-2">
                <div className="font-medium">{msg.id}</div>
                <div>{msg.text}</div>
                <div className="text-xs text-gray-500">
                  From: {msg.senderId === user.id ? 'You' : msg.senderId}
                  {msg.isEdited && ' (edited)'}
                  {msg.isDeleted && ' [DELETED]'}
                </div>
                {msg.reactions && msg.reactions.length > 0 && (
                  <div className="text-xs mt-1">
                    Reactions: {msg.reactions.map(r => r.reaction).join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageTester; 