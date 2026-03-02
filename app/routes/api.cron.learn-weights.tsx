import { json, type ActionFunctionArgs } from "@remix-run/node";
import { runWeightLearningForAllShops } from "~/jobs/weight-learning.server";
import { rateLimitCron } from "~/utils/rateLimiter.server";

/**
 * VERCEL CRON ENDPOINT - Weight Learning (Logistic Regression)
 *
 * Triggered by Vercel Cron Jobs daily at 2:15 AM
 * Learns optimal similarity weights from click/purchase feedback data.
 *
 * Security: Verify CRON_SECRET to prevent unauthorized access
 */

export async function action({ request }: ActionFunctionArgs) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn("[Cron] Unauthorized weight-learning attempt");
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      await rateLimitCron("weight-learning", 10);
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.error("[Cron] Weight learning rate limit exceeded");
        return error;
      }
      throw error;
    }

    console.log("[Cron] Weight learning triggered");
    const results = await runWeightLearningForAllShops();

    return json({
      success: true,
      message: "Weight learning completed",
      results,
    });
  } catch (error) {
    console.error("[Cron] Weight learning failed:", error);
    return json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// GET endpoint for Vercel Cron and manual triggering
export async function loader({ request }: ActionFunctionArgs) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (authHeader === `Bearer ${cronSecret}`) {
      console.log("[Cron] Weight learning triggered (cron)");

      try {
        await rateLimitCron("weight-learning", 10);
      } catch (error) {
        if (error instanceof Response && error.status === 429) {
          return error;
        }
        throw error;
      }

      const results = await runWeightLearningForAllShops();
      return json({
        success: true,
        message: "Weight learning completed",
        results,
      });
    }

    // Manual trigger via admin secret
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");

    if (secret !== process.env.ADMIN_SECRET) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[Cron] Weight learning triggered (manual)");
    const results = await runWeightLearningForAllShops();

    return json({
      success: true,
      message: "Weight learning completed (manual trigger)",
      results,
    });
  } catch (error) {
    console.error("[Cron] Weight learning failed:", error);
    return json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
