import { useEffect, useState } from "react";
import { reauthorizeApp, initializeAppBridge } from "../utils/auth-helper";

interface SessionStatusProps {
  onSessionExpired?: () => void;
}

export function SessionStatus({ onSessionExpired }: SessionStatusProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // Initialize App Bridge on mount
    initializeAppBridge();
    
    const checkAndRefreshSession = async () => {
      if (isRefreshing) return; // Prevent multiple simultaneous checks
      
      try {
        const response = await fetch('/admin/api/session-check');
        
        if (response.status === 401) {
          // Session expired - use auth helper for re-authentication
          console.log('Session expired, attempting re-authentication...');
          reauthorizeApp();
        }
      } catch (_error) {
        console.warn('Session check failed, likely network issue');
        // Don't refresh on network errors, just retry later
      }
    };

    const refreshSession = async () => {
      if (isRefreshing) return;
      
      setIsRefreshing(true);
      try {
        await fetch('/admin/api/session-refresh', { method: 'POST' });
        console.log('Session refreshed automatically');
      } catch (_error) {
        console.warn('Session refresh failed');
      } finally {
        setIsRefreshing(false);
      }
    };

    // Check session when user returns to tab (most important)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAndRefreshSession();
      }
    };

    // Listen for BigCommerce authentication messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.message === 'BigCommerce.reauthorize') {
        checkAndRefreshSession();
      }
    };

    // Auto-refresh session every 30 minutes to keep it alive
    const refreshInterval = setInterval(refreshSession, 30 * 60 * 1000);

    // Set up event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('message', handleMessage);

    // Check for expired sessions every 2 minutes
  const checkInterval = setInterval(checkAndRefreshSession, 2 * 60 * 1000);
    
    // Initial check
    checkAndRefreshSession();

    return () => {
      // Cleanup function
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(refreshInterval);
      clearInterval(checkInterval);
      window.removeEventListener('message', handleMessage);
    };
  }, [isRefreshing, onSessionExpired]);

  // This component is invisible - it just works in the background
  return null;
}
