/**
 * Data retention cleanup job
 * Deletes old tracking and ML data based on shop-specific retention settings
 */

import prisma from "../db.server";
import { getSettings } from "../models/settings.server";

interface CleanupResult {
  shopsProcessed: number;
  totalDeleted: number;
  breakdown: {
    trackingEvents: number;
    analyticsEvents: number;
    userProfiles: number;
    productSimilarities: number;
  };
}

/**
 * Clean up old data across all shops based on their retention settings
 */
export async function cleanupOldData(): Promise<CleanupResult> {
  const result: CleanupResult = {
    shopsProcessed: 0,
    totalDeleted: 0,
    breakdown: {
      trackingEvents: 0,
      analyticsEvents: 0,
      userProfiles: 0,
      productSimilarities: 0,
    },
  };

  try {
    // Get all unique shops that have settings
    const shops = await prisma.settings.findMany({
      select: { shop: true, mlDataRetentionDays: true },
      distinct: ['shop'],
    });

    console.log(`[Data Cleanup] Processing ${shops.length} shops`);

    for (const shopConfig of shops) {
      const { shop, mlDataRetentionDays } = shopConfig;

      // Parse retention period (default 90 days if not set)
      const retentionDays = parseInt(String(mlDataRetentionDays || '90'), 10);

      if (isNaN(retentionDays) || retentionDays < 1) {
        console.warn(`[Data Cleanup] Invalid retention days for ${shop}: ${mlDataRetentionDays}`);
        continue;
      }

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      console.log(`[Data Cleanup] ${shop}: Deleting data older than ${cutoffDate.toISOString()} (${retentionDays} days)`);

      try {
        const shopStartTime = Date.now();

        // 1. Delete old tracking events
        const trackingDeleted = await prisma.trackingEvent.deleteMany({
          where: {
            shop,
            createdAt: {
              lt: cutoffDate,
            },
          },
        });

        // 2. Delete old analytics events
        const analyticsDeleted = await prisma.analyticsEvent.deleteMany({
          where: {
            shop,
            timestamp: {
              lt: cutoffDate,
            },
          },
        });

        // 3. Delete stale user profiles (not active recently)
        const profilesDeleted = await prisma.mLUserProfile.deleteMany({
          where: {
            shop,
            lastActivity: {
              lt: cutoffDate,
            },
          },
        });

        // 4. Delete stale product similarities (not computed recently)
        const similaritiesDeleted = await prisma.mLProductSimilarity.deleteMany({
          where: {
            shop,
            computedAt: {
              lt: cutoffDate,
            },
          },
        });

        const shopTotal =
          trackingDeleted.count +
          analyticsDeleted.count +
          profilesDeleted.count +
          similaritiesDeleted.count;

        result.breakdown.trackingEvents += trackingDeleted.count;
        result.breakdown.analyticsEvents += analyticsDeleted.count;
        result.breakdown.userProfiles += profilesDeleted.count;
        result.breakdown.productSimilarities += similaritiesDeleted.count;
        result.totalDeleted += shopTotal;

        console.log(`[Data Cleanup] ${shop}: Deleted ${shopTotal} records`, {
          tracking: trackingDeleted.count,
          analytics: analyticsDeleted.count,
          profiles: profilesDeleted.count,
          similarities: similaritiesDeleted.count,
        });

        // Record cleanup job completion
        await prisma.mLDataRetentionJob.create({
          data: {
            shop,
            jobType: "cleanup",
            status: "completed",
            dataType: "all",
            retentionDays,
            recordsDeleted: shopTotal,
            recordsProcessed: shopTotal,
            startedAt: new Date(shopStartTime),
            completedAt: new Date(),
          },
        });

        result.shopsProcessed++;
      } catch (shopError) {
        console.error(`[Data Cleanup] Error processing ${shop}:`, shopError);
        // Continue with next shop even if one fails
      }
    }

    console.log(`[Data Cleanup] Total: ${result.totalDeleted} records deleted across ${result.shopsProcessed} shops`);

    return result;
  } catch (error) {
    console.error('[Data Cleanup] Fatal error:', error);
    throw error;
  }
}

/**
 * Get cleanup statistics for a specific shop
 */
export async function getCleanupHistory(shop: string, limit = 10) {
  return await prisma.mLDataRetentionJob.findMany({
    where: { shop },
    orderBy: { completedAt: 'desc' },
    take: limit,
  });
}

/**
 * Estimate how many records would be deleted for a shop
 */
export async function estimateCleanup(shop: string, retentionDays: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const [tracking, analytics, profiles, similarities] = await Promise.all([
    prisma.trackingEvent.count({
      where: { shop, createdAt: { lt: cutoffDate } },
    }),
    prisma.analyticsEvent.count({
      where: { shop, timestamp: { lt: cutoffDate } },
    }),
    prisma.mLUserProfile.count({
      where: { shop, lastActivity: { lt: cutoffDate } },
    }),
    prisma.mLProductSimilarity.count({
      where: { shop, computedAt: { lt: cutoffDate } },
    }),
  ]);

  return {
    cutoffDate: cutoffDate.toISOString(),
    retentionDays,
    estimated: {
      trackingEvents: tracking,
      analyticsEvents: analytics,
      userProfiles: profiles,
      productSimilarities: similarities,
      total: tracking + analytics + profiles + similarities,
    },
  };
}
