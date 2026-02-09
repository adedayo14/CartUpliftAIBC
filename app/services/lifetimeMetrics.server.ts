/**
 * Lifetime Metrics Service
 *
 * Tracks all-time performance metrics that never reset.
 * Used for analytics, churn prevention, and celebrating merchant success.
 */

import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export interface LifetimeMetricsData {
  shop: string;
  totalOrders: number;
  totalRevenue: number;
  totalAttributedOrders: number;
  totalAttributedRevenue: number;
  totalCartOpens: number;
  totalRecImpressions: number;
  totalRecClicks: number;
  totalBundleViews: number;
  totalBundleAdds: number;
  firstOrderAt: Date | null;
  appInstalledAt: Date;
  daysSinceInstall: number;
}

/**
 * Get or create lifetime metrics for a shop
 */
export async function getOrCreateLifetimeMetrics(shop: string): Promise<LifetimeMetricsData> {
  try {
    let metrics = await prisma.lifetimeMetrics.findUnique({
      where: { shop },
    });

    if (!metrics) {
      metrics = await prisma.lifetimeMetrics.create({
        data: {
          shop,
          appInstalledAt: new Date(),
        },
      });
      logger.info("Created lifetime metrics for shop", { shop });
    }

    const daysSinceInstall = Math.floor(
      (Date.now() - metrics.appInstalledAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      shop: metrics.shop,
      totalOrders: metrics.totalOrders,
      totalRevenue: metrics.totalRevenue,
      totalAttributedOrders: metrics.totalAttributedOrders,
      totalAttributedRevenue: metrics.totalAttributedRevenue,
      totalCartOpens: metrics.totalCartOpens,
      totalRecImpressions: metrics.totalRecImpressions,
      totalRecClicks: metrics.totalRecClicks,
      totalBundleViews: metrics.totalBundleViews,
      totalBundleAdds: metrics.totalBundleAdds,
      firstOrderAt: metrics.firstOrderAt,
      appInstalledAt: metrics.appInstalledAt,
      daysSinceInstall,
    };
  } catch (error) {
    logger.error("Failed to get lifetime metrics - table may not exist yet", { shop, error });
    // Return default values if table doesn't exist
    return {
      shop,
      totalOrders: 0,
      totalRevenue: 0,
      totalAttributedOrders: 0,
      totalAttributedRevenue: 0,
      totalCartOpens: 0,
      totalRecImpressions: 0,
      totalRecClicks: 0,
      totalBundleViews: 0,
      totalBundleAdds: 0,
      firstOrderAt: null,
      appInstalledAt: new Date(),
      daysSinceInstall: 0,
    };
  }
}

/**
 * Increment total orders and check for milestones
 */
export async function incrementLifetimeOrders(
  shop: string,
  totalRevenue: number = 0,
  attributedRevenue: number = 0
): Promise<void> {
  try {
    const metrics = await prisma.lifetimeMetrics.findUnique({
      where: { shop },
    });

    if (!metrics) {
      await getOrCreateLifetimeMetrics(shop);
    }

    const newTotalOrders = (metrics?.totalOrders || 0) + 1;
    const newTotalRevenue = (metrics?.totalRevenue || 0) + totalRevenue;
    const newAttributedOrders = attributedRevenue > 0
      ? (metrics?.totalAttributedOrders || 0) + 1
      : (metrics?.totalAttributedOrders || 0);
    const newAttributedRevenue = (metrics?.totalAttributedRevenue || 0) + attributedRevenue;

    const updateData: Record<string, unknown> = {
      totalOrders: newTotalOrders,
      totalRevenue: newTotalRevenue,
      totalAttributedOrders: newAttributedOrders,
      totalAttributedRevenue: newAttributedRevenue,
    };

    // Set firstOrderAt if this is the first order
    if (!metrics?.firstOrderAt) {
      updateData.firstOrderAt = new Date();
    }

    // Check for milestones
    if (newTotalOrders >= 1000 && !metrics?.milestone1000Orders) {
      updateData.milestone1000Orders = new Date();
      logger.info("🎉 Milestone: 1,000 orders!", { shop });
    }
    if (newTotalOrders >= 10000 && !metrics?.milestone10000Orders) {
      updateData.milestone10000Orders = new Date();
      logger.info("🎉 Milestone: 10,000 orders!", { shop });
    }
    if (newTotalOrders >= 100000 && !metrics?.milestone100000Orders) {
      updateData.milestone100000Orders = new Date();
      logger.info("🎉 Milestone: 100,000 orders!", { shop });
    }

    await prisma.lifetimeMetrics.update({
      where: { shop },
      data: updateData,
    });
  } catch (error) {
    logger.error("Failed to increment lifetime orders", { shop, error });
  }
}

/**
 * Increment engagement metrics
 */
export async function incrementLifetimeEngagement(
  shop: string,
  metric: 'cartOpens' | 'recImpressions' | 'recClicks' | 'bundleViews' | 'bundleAdds',
  count: number = 1
): Promise<void> {
  try {
    const metrics = await prisma.lifetimeMetrics.findUnique({
      where: { shop },
    });

    if (!metrics) {
      await getOrCreateLifetimeMetrics(shop);
    }

    const fieldMap = {
      cartOpens: 'totalCartOpens',
      recImpressions: 'totalRecImpressions',
      recClicks: 'totalRecClicks',
      bundleViews: 'totalBundleViews',
      bundleAdds: 'totalBundleAdds',
    };

    const field = fieldMap[metric];
    const currentValue = metrics?.[field as keyof typeof metrics] as number || 0;

    await prisma.lifetimeMetrics.update({
      where: { shop },
      data: {
        [field]: currentValue + count,
      },
    });
  } catch (error) {
    logger.error("Failed to increment lifetime engagement", { shop, metric, error });
  }
}

/**
 * Get lifetime metrics with formatted values
 */
export async function getLifetimeMetricsFormatted(shop: string) {
  const metrics = await getOrCreateLifetimeMetrics(shop);

  return {
    ...metrics,
    totalRevenueFormatted: `$${metrics.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    totalAttributedRevenueFormatted: `$${metrics.totalAttributedRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    conversionRate: metrics.totalRecClicks > 0
      ? ((metrics.totalAttributedOrders / metrics.totalRecClicks) * 100).toFixed(2) + '%'
      : '0%',
  };
}
