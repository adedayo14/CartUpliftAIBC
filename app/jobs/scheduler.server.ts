import { runDailyLearningForAllShops } from "./daily-learning.server";

/**
 * 🕐 JOB SCHEDULER
 * 
 * Runs background jobs on schedule.
 * 
 * For Vercel deployment, use Vercel Cron Jobs:
 * https://vercel.com/docs/cron-jobs
 * 
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/daily-learning",
 *     "schedule": "0 2 * * *"
 *   }]
 * }
 */

// For local development or self-hosted deployment
export function setupCronJobs() {
  // Note: Vercel doesn't support long-running Node processes
  // Use Vercel Cron Jobs instead for production
  
  console.log('📅 Cron jobs would be set up here for self-hosted deployment');
  console.log('   For Vercel: Use vercel.json cron configuration');
  console.log('   For Railway/Render: Use node-cron package');
}

// Manual trigger for testing
export async function triggerDailyLearning() {
  console.log('🔄 Manually triggering daily learning...');
  return await runDailyLearningForAllShops();
}
