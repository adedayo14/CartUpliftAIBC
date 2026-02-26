import { useEffect, useState } from "react";
import { reauthorizeApp, initializeAppBridge } from "../utils/auth-helper";

interface SessionStatusProps {
  storeHash?: string;
  onSessionExpired?: () => void;
}

function resolveStoreHash(providedStoreHash?: string): string | undefined {
  if (typeof window === "undefined") return providedStoreHash;

  const fromUrl = new URLSearchParams(window.location.search).get("context");
  if (fromUrl) {
    sessionStorage.setItem("bc_store_hash", fromUrl);
    return fromUrl;
  }

  return providedStoreHash || sessionStorage.getItem("bc_store_hash") || undefined;
}

export function SessionStatus({ storeHash, onSessionExpired }: SessionStatusProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // Initialize App Bridge on mount
    initializeAppBridge();

    const getRequestConfig = (path: string) => {
      const resolvedStoreHash = resolveStoreHash(storeHash);
      if (!resolvedStoreHash) {
        return { url: path, headers: undefined, storeHash: undefined };
      }

      const separator = path.includes("?") ? "&" : "?";
      return {
        url: `${path}${separator}context=${encodeURIComponent(resolvedStoreHash)}`,
        headers: { "x-store-hash": resolvedStoreHash },
        storeHash: resolvedStoreHash,
      };
    };
    
    const checkAndRefreshSession = async () => {
      if (isRefreshing) return; // Prevent multiple simultaneous checks
      
      try {
        const requestConfig = getRequestConfig('/admin/api/session-check');
        const response = await fetch(requestConfig.url, {
          headers: requestConfig.headers,
        });
        
        if (response.status === 401) {
          // Session expired - use auth helper for re-authentication
          onSessionExpired?.();
          console.log('Session expired, attempting re-authentication...');
          reauthorizeApp(requestConfig.storeHash);
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
        const requestConfig = getRequestConfig('/admin/api/session-refresh');
        await fetch(requestConfig.url, {
          method: 'POST',
          headers: requestConfig.headers,
        });
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
  }, [isRefreshing, onSessionExpired, storeHash]);

  // This component is invisible - it just works in the background
  return null;
}
