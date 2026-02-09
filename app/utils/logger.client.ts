/**
 * Client-side Logger Utility
 * Provides environment-aware logging for client-side code
 * @module utils/logger.client
 */

const IS_PRODUCTION = typeof window !== 'undefined' &&
  (window.location?.hostname !== 'localhost' &&
   !window.location?.hostname?.includes('127.0.0.1'));

const IS_DEBUG = typeof window !== 'undefined' &&
  window.localStorage?.getItem('CART_UPLIFT_DEBUG') === 'true';

/**
 * Logger interface for client-side code
 * Only logs in development or when debug flag is set
 */
export const logger = {
  /**
   * Log debug information (development only)
   */
  debug: (...args: unknown[]) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      console.log('[CartUplift Debug]', ...args);
    }
  },

  /**
   * Log informational messages (development only)
   */
  info: (...args: unknown[]) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      console.info('[CartUplift Info]', ...args);
    }
  },

  /**
   * Log warnings (always shown)
   */
  warn: (...args: unknown[]) => {
    console.warn('[CartUplift Warning]', ...args);
  },

  /**
   * Log errors (always shown)
   */
  error: (...args: unknown[]) => {
    console.error('[CartUplift Error]', ...args);
  },

  /**
   * Log performance metrics (development only)
   */
  perf: (label: string, startTime: number) => {
    if (!IS_PRODUCTION || IS_DEBUG) {
      const duration = performance.now() - startTime;
      console.log(`[CartUplift Perf] ${label}: ${duration.toFixed(2)}ms`);
    }
  },
};

/**
 * Enable debug logging in production
 * Usage: In browser console, run: CartUplift.enableDebug()
 */
export function enableDebug() {
  if (typeof window !== 'undefined') {
    window.localStorage?.setItem('CART_UPLIFT_DEBUG', 'true');
    console.log('[CartUplift] Debug logging enabled. Reload page to apply.');
  }
}

/**
 * Disable debug logging
 */
export function disableDebug() {
  if (typeof window !== 'undefined') {
    window.localStorage?.removeItem('CART_UPLIFT_DEBUG');
    console.log('[CartUplift] Debug logging disabled. Reload page to apply.');
  }
}

// Expose to window for easy access in production debugging
if (typeof window !== 'undefined') {
  (window as Record<string, unknown>).CartUplift = {
    enableDebug,
    disableDebug,
    isDebug: IS_DEBUG,
  };
}
