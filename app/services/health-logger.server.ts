/**
 * ============================================================================
 * ML SYSTEM HEALTH LOGGER
 * ============================================================================
 * 
 * Utility for logging ML job execution to MLSystemHealth table.
 * Used by all ML jobs to track performance and errors for dashboard display.
 * 
 * Usage:
 * ```typescript
 * const logger = await startHealthLog(shop, 'daily_learning', 'cron');
 * try {
 *   // ... job logic
 *   await logger.success({ recordsProcessed: 100, recordsUpdated: 50 });
 * } catch (error) {
 *   await logger.failure(error);
 * }
 * ```
 */

import prisma from "~/db.server";

interface HealthLogResult {
  recordsProcessed?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsDeleted?: number;
  errorCount?: number;
  metadata?: Record<string, unknown>;
}

interface ErrorDetails {
  message: string;
  details?: unknown;
}

export class HealthLogger {
  private healthId: string;
  private shop: string;
  private startTime: Date;
  private errors: ErrorDetails[] = [];

  constructor(healthId: string, shop: string) {
    this.healthId = healthId;
    this.shop = shop;
    this.startTime = new Date();
  }

  /**
   * Log an error without failing the job
   */
  async logError(error: Error | string, details?: unknown) {
    const errorMessage = error instanceof Error ? error.message : error;
    this.errors.push({ message: errorMessage, details });
    
    console.error(`❌ [HEALTH] ${this.shop}: ${errorMessage}`, details);
  }

  /**
   * Mark job as successful and log final metrics
   */
  async success(result: HealthLogResult = {}) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startTime.getTime();

    try {
      await prisma.mLSystemHealth.update({
        where: { id: this.healthId },
        data: {
          status: this.errors.length > 0 ? 'partial' : 'success',
          completedAt,
          durationMs,
          recordsProcessed: result.recordsProcessed || 0,
          recordsCreated: result.recordsCreated || 0,
          recordsUpdated: result.recordsUpdated || 0,
          recordsDeleted: result.recordsDeleted || 0,
          errorCount: this.errors.length,
          errorMessage: this.errors[0]?.message,
          errorDetails: this.errors.length > 0 ? this.errors : undefined,
          metadata: result.metadata
        }
      });

      const status = this.errors.length > 0 ? '⚠️  PARTIAL' : '✅ SUCCESS';
      console.log(`${status} [HEALTH] ${this.shop}: Completed in ${durationMs}ms`);
    } catch (error) {
      console.error('Failed to log health success:', error);
    }
  }

  /**
   * Mark job as failed
   */
  async failure(error: Error | string, result: HealthLogResult = {}) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - this.startTime.getTime();
    const errorMessage = error instanceof Error ? error.message : error;

    // Add the fatal error to the list
    this.errors.push({
      message: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    });

    try {
      await prisma.mLSystemHealth.update({
        where: { id: this.healthId },
        data: {
          status: 'failed',
          completedAt,
          durationMs,
          recordsProcessed: result.recordsProcessed || 0,
          recordsCreated: result.recordsCreated || 0,
          recordsUpdated: result.recordsUpdated || 0,
          recordsDeleted: result.recordsDeleted || 0,
          errorCount: this.errors.length,
          errorMessage: errorMessage,
          errorDetails: this.errors,
          metadata: result.metadata
        }
      });

      console.error(`❌ FAILED [HEALTH] ${this.shop}: ${errorMessage} (${durationMs}ms)`);
    } catch (logError) {
      console.error('Failed to log health failure:', logError);
    }
  }
}

/**
 * Start a new health log for a job
 */
export async function startHealthLog(
  shop: string,
  jobType: 'daily_learning' | 'similarity_computation' | 'profile_update',
  triggeredBy: 'cron' | 'manual' | 'webhook' = 'cron'
): Promise<HealthLogger> {
  const startedAt = new Date();

  const health = await prisma.mLSystemHealth.create({
    data: {
      storeHash: shop,
      jobType,
      status: 'running',
      startedAt,
      triggeredBy
    }
  });

  console.log(`🏥 [HEALTH] Started ${jobType} for ${shop} (ID: ${health.id})`);

  return new HealthLogger(health.id, shop);
}

/**
 * Get recent health logs for dashboard display
 */
export async function getRecentHealthLogs(shop: string, limit = 50) {
  return await prisma.mLSystemHealth.findMany({
    where: { storeHash: shop },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

/**
 * Get health summary for dashboard
 */
export async function getHealthSummary(shop: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const logs = await prisma.mLSystemHealth.findMany({
    where: {
      storeHash: shop,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: 'desc' }
  });

  const summary = {
    totalRuns: logs.length,
    successfulRuns: logs.filter(l => l.status === 'success').length,
    failedRuns: logs.filter(l => l.status === 'failed').length,
    partialRuns: logs.filter(l => l.status === 'partial').length,
    avgDurationMs: logs.reduce((sum, l) => sum + (l.durationMs || 0), 0) / Math.max(logs.length, 1),
    totalErrors: logs.reduce((sum, l) => sum + l.errorCount, 0),
    byJobType: {} as Record<string, { runs: number; errors: number; avgDurationMs: number }>
  };

  // Group by job type
  for (const log of logs) {
    if (!summary.byJobType[log.jobType]) {
      summary.byJobType[log.jobType] = { runs: 0, errors: 0, avgDurationMs: 0 };
    }
    const jobSummary = summary.byJobType[log.jobType];
    jobSummary.runs++;
    jobSummary.errors += log.errorCount;
    jobSummary.avgDurationMs += (log.durationMs || 0);
  }

  // Calculate averages
  for (const jobType in summary.byJobType) {
    const jobSummary = summary.byJobType[jobType];
    jobSummary.avgDurationMs = jobSummary.avgDurationMs / Math.max(jobSummary.runs, 1);
  }

  return summary;
}
