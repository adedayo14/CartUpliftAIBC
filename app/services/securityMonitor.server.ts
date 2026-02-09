// Phase 7: Security Monitoring and Logging
import { createReadStream } from "fs";
import { createHash } from "crypto";
import { logger } from "~/utils/logger.server";

interface SecurityEvent {
  type: 'rate_limit_exceeded' | 'invalid_webhook' | 'suspicious_request' | 'auth_failure';
  shop: string;
  userAgent?: string;
  ip: string;
  details: Record<string, unknown>;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface SecurityMetrics {
  rateLimitHits: number;
  invalidWebhooks: number;
  suspiciousRequests: number;
  authFailures: number;
  blockedIPs: string[];
  lastUpdated: Date;
}

class SecurityMonitor {
  private static instance: SecurityMonitor;
  private events: SecurityEvent[] = [];
  private maxEvents = 10000; // Keep last 10k events in memory
  
  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }

  logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: new Date()
    };

    // Add to in-memory store
    this.events.push(securityEvent);
    
    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to console for now (in production, send to monitoring service)
    logger.warn(`[SECURITY] ${event.type}:`, {
      shop: event.shop,
      ip: event.ip,
      severity: event.severity,
      details: event.details
    });

    // Alert on critical events
    if (event.severity === 'critical') {
      this.alertCriticalEvent(securityEvent);
    }
  }

  private alertCriticalEvent(event: SecurityEvent): void {
    // In production, this would send alerts to Slack, email, PagerDuty, etc.
    logger.error(`[CRITICAL SECURITY ALERT]`, {
      type: event.type,
      shop: event.shop,
      ip: event.ip,
      timestamp: event.timestamp,
      details: event.details
    });
    
    // Could also auto-block IPs, disable shops temporarily, etc.
  }

  getSecurityMetrics(shop?: string, hours = 24): SecurityMetrics {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentEvents = this.events.filter(event => 
      event.timestamp > cutoff && (!shop || event.shop === shop)
    );

    return {
      rateLimitHits: recentEvents.filter(e => e.type === 'rate_limit_exceeded').length,
      invalidWebhooks: recentEvents.filter(e => e.type === 'invalid_webhook').length,
      suspiciousRequests: recentEvents.filter(e => e.type === 'suspicious_request').length,
      authFailures: recentEvents.filter(e => e.type === 'auth_failure').length,
      blockedIPs: [...new Set(
        recentEvents
          .filter(e => e.severity === 'critical')
          .map(e => e.ip)
      )],
      lastUpdated: new Date()
    };
  }

  getTopThreats(shop?: string, limit = 10): Array<{
    ip: string;
    events: number;
    severity: string;
    lastSeen: Date;
  }> {
    const events = shop ? 
      this.events.filter(e => e.shop === shop) : 
      this.events;

    const ipStats = new Map();
    
    events.forEach(event => {
      const key = event.ip;
      if (!ipStats.has(key)) {
        ipStats.set(key, {
          ip: event.ip,
          events: 0,
          severity: 'low',
          lastSeen: event.timestamp
        });
      }
      
      const stats = ipStats.get(key);
      stats.events++;
      stats.lastSeen = event.timestamp > stats.lastSeen ? event.timestamp : stats.lastSeen;
      
      // Update severity to highest seen
      const severityLevels: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
      if ((severityLevels[event.severity] || 0) > (severityLevels[stats.severity] || 0)) {
        stats.severity = event.severity;
      }
    });

    return Array.from(ipStats.values())
      .sort((a, b) => b.events - a.events)
      .slice(0, limit);
  }

  // File integrity monitoring
  async checkFileIntegrity(filePath: string, expectedHash?: string): Promise<{
    valid: boolean;
    currentHash: string;
    expectedHash?: string;
  }> {
    try {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      
      return new Promise((resolve, reject) => {
        stream.on('data', data => hash.update(data));
        stream.on('end', () => {
          const currentHash = hash.digest('hex');
          resolve({
            valid: expectedHash ? currentHash === expectedHash : true,
            currentHash,
            expectedHash
          });
        });
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('File integrity check failed:', error);
      return { valid: false, currentHash: 'error' };
    }
  }

  // Check for common security issues
  validateRequest(request: {
    headers: Record<string, string>;
    url: string;
    method: string;
    body?: unknown;
  }): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for suspicious headers
    const userAgent = request.headers['user-agent'] || '';
    if (!userAgent || userAgent.length < 5) {
      issues.push('Missing or suspicious User-Agent header');
    }

    // Check for known malicious patterns
    const maliciousPatterns = [
      /\.(php|asp|jsp)$/i,
      /\.\./,  // Path traversal
      /<script/i,  // XSS attempts
      /union\s+select/i,  // SQL injection
      /javascript:/i  // JavaScript protocol
    ];

    if (maliciousPatterns.some(pattern => pattern.test(request.url))) {
      issues.push('URL contains suspicious patterns');
    }

    // Check Content-Type for POST/PUT
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      const contentType = request.headers['content-type'];
      if (!contentType) {
        issues.push('Missing Content-Type header for write operation');
      }
    }

    // Check for oversized requests
    const contentLength = parseInt(request.headers['content-length'] || '0');
    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
      issues.push('Request size exceeds safe limits');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}

// Export singleton instance
export const securityMonitor = SecurityMonitor.getInstance();

// Helper functions for common security checks
export function logRateLimitExceeded(shop: string, ip: string, endpoint: string): void {
  securityMonitor.logSecurityEvent({
    type: 'rate_limit_exceeded',
    shop,
    ip,
    severity: 'medium',
    details: { endpoint, timestamp: new Date() }
  });
}

export function logInvalidWebhook(shop: string, ip: string, reason: string): void {
  securityMonitor.logSecurityEvent({
    type: 'invalid_webhook',
    shop,
    ip,
    severity: 'high',
    details: { reason, timestamp: new Date() }
  });
}

export function logSuspiciousRequest(shop: string, ip: string, userAgent: string, details: Record<string, unknown>): void {
  securityMonitor.logSecurityEvent({
    type: 'suspicious_request',
    shop,
    ip,
    userAgent,
    severity: 'high',
    details
  });
}

export function logAuthFailure(shop: string, ip: string, userAgent: string, reason: string): void {
  securityMonitor.logSecurityEvent({
    type: 'auth_failure',
    shop,
    ip,
    userAgent,
    severity: 'critical',
    details: { reason, timestamp: new Date() }
  });
}

// Middleware to validate all requests
export function securityMiddleware() {
  return async (request: Request, _context: unknown, next: () => Promise<Response>) => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());

    const validation = securityMonitor.validateRequest({
      headers,
      url: url.pathname,
      method: request.method,
      body: request.body
    });

    if (!validation.valid) {
      const ip = headers['x-forwarded-for'] || 'unknown';
      logSuspiciousRequest('system', ip, headers['user-agent'] || 'unknown', {
        issues: validation.issues,
        url: url.pathname,
        method: request.method
      });

      // Don't block the request, just log it
      logger.warn('Security validation failed:', validation.issues);
    }

    return next();
  };
}

/**
 * Get detailed security metrics for audit endpoint
 * Phase 3: Enhanced metrics for security dashboard
 */
interface DetailedSecurityMetrics {
  rateLimitHits: Record<string, number>;
  payloadTooLarge: number;
  corsRejections: number;
  cron: Record<string, {
    runs: number;
    rateLimitHits: number;
  }>;
  highUsageWarnings: number;
}

export async function getSecurityMetrics(
  shop: string,
  window: '24h' | '7d'
): Promise<DetailedSecurityMetrics> {
  const hours = window === '24h' ? 24 : 168;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const monitor = SecurityMonitor.getInstance();
  const recentEvents = monitor['events'].filter(event =>
    event.timestamp > cutoff && event.shop === shop
  );

  // Aggregate rate limit hits by endpoint
  const rateLimitHits: Record<string, number> = {};
  recentEvents
    .filter(e => e.type === 'rate_limit_exceeded')
    .forEach(event => {
      const endpoint = (event.details.endpoint as string) || 'unknown';
      rateLimitHits[endpoint] = (rateLimitHits[endpoint] || 0) + 1;
    });

  // Count payload too large events
  const payloadTooLarge = recentEvents.filter(e =>
    e.type === 'suspicious_request' &&
    e.details.issues &&
    Array.isArray(e.details.issues) &&
    e.details.issues.some((issue: unknown) =>
      typeof issue === 'string' && issue.includes('size exceeds')
    )
  ).length;

  // Count CORS rejections
  const corsRejections = recentEvents.filter(e =>
    e.details.reason === 'cors-rejected' ||
    (typeof e.details.issues === 'object' && 'corsRejected' in e.details)
  ).length;

  // Aggregate cron stats (would need separate tracking in production)
  const cron: Record<string, { runs: number; rateLimitHits: number }> = {
    'daily-learning': {
      runs: 0,
      rateLimitHits: 0,
    },
    'compute-similarities': {
      runs: 0,
      rateLimitHits: 0,
    },
    'update-profiles': {
      runs: 0,
      rateLimitHits: 0,
    },
  };

  // Count high usage warnings
  const highUsageWarnings = recentEvents.filter(e =>
    e.severity === 'medium' &&
    e.details.warning === 'high-usage'
  ).length;

  return {
    rateLimitHits,
    payloadTooLarge,
    corsRejections,
    cron,
    highUsageWarnings,
  };
}