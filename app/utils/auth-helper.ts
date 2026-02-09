// Authentication utilities for embedded Shopify apps

export function isEmbeddedApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.top !== window.self;
}

export function reauthorizeApp(): void {
  if (isEmbeddedApp()) {
    // Use App Bridge for re-authentication
    window.parent.postMessage({ 
      message: 'Shopify.API.reauthorizeApplication' 
    }, '*');
  } else {
    // Redirect to auth page
    window.location.href = '/auth';
  }
}

export function handleAuthError(error: unknown): void {
  if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
    console.warn('Authentication error:', error);
  }
  
  // Check if this is a 401 error
  if (error && typeof error === 'object' && 'status' in error) {
    const responseError = error as { status: number };
    if (responseError.status === 401) {
      reauthorizeApp();
      return;
    }
  }
  
  // For other errors, try to refresh the session
  fetch('/app/api/session-refresh', { method: 'POST' })
    .catch(() => {
      // If session refresh fails, reauthorize
      reauthorizeApp();
    });
}

export function initializeAppBridge(): void {
  if (typeof window === 'undefined') return;
  
  // Listen for App Bridge messages
  window.addEventListener('message', (event) => {
    if (event.data && event.data.message) {
      switch (event.data.message) {
        case 'Shopify.API.reauthorizeApplication':
          // Handle reauthorization
          window.location.reload();
          break;
        case 'Shopify.API.initialize':
          // App Bridge initialized
          if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
            console.log('App Bridge initialized');
          }
          break;
      }
    }
  });
}