/**
 * Production-Ready Structured Logger for CartUplift
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Environment-aware filtering
 * - Request ID tracking
 * - Structured JSON format for production
 * - Performance measurement
 *
 * Usage:
 *   import { logger, createRequestLogger } from '~/utils/logger.server';
 *
 *   logger.debug('Debug info');         // Only in DEBUG_MODE
 *   logger.info('Info message');        // Only in DEBUG_MODE
 *   logger.warn('Warning');             // Always shown
 *   logger.error('Critical error');     // Always shown
 *
 *   // With request context:
 *   const reqLogger = createRequestLogger(request);
 *   reqLogger.info('Processing order', { orderId: '123' });
 *
 * Environment Variables:
 * - DEBUG_MODE=true - Enable debug/info logging
 * - LOG_FORMAT=json - Use structured JSON output (default: text)
 */

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const LOG_FORMAT = process.env.LOG_FORMAT || 'text';
const NODE_ENV = process.env.NODE_ENV || 'development';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogMetadata {
  [key: string]: unknown;
  requestId?: string;
  shop?: string;
  route?: string;
  duration?: number;
}

/**
 * Format log message for output
 */
function formatLog(
  level: LogLevel,
  message: string,
  metadata?: LogMetadata
): string {
  const timestamp = new Date().toISOString();

  if (LOG_FORMAT === 'json') {
    return JSON.stringify({
      timestamp,
      level,
      message,
      env: NODE_ENV,
      ...metadata,
    });
  }

  // Text format for development
  const metaStr = metadata
    ? ` ${JSON.stringify(metadata)}`
    : '';
  return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  switch (level) {
    case LogLevel.DEBUG:
      return DEBUG_MODE;
    case LogLevel.INFO:
      return DEBUG_MODE;
    case LogLevel.WARN:
      return true;
    case LogLevel.ERROR:
      return true;
    default:
      return false;
  }
}

/**
 * Core logging function
 */
function logMessage(
  level: LogLevel,
  message: string,
  metadata?: LogMetadata
): void {
  if (!shouldLog(level)) return;

  const formatted = formatLog(level, message, metadata);

  switch (level) {
    case LogLevel.ERROR:
      console.error(formatted);
      break;
    case LogLevel.WARN:
      console.warn(formatted);
      break;
    case LogLevel.INFO:
      console.info(formatted);
      break;
    case LogLevel.DEBUG:
    default:
      console.log(formatted);
      break;
  }
}

/**
 * Main logger instance
 */
export const logger = {
  /**
   * Debug logging - only visible when DEBUG_MODE=true
   * Use for verbose debugging information
   */
  debug: (message: string, metadata?: LogMetadata) => {
    logMessage(LogLevel.DEBUG, message, metadata);
  },

  /**
   * Info logging - only visible when DEBUG_MODE=true
   * Use for general informational messages
   */
  info: (message: string, metadata?: LogMetadata) => {
    logMessage(LogLevel.INFO, message, metadata);
  },

  /**
   * Warning logging - ALWAYS visible
   * Use for recoverable issues
   */
  warn: (message: string, metadata?: LogMetadata) => {
    logMessage(LogLevel.WARN, message, metadata);
  },

  /**
   * Error logging - ALWAYS visible
   * Use for errors and exceptions
   */
  error: (message: string, metadata?: LogMetadata) => {
    logMessage(LogLevel.ERROR, message, metadata);
  },

  /**
   * Legacy log method - maps to debug
   * @deprecated Use debug() instead
   */
  log: (...args: unknown[]) => {
    if (DEBUG_MODE) console.log(...args);
  },
};

/**
 * Create a logger with request context
 * Automatically includes request ID and route in all logs
 */
export function createRequestLogger(request: Request, additionalContext?: LogMetadata) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const url = new URL(request.url);
  const route = url.pathname;

  const baseMetadata: LogMetadata = {
    requestId,
    route,
    ...additionalContext,
  };

  return {
    debug: (message: string, metadata?: LogMetadata) => {
      logger.debug(message, { ...baseMetadata, ...metadata });
    },
    info: (message: string, metadata?: LogMetadata) => {
      logger.info(message, { ...baseMetadata, ...metadata });
    },
    warn: (message: string, metadata?: LogMetadata) => {
      logger.warn(message, { ...baseMetadata, ...metadata });
    },
    error: (message: string, metadata?: LogMetadata) => {
      logger.error(message, { ...baseMetadata, ...metadata });
    },
  };
}

/**
 * Performance measurement helper
 * Returns a function to log the duration when called
 */
export function createPerfLogger(label: string, metadata?: LogMetadata) {
  const startTime = Date.now();

  return {
    /**
     * Log the elapsed time since creation
     */
    end: (additionalMetadata?: LogMetadata) => {
      const duration = Date.now() - startTime;
      logger.info(`${label} completed`, {
        duration,
        ...metadata,
        ...additionalMetadata,
      });
    },
  };
}
