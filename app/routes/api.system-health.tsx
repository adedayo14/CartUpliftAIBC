/**
 * ============================================================================
 * SYSTEM HEALTH API ENDPOINT
 * ============================================================================
 * 
 * Provides ML system health data for dashboard display.
 * Returns recent job runs, error rates, performance metrics.
 * 
 * Usage: GET /api/system-health?days=7
 * 
 * No external notifications - all data stored in database for dashboard.
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getHealthSummary, getRecentHealthLogs } from "~/services/health-logger.server";
import { authenticateAdmin } from "~/bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Authenticate merchant
    const { storeHash } = await authenticateAdmin(request);

    if (!storeHash) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '7', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const shop = storeHash;

    // SECURITY: Rate limiting - 50 requests per minute (health check aggregation)
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 50,
      windowMs: 60000,
      burstMax: 20,
      burstWindowMs: 10000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }
    
    // Get health summary
    const summary = await getHealthSummary(shop, days);
    
    // Get recent logs
    const recentLogs = await getRecentHealthLogs(shop, Math.min(limit, 100));
    
    // Calculate health score (0-100)
    const healthScore = summary.totalRuns === 0 ? 100 : Math.max(0, Math.min(100,
      100 - (summary.failedRuns / summary.totalRuns * 50) - (summary.totalErrors / summary.totalRuns * 10)
    ));
    
    // Determine system status
    let systemStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (summary.failedRuns / Math.max(summary.totalRuns, 1) > 0.5) {
      systemStatus = 'critical';
    } else if (summary.failedRuns / Math.max(summary.totalRuns, 1) > 0.2) {
      systemStatus = 'degraded';
    }
    
    // Format response
    const response = {
      health: {
        score: Math.round(healthScore),
        status: systemStatus,
        lastChecked: new Date().toISOString()
      },
      summary: {
        period: `Last ${days} days`,
        totalRuns: summary.totalRuns,
        successful: summary.successfulRuns,
        failed: summary.failedRuns,
        partial: summary.partialRuns,
        totalErrors: summary.totalErrors,
        avgDurationMs: Math.round(summary.avgDurationMs),
        successRate: summary.totalRuns > 0 
          ? Math.round((summary.successfulRuns / summary.totalRuns) * 100) 
          : 100
      },
      byJobType: Object.entries(summary.byJobType).map(([jobType, stats]) => ({
        jobType,
        runs: stats.runs,
        errors: stats.errors,
        avgDurationMs: Math.round(stats.avgDurationMs),
        errorRate: stats.runs > 0 ? Math.round((stats.errors / stats.runs) * 100) : 0
      })),
      recentLogs: recentLogs.map((log: unknown) => {
        const logRecord = log as Record<string, unknown>;
        return {
        id: logRecord.id,
        jobType: logRecord.jobType,
        status: logRecord.status,
        startedAt: logRecord.startedAt,
        completedAt: logRecord.completedAt,
        durationMs: logRecord.durationMs,
        recordsProcessed: logRecord.recordsProcessed,
        recordsCreated: logRecord.recordsCreated,
        recordsUpdated: logRecord.recordsUpdated,
        errorCount: logRecord.errorCount,
        errorMessage: logRecord.errorMessage,
        triggeredBy: logRecord.triggeredBy
        };
      })
    };
    
    return json(response, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    
  } catch (error) {
    console.error('[SYSTEM HEALTH API] Error:', error);
    return json({ 
      error: 'Failed to fetch system health',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
