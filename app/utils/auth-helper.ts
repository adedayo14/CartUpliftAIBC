// Authentication utilities for BigCommerce apps (loaded in iframe)

export function isEmbeddedApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.top !== window.self;
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
