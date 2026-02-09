import { useEffect } from "react";

interface AppBridgeInitializerProps {
  apiKey: string;
}

export function AppBridgeInitializer({ apiKey }: AppBridgeInitializerProps) {
  useEffect(() => {
    // Only run in browser environment
    if (typeof window === 'undefined') return;

    // Check if we're in an embedded context
    const isEmbedded = window.top !== window.self;
    
    if (!isEmbedded) {
      console.log('Not in embedded context, skipping App Bridge initialization');
      return;
    }

    // Handle iframe embedding issues
    const handleEmbeddedAuth = () => {
      // Check if parent can receive messages
      try {
        // Post message to parent window for authentication
        window.parent.postMessage({
          message: 'Shopify.API.initialize',
          data: { apiKey }
        }, '*');
        
        console.log('Sent App Bridge initialization message to parent');
      } catch (error) {
        console.error('Failed to communicate with parent window:', error);
        
        // If parent communication fails, try direct redirect
        const shop = new URLSearchParams(window.location.search).get('shop');
        if (shop) {
          window.location.href = `/auth?shop=${shop}`;
        } else {
          window.location.href = '/auth';
        }
      }
    };

    // Listen for messages from parent
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.message) {
        switch (event.data.message) {
          case 'Shopify.API.ready':
            console.log('App Bridge is ready');
            // Re-broadcast ready message to our own app
            window.postMessage({ message: 'Shopify.API.ready' }, '*');
            break;
          case 'Shopify.API.reauthorizeApplication':
            console.log('Re-authorization requested');
            window.location.reload();
            break;
        }
      }
    };

    // Set up message listener
    window.addEventListener('message', handleMessage);

    // Initialize embedded authentication
    handleEmbeddedAuth();

    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [apiKey]);

  return null; // This is a utility component, no UI
}

// Extend window type
declare global {
  interface Window {
    shopifyAppBridge?: unknown;
  }
}