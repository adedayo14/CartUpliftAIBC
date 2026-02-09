import { LRUCache } from 'lru-cache';
import { logRateLimitExceeded } from '../services/securityMonitor.server';
import { getClientIP } from '../services/security.server';

/**
 * Phase 3: Enhanced Rate Limiting with Burst Support
 *
 * Bucket system: Two-tier rate limiting
 * - Short window (10s): Burst allowance (30-40 requests)
 * - Long window (60s): Sustained rate (100-500 requests)
 */

interface BurstBucket {
  burstCount: number;
  burstReset: number;
  sustainedCount: number;
  sustainedReset: number;
}

const rateLimitCache = new LRUCache<string, BurstBucket>({
  max: 1000,
  ttl: 60 * 1000, // 1 minute window
});

const highUsageLog = new LRUCache<string, number>({
  max: 100,
  ttl: 5 * 60 * 1000, // 5 minutes
});

/**
 * Rate limit with burst support
 * @param shop Shop domain
 * @param sustainedLimit Requests per minute (default 100)
 * @param burstLimit Requests per 10 seconds (default 40)
 */
export async function rateLimit(
  shop: string,
  sustainedLimit = 100,
  burstLimit = 40
): Promise<{ remaining: number; reset: string; burst: boolean }> {
  const key = `rate-limit:${shop}`;
  const now = Date.now();
  const burstWindow = 10 * 1000; // 10 seconds
  const sustainedWindow = 60 * 1000; // 1 minute

  const bucket = rateLimitCache.get(key) || {
    burstCount: 0,
    burstReset: now + burstWindow,
    sustainedCount: 0,
    sustainedReset: now + sustainedWindow,
  };

  // Reset burst counter if window expired
  if (now >= bucket.burstReset) {
    bucket.burstCount = 0;
    bucket.burstReset = now + burstWindow;
  }

  // Reset sustained counter if window expired
  if (now >= bucket.sustainedReset) {
    bucket.sustainedCount = 0;
    bucket.sustainedReset = now + sustainedWindow;
  }

  // Check burst limit (10-second window)
  if (bucket.burstCount >= burstLimit) {
    logRateLimitExceeded(shop, 'burst', 'burst-limit');
    throw new Response('Too Many Requests (burst limit)', {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((bucket.burstReset - now) / 1000).toString(),
        'X-RateLimit-Limit': `${burstLimit}/10s`,
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(bucket.burstReset).toISOString(),
      },
    });
  }

  // Check sustained limit (60-second window)
  if (bucket.sustainedCount >= sustainedLimit) {
    logRateLimitExceeded(shop, 'sustained', 'sustained-limit');
    throw new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((bucket.sustainedReset - now) / 1000).toString(),
        'X-RateLimit-Limit': `${sustainedLimit}/60s`,
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(bucket.sustainedReset).toISOString(),
      },
    });
  }

  // Increment both counters
  bucket.burstCount++;
  bucket.sustainedCount++;
  rateLimitCache.set(key, bucket);

  // Log high usage (above 200 rpm threshold)
  if (bucket.sustainedCount > (sustainedLimit * 0.4) && !highUsageLog.has(shop)) {
    console.warn(`[Rate Limit] High usage detected for shop: ${shop} (${bucket.sustainedCount}/${sustainedLimit} requests)`);
    highUsageLog.set(shop, bucket.sustainedCount);
  }

  return {
    remaining: sustainedLimit - bucket.sustainedCount,
    reset: new Date(bucket.sustainedReset).toISOString(),
    burst: bucket.burstCount > (burstLimit * 0.7), // Burst warning at 70%
  };
}

/**
 * Rate limit by IP address (for unauthenticated endpoints)
 */
export async function rateLimitByIP(ip: string, limit = 10): Promise<void> {
  const key = `rate-limit-ip:${ip}`;
  const now = Date.now();
  const window = 60 * 1000;

  const bucket = rateLimitCache.get(key) || {
    burstCount: 0,
    burstReset: now,
    sustainedCount: 0,
    sustainedReset: now + window,
  };

  if (now >= bucket.sustainedReset) {
    bucket.sustainedCount = 0;
    bucket.sustainedReset = now + window;
  }

  if (bucket.sustainedCount >= limit) {
    logRateLimitExceeded('unknown', ip, 'ip-limit');
    throw new Response('Too Many Requests from IP', {
      status: 429,
      headers: {
        'Retry-After': '60',
      },
    });
  }

  bucket.sustainedCount++;
  rateLimitCache.set(key, bucket);
}

/**
 * Rate limit for cron jobs (per endpoint, not per shop)
 * Prevents runaway cron jobs from overloading the system
 */
export async function rateLimitCron(endpoint: string, limit = 10): Promise<void> {
  const key = `rate-limit-cron:${endpoint}`;
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour window

  const bucket = rateLimitCache.get(key) || {
    burstCount: 0,
    burstReset: now,
    sustainedCount: 0,
    sustainedReset: now + window,
  };

  if (now >= bucket.sustainedReset) {
    bucket.sustainedCount = 0;
    bucket.sustainedReset = now + window;
  }

  if (bucket.sustainedCount >= limit) {
    console.error(`[Cron Rate Limit] Endpoint ${endpoint} exceeded limit: ${limit} runs/hour`);
    throw new Response('Cron job rate limit exceeded', {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((bucket.sustainedReset - now) / 1000).toString(),
      },
    });
  }

  bucket.sustainedCount++;
  rateLimitCache.set(key, bucket);
}

/**
 * Check request payload size
 * Prevents large payloads from consuming memory/bandwidth
 */
export function checkRequestSize(request: Request, maxSize = 10 * 1024 * 1024): void {
  const contentLength = request.headers.get('content-length');

  if (contentLength) {
    const size = parseInt(contentLength, 10);

    if (size > maxSize) {
      console.warn(`[Request Size] Rejected large request: ${size} bytes (max: ${maxSize})`);
      throw new Response('Payload Too Large', {
        status: 413,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }
}

/**
 * Combined rate limit check for convenience
 * Checks both shop-based rate limiting and request size
 */
export async function rateLimitRequest(
  request: Request,
  shop: string,
  options: {
    sustainedLimit?: number;
    burstLimit?: number;
    maxRequests?: number; // alias for sustainedLimit
    burstMax?: number; // alias for burstLimit
    maxSize?: number;
  } = {}
): Promise<{ remaining: number; reset: string; burst: boolean }> {
  const {
    sustainedLimit,
    burstLimit,
    maxRequests,
    burstMax,
    maxSize = 10 * 1024 * 1024,
  } = options;

  // Support legacy option names (maxRequests/burstMax) and prefer explicit sustainedLimit/burstLimit
  const sustained = sustainedLimit ?? maxRequests ?? 100;
  const burst = burstLimit ?? burstMax ?? 40;

  // Check request size first (cheaper check)
  checkRequestSize(request, maxSize);

  // Then check rate limiting
  return rateLimit(shop, sustained, burst);
}
