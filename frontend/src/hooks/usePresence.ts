import { useState, useEffect, useCallback } from 'react';
import presenceManager, { PresenceState } from '../services/presenceManager';

interface PresenceHook {
  currentStatus: PresenceState;
  setStatus: (status: PresenceState) => void;
  idleThreshold: number; // in minutes
  setIdleThreshold: (minutes: number) => void;
}

/**
 * Hook to interact with the presence manager.
 * Allows components to get and set presence status and idle threshold.
 */
export const usePresence = (): PresenceHook => {
  const [currentStatus, setCurrentStatus] = useState<PresenceState>(
    presenceManager.getCurrentState()
  );
  
  const [idleThreshold, setIdleThresholdState] = useState<number>(5); // Default 5 minutes
  
  // Update local state when presence status changes
  useEffect(() => {
    // Create an interval to check current status
    const checkInterval = setInterval(() => {
      const status = presenceManager.getCurrentState();
      if (status !== currentStatus) {
        setCurrentStatus(status);
      }
    }, 10000); // Check every 10 seconds
    
    return () => {
      clearInterval(checkInterval);
    };
  }, [currentStatus]);
  
  // Function to set status manually
  const setStatus = useCallback((status: PresenceState) => {
    presenceManager.forceUpdatePresence(status);
    setCurrentStatus(status);
  }, []);
  
  // Function to set idle threshold
  const setIdleThreshold = useCallback((minutes: number) => {
    presenceManager.setIdleThreshold(minutes);
    setIdleThresholdState(minutes);
  }, []);
  
  return {
    currentStatus,
    setStatus,
    idleThreshold,
    setIdleThreshold
  };
};

export default usePresence; 