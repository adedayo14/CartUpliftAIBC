/**
 * Security Audit Endpoint
 *
 * Admin-only endpoint that provides security metrics for the current shop
 * - Rate limit hits
 * - Request size violations
 * - Cron execution stats
 * - High usage warnings
 *
 * Access: Admin only (authenticated sessions)
 * Caching: 60 seconds to avoid performance impact
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { withAuth } from "../utils/auth.server";
import { getSecurityMetrics } from "../services/securityMonitor.server";

interface SecurityAuditResponse {
  shop: string;
  window_24h: {
    rateLimitHits: Record<string, number>;
    payloadTooLarge: number;
    corsRejections: number;
    cron: Record<string, {
      runs: number;
      rateLimitHits: number;
    }>;
    highUsageWarnings: number;
  };
  window_7d: {
    rateLimitHits: Record<string, number>;
    payloadTooLarge: number;
    corsRejections: number;
    cron: Record<string, {
      runs: number;
      rateLimitHits: number;
    }>;
    highUsageWarnings: number;
  };
  lastUpdated: string;
}

// Simple in-memory cache (60 seconds TTL)
const auditCache = new Map<string, { data: SecurityAuditResponse; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds

export const loader = withAuth(async ({ auth }) => {
  const shop = auth.storeHash;

  // Check cache first
  const cached = auditCache.get(shop);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return json(cached.data, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  // Get security metrics from monitoring service
  const metrics24h = await getSecurityMetrics(shop, '24h');
  const metrics7d = await getSecurityMetrics(shop, '7d');

  const response: SecurityAuditResponse = {
    shop,
    window_24h: {
      rateLimitHits: metrics24h.rateLimitHits,
      payloadTooLarge: metrics24h.payloadTooLarge,
      corsRejections: metrics24h.corsRejections,
      cron: metrics24h.cron,
      highUsageWarnings: metrics24h.highUsageWarnings,
    },
    window_7d: {
      rateLimitHits: metrics7d.rateLimitHits,
      payloadTooLarge: metrics7d.payloadTooLarge,
      corsRejections: metrics7d.corsRejections,
      cron: metrics7d.cron,
      highUsageWarnings: metrics7d.highUsageWarnings,
    },
    lastUpdated: new Date().toISOString(),
  };

  // Cache the response
  auditCache.set(shop, { data: response, timestamp: Date.now() });

  return json(response, {
    headers: {
      'Cache-Control': 'private, max-age=60',
    },
  });
});
