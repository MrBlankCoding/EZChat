/**
 * Browser WebExtension API Polyfill
 * 
 * This polyfill addresses the "browser is not defined" error that can occur when using 
 * libraries that attempt to use the browser extension API in a regular web context.
 * 
 * Firefox/Chrome extension APIs define a global 'browser' object that's not available
 * in regular web contexts. This polyfill creates a minimal dummy object to prevent errors.
 */

// Only define if it doesn't already exist
if (typeof window !== 'undefined' && !('browser' in window)) {
  // Create a minimal browser polyfill with empty implementations of commonly used APIs
  (window as any).browser = {
    // Empty runtime API
    runtime: {
      id: undefined,
      getManifest: () => ({}),
      connect: () => ({}),
      sendMessage: () => Promise.resolve({}),
      onMessage: {
        addListener: () => {},
        removeListener: () => {}
      }
    },
    
    // Empty storage API
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve()
      },
      sync: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve()
      }
    },
    
    // Minimal browserAction API
    browserAction: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve()
    }
  };
  
  console.debug('Added browser polyfill to prevent "browser is not defined" errors');
}

export default {}; 