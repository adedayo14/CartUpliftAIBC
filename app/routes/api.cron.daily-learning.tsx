import { json, type ActionFunctionArgs } from "@remix-run/node";
import { runDailyLearningForAllShops } from "~/jobs/daily-learning.server";
import { rateLimitCron } from "~/utils/rateLimiter.server";

/**
 * 🕐 VERCEL CRON ENDPOINT
 * 
 * Triggered by Vercel Cron Jobs daily at 2 AM
 * 
 * Security: Verify CRON_SECRET to prevent unauthorized access
 */

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Verify cron secret (Vercel automatically adds this header)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('⚠️ Unauthorized cron attempt');
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Phase 3: Cron rate limiting (10 runs per hour)
    try {
      await rateLimitCron('daily-learning', 10);
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.error('[Cron] Daily learning rate limit exceeded');
        return error;
      }
      throw error;
    }

    console.log('🕐 Cron job triggered: daily-learning');

    const results = await runDailyLearningForAllShops();
    
    return json({
      success: true,
      message: 'Daily learning completed',
      results
    });
    
  } catch (error) {
    console.error('❌ Cron job failed:', error);
    return json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

// GET endpoint for Vercel Cron and manual triggering
export async function loader({ request }: ActionFunctionArgs) {
  try {
    // Check for Vercel cron authorization header first
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (authHeader === `Bearer ${cronSecret}`) {
      // Authorized Vercel cron request
      console.log('🕐 Cron job triggered: daily-learning');

      // Phase 3: Cron rate limiting (10 runs per hour)
      try {
        await rateLimitCron('daily-learning', 10);
      } catch (error) {
        if (error instanceof Response && error.status === 429) {
          console.error('[Cron] Daily learning rate limit exceeded');
          return error;
        }
        throw error;
      }

      const results = await runDailyLearningForAllShops();
      return json({
        success: true,
        message: 'Daily learning completed',
        results
      });
    }

    // Check for admin secret for manual testing
    const url = new URL(request.url);
    const secret = url.searchParams.get('secret');

    if (secret !== process.env.ADMIN_SECRET) {
      console.warn('⚠️ Unauthorized cron attempt');
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔄 Manual trigger: daily-learning');
    const results = await runDailyLearningForAllShops();

    return json({
      success: true,
      message: 'Daily learning completed (manual trigger)',
      results
    });
  } catch (error) {
    console.error('❌ Cron job failed:', error);
    return json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
