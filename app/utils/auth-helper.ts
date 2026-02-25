// Authentication utilities for BigCommerce apps (loaded in iframe)

export function isEmbeddedApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.top !== window.self;
}

export function initializeAppBridge(): void {
  // No-op for BigCommerce - no App Bridge initialization needed
  // BigCommerce apps run in an iframe with cookie-based auth
}

export function reauthorizeApp(): void {
  // Redirect to auth/load to re-establish session
  window.location.href = '/auth/load';
}

export function handleAuthError(error: unknown): void {
  if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
    console.warn('Authentication error:', error);
  }

  // Check if this is a 401 error
  if (error && typeof error === 'object' && 'status' in error) {
    const responseError = error as { status: number };
    if (responseError.status === 401) {
      // Reload the page - BigCommerce will re-trigger the /auth/load callback
      window.location.reload();
      return;
    }
  }
}
