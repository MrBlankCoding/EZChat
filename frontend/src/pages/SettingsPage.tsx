import { useState, FormEvent, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { signOut } from '../services/authService';
import { apiClient } from '../services/apiClient';
import toast from 'react-hot-toast';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebaseConfig';
import Sidebar from '../components/Sidebar';
import notificationService from '../services/notificationService';
import { BellIcon, BellSlashIcon } from '@heroicons/react/24/outline';
import ThemeToggle from '../components/ThemeToggle';
import { useThemeStore } from '../stores/themeStore';
import { generateAvatarUrl } from '../utils/avatarUtils';
import PresenceSettings from '../components/PresenceSettings';

const SettingsPage = () => {
  const { user, setUser, logout } = useAuthStore();
  const { mode } = useThemeStore();
  const navigate = useNavigate();
  
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<'online' | 'offline' | 'away'>('online');
  const [isLoading, setIsLoading] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notificationStatus, setNotificationStatus] = useState<'granted' | 'denied' | 'default'>('default');
  
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      if (user.status) {
        setStatus(user.status as 'online' | 'offline' | 'away');
      }
      if (user.photoURL) {
        setAvatarPreview(user.photoURL);
      }
    }
  }, [user]);
  
  // Check notification permission status
  useEffect(() => {
    if ('Notification' in window) {
      setNotificationStatus(Notification.permission as 'granted' | 'denied' | 'default');
    }
  }, []);
  
  const handleLogout = async () => {
    try {
      await signOut();
      logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Failed to log out');
    }
  };
  
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }
    
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };
  
  const uploadAvatar = async (): Promise<string | undefined> => {
    if (!avatarFile || !user) return undefined;
    
    const storageRef = ref(storage, `avatars/${user.id}/${Date.now()}_${avatarFile.name}`);
    const uploadTask = uploadBytesResumable(storageRef, avatarFile);
    
    return new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        },
        (error) => {
          console.error('Avatar upload error:', error);
          reject(error);
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadURL);
          } catch (error) {
            reject(error);
          }
        }
      );
    });
  };
  
  // Request notification permission
  const requestPermission = async () => {
    try {
      const permissionGranted = await notificationService.requestPermission();
      if (permissionGranted) {
        setNotificationStatus('granted');
        await notificationService.getToken();
        toast.success('Notifications enabled successfully');
      } else {
        setNotificationStatus('denied');
        toast.error('Notification permission denied');
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      toast.error('Failed to enable notifications');
    }
  };
  
  // Send a test notification
  const sendTestNotification = () => {
    try {
      notificationService.displayNotification({
        title: 'Test Notification',
        body: 'This is a test notification from EZChat.',
        icon: '/icons/app-icon-192.png'
      });
      toast.success('Test notification sent');
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast.error('Failed to send test notification');
    }
  };
  
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      let avatarURL = user?.photoURL;
      
      // Upload avatar if selected
      if (avatarFile) {
        avatarURL = await uploadAvatar();
        if (!avatarURL) {
          toast.error('Failed to upload avatar');
          setIsLoading(false);
          return;
        }
      }
      
      // Update user profile in API
      const response = await apiClient.put('/user/profile', {
        display_name: displayName,
        status,
        avatar_url: avatarURL,
      });
      
      // Update local user state
      if (user) {
        setUser({
          ...user,
          displayName,
          status,
          photoURL: avatarURL,
        });
      }
      
      toast.success('Profile updated successfully');
    } catch (error) {
      console.error('Update profile error:', error);
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
      setUploadProgress(0);
    }
  };
  
  return (
    <div className="h-full flex">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-dark-900">
        <div className="max-w-4xl mx-auto w-full px-4 py-8">
          <div className="md:grid md:grid-cols-3 md:gap-6">
            <div className="md:col-span-1">
              <div className="px-4 sm:px-0">
                <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">Profile</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Update your profile information and preferences.
                </p>
              </div>
            </div>
            
            <div className="mt-5 md:mt-0 md:col-span-2">
              <form onSubmit={handleSubmit}>
                <div className="shadow sm:rounded-md sm:overflow-hidden">
                  <div className="px-4 py-5 bg-white space-y-6 sm:p-6">
                    {/* Avatar */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Profile photo</label>
                      <div className="mt-2 flex items-center space-x-5">
                        <div className="flex-shrink-0">
                          <div className="relative">
                            <img
                              className="h-16 w-16 rounded-full object-cover"
                              src={avatarPreview || (user?.photoURL || (user?.displayName ? generateAvatarUrl(user.displayName, 150) : generateAvatarUrl('User', 150)))}
                              alt="Avatar Preview"
                            />
                            {uploadProgress > 0 && uploadProgress < 100 && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-full">
                                <span className="text-white text-xs font-medium">{uploadProgress.toFixed(0)}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="bg-white py-2 px-3 border border-gray-300 rounded-md shadow-sm text-sm leading-4 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          onClick={() => document.getElementById('avatar-upload')?.click()}
                        >
                          Change
                        </button>
                        <input
                          id="avatar-upload"
                          name="avatar"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarChange}
                        />
                      </div>
                    </div>
                    
                    {/* Display Name */}
                    <div>
                      <label htmlFor="display-name" className="block text-sm font-medium text-gray-700">
                        Display Name
                      </label>
                      <div className="mt-1">
                        <input
                          type="text"
                          name="display-name"
                          id="display-name"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="input"
                          required
                        />
                      </div>
                    </div>
                    
                    {/* Status */}
                    <div>
                      <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                        Status
                      </label>
                      <div className="mt-1">
                        <select
                          id="status"
                          name="status"
                          value={status}
                          onChange={(e) => setStatus(e.target.value as 'online' | 'offline' | 'away')}
                          className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                        >
                          <option value="online">Online</option>
                          <option value="away">Away</option>
                          <option value="offline">Offline</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="px-4 py-3 bg-gray-50 text-right sm:px-6 space-x-2">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                    >
                      Log out
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                    >
                      {isLoading ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
          
          {/* Appearance Section */}
          <div className="mt-10 md:grid md:grid-cols-3 md:gap-6">
            <div className="md:col-span-1">
              <div className="px-4 sm:px-0">
                <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">Appearance</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Customize how EZChat looks and feels.
                </p>
              </div>
            </div>
            <div className="mt-5 md:mt-0 md:col-span-2">
              <div className="shadow sm:rounded-md sm:overflow-hidden">
                <div className="px-4 py-5 bg-white dark:bg-dark-800 space-y-6 sm:p-6">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">Theme</h4>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Switch between light and dark mode.
                      </p>
                      
                      <div className="flex items-center space-x-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {mode === 'dark' ? 'Dark Mode' : 'Light Mode'}
                        </span>
                        <ThemeToggle />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Presence Settings */}
          <PresenceSettings className="mt-6 shadow sm:rounded-md sm:overflow-hidden" />
          
          {/* Notification Settings */}
          <div className="mt-6 shadow sm:rounded-md sm:overflow-hidden">
            <div className="px-4 py-5 bg-white dark:bg-dark-800 space-y-6 sm:p-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Notifications</h3>
                
                {/* Notification Permission Status */}
                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Notification Status</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {notificationStatus === 'granted' 
                        ? 'Notifications are enabled'
                        : notificationStatus === 'denied'
                          ? 'Notifications are blocked. Please update browser settings to enable.'
                          : 'Notifications are not enabled yet.'}
                    </p>
                  </div>
                  <div>
                    {notificationStatus === 'granted' ? (
                      <div className="flex items-center text-green-600 dark:text-green-500">
                        <BellIcon className="h-6 w-6 mr-1" />
                        <span className="text-sm">Enabled</span>
                      </div>
                    ) : (
                      <div className="flex items-center text-red-600 dark:text-red-500">
                        <BellSlashIcon className="h-6 w-6 mr-1" />
                        <span className="text-sm">Disabled</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Notification Action Buttons */}
                <div className="mt-4 space-x-2">
                  {notificationStatus !== 'granted' && (
                    <button
                      type="button"
                      onClick={requestPermission}
                      className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    >
                      Enable Notifications
                    </button>
                  )}
                  
                  {notificationStatus === 'granted' && (
                    <button
                      type="button"
                      onClick={sendTestNotification}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-dark-700 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-dark-700 hover:bg-gray-50 dark:hover:bg-dark-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                    >
                      Send Test Notification
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage; 