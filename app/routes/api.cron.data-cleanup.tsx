import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { cleanupOldData } from "../jobs/data-cleanup.server";

/**
 * Cron endpoint for data retention cleanup
 * GET /api/cron/data-cleanup (from Vercel Cron with Authorization header)
 * GET /api/cron/data-cleanup?secret=ADMIN_SECRET (manual trigger)
 *
 * Set up in Vercel cron:
 * - Schedule: Daily at 1 AM UTC (0 1 * * *)
 * - Path: /api/cron/data-cleanup
 * - Vercel automatically adds: Authorization: Bearer CRON_SECRET
 *
 * Security: Vercel cron uses CRON_SECRET header for authentication
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Check for Vercel cron authorization header first
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (authHeader === `Bearer ${cronSecret}`) {
      // Authorized Vercel cron request
      console.log("[Data Cleanup] Starting scheduled data cleanup...");
      const startTime = Date.now();

      const result = await cleanupOldData();

      const duration = Date.now() - startTime;
      console.log(`[Data Cleanup] Completed in ${duration}ms`, result);

      return json({
        success: true,
        duration_ms: duration,
        shops_processed: result.shopsProcessed,
        records_deleted: result.totalDeleted,
        breakdown: result.breakdown,
        timestamp: new Date().toISOString(),
      });
    }

    // Check for admin secret in query params (for manual testing)
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");

    if (secret !== process.env.ADMIN_SECRET) {
      console.warn("[Data Cleanup] Unauthorized attempt");
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[Data Cleanup] Manual trigger via GET");
    const startTime = Date.now();
    const result = await cleanupOldData();
    const duration = Date.now() - startTime;

    return json({
      success: true,
      duration_ms: duration,
      shops_processed: result.shopsProcessed,
      records_deleted: result.totalDeleted,
      breakdown: result.breakdown,
      timestamp: new Date().toISOString(),
      trigger: "manual"
    });
  } catch (error) {
    console.error("[Data Cleanup] Failed:", error);
    return json(
      {
        error: "Data cleanup failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
