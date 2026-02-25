// Phase 6: Real Analytics Dashboard - Replace mock with BigCommerce data
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prisma from "../db.server";
import type { AnalyticsEventModel } from "~/types/prisma";


interface RealtimeMetrics {
  activeUsers: number;
  recentPurchases: number;
  liveRevenue: number;
}

interface Trends {
  revenueChange: number;
  conversionChange: number;
  aovChange: number;
  orderChange: number;
}

interface GeographicData {
  country: string;
  orders: number;
  revenue: number;
}

interface DeviceBreakdown {
  device: string;
  count: number;
}

interface BundleStatMap {
  bundleId: string;
  bundleName: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  source: 'ml' | 'manual' | 'rules';
}

interface AnalyticsPeriod {
  start: string;
  end: string;
}

interface CartMetrics {
  totalCarts: number;
  completedOrders: number;
  conversionRate: number;
  averageOrderValue: number;
  totalRevenue: number;
  cartAbandonmentRate: number;
  upliftRevenue: number;
  bundlePerformance: BundleMetrics[];
}

interface BundleMetrics {
  bundleId: string;
  bundleName: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  clickThroughRate: number;
  conversionRate: number;
  source: 'ml' | 'manual' | 'rules';
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, storeHash } = await authenticateAdmin(request);

// SECURITY: Rate limiting - 50 requests per minute (analytics aggregation)
const rateLimitResult = await rateLimitRequest(request, storeHash, {
  maxRequests: 50,
  windowMs: 60 * 1000,
  burstMax: 25,
  burstWindowMs: 10 * 1000,
});

if (!rateLimitResult.allowed) {
  return json(
    { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
    { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
  );
}
const url = new URL(request.url);
  
  const period = url.searchParams.get("period") || "30d";
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  
  try {
    // Calculate date range
    const dateRange = calculateDateRange(period, startDate, endDate);
    
    // Store-level order metrics derived from our AnalyticsEvent table
    const storeAnalytics = await prisma.analyticsEvent.findMany({
      where: {
        shop: storeHash,
        eventType: 'purchase',
        timestamp: {
          gte: new Date(dateRange.start),
          lte: new Date(dateRange.end),
        },
      },
    });

    const totalOrders = storeAnalytics.length;
    const totalRevenue = storeAnalytics.reduce((sum: number, a: AnalyticsEventModel) => sum + (a.orderValue || 0), 0);
    const storeMetrics = {
      totalOrders,
      totalRevenue,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      completedOrders: totalOrders,
    };

    // Get cart uplift analytics from our database
    const cartAnalytics = await getCartAnalytics(storeHash, dateRange);

    // Get bundle performance data
    const bundleMetrics = await getBundleAnalytics(storeHash, dateRange);

    // Get real-time metrics for dashboard
    const realtimeMetrics = await getRealtimeMetrics(storeHash);

    // Combine all metrics
    const analytics = {
      period: dateRange,
      storeMetrics,
      cartMetrics: cartAnalytics,
      bundleMetrics,
      realtimeMetrics,
      trends: await calculateTrends(storeHash, dateRange),
      geographic: await getGeographicData(storeHash, dateRange),
      deviceBreakdown: await getDeviceBreakdown(storeHash, dateRange)
    };

    return json(analytics);

  } catch (error: unknown) {
    console.error("Analytics error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to load analytics";
    return json({
      error: errorMessage,
      analytics: null
    }, { status: 500 });
  }
};

// Get cart analytics from our database
async function getCartAnalytics(shop: string, dateRange: AnalyticsPeriod): Promise<CartMetrics> {
  try {
    // Query AnalyticsEvent model for real cart tracking data
    const analytics = await prisma.analyticsEvent.findMany({
      where: {
        storeHash: shop,
        timestamp: {
          gte: new Date(dateRange.start),
          lte: new Date(dateRange.end)
        }
      },
      orderBy: { timestamp: 'desc' }
    });

    const cartViews = analytics.filter((a: AnalyticsEventModel) => a.eventType === 'cart_view');
    const purchases = analytics.filter((a: AnalyticsEventModel) => a.eventType === 'purchase');
    const bundleConversions = analytics.filter((a: AnalyticsEventModel) =>
      a.eventType === 'bundle_conversion' && a.bundleId);

    const totalRevenue = purchases.reduce((sum: number, p: AnalyticsEventModel) => sum + (p.orderValue || 0), 0);
    const upliftRevenue = bundleConversions.reduce((sum: number, p: AnalyticsEventModel) => sum + (p.orderValue || 0), 0);

    return {
      totalCarts: cartViews.length,
      completedOrders: purchases.length,
      conversionRate: cartViews.length > 0 ? (purchases.length / cartViews.length) * 100 : 0,
      averageOrderValue: purchases.length > 0 ? totalRevenue / purchases.length : 0,
      totalRevenue,
      cartAbandonmentRate: cartViews.length > 0 ? 
        ((cartViews.length - purchases.length) / cartViews.length) * 100 : 0,
      upliftRevenue,
      bundlePerformance: await getBundleMetrics(analytics)
    };
  } catch (error: unknown) {
    console.error("Cart analytics error:", error);
    return {
      totalCarts: 0,
      completedOrders: 0,
      conversionRate: 0,
      averageOrderValue: 0,
      totalRevenue: 0,
      cartAbandonmentRate: 0,
      upliftRevenue: 0,
      bundlePerformance: []
    };
  }
}

async function getBundleMetrics(analytics: AnalyticsEventModel[]): Promise<BundleMetrics[]> {
  const bundleStats = new Map<string, BundleStatMap>();

  // Group by bundle ID
  analytics.forEach(record => {
    if (!record.bundleId) return;

    if (!bundleStats.has(record.bundleId)) {
      bundleStats.set(record.bundleId, {
        bundleId: record.bundleId,
        bundleName: record.bundleName || `Bundle ${record.bundleId}`,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        source: record.bundleSource || 'ml'
      });
    }

    const stats = bundleStats.get(record.bundleId);

    switch (record.eventType) {
      case 'bundle_impression':
        stats.impressions++;
        break;
      case 'bundle_click':
        stats.clicks++;
        break;
      case 'purchase':
        if (record.bundleId) {
          stats.conversions++;
          stats.revenue += record.orderValue || 0;
        }
        break;
    }
  });

  // Calculate rates
  return Array.from(bundleStats.values()).map((stats: BundleStatMap): BundleMetrics => ({
    ...stats,
    clickThroughRate: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0,
    conversionRate: stats.clicks > 0 ? (stats.conversions / stats.clicks) * 100 : 0
  }));
}

async function getBundleAnalytics(shop: string, dateRange: AnalyticsPeriod): Promise<BundleMetrics[]> {
  try {
    const bundleAnalytics = await prisma.analyticsEvent.findMany({
      where: {
        storeHash: shop,
        bundleId: { not: null },
        timestamp: {
          gte: new Date(dateRange.start),
          lte: new Date(dateRange.end),
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    return getBundleMetrics(bundleAnalytics);
  } catch (error: unknown) {
    console.error("Bundle analytics error:", error);
    return [];
  }
}

async function getRealtimeMetrics(shop: string): Promise<RealtimeMetrics> {
  try {
    // Query events from the last 30 minutes for real-time data
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const recentAnalytics = await prisma.analyticsEvent.findMany({
      where: {
        storeHash: shop,
        timestamp: { gte: thirtyMinutesAgo },
      },
      orderBy: { timestamp: 'desc' },
    });

    return {
      activeUsers: new Set(recentAnalytics.map((a: AnalyticsEventModel) => a.sessionId)).size,
      recentPurchases: recentAnalytics.filter((a: AnalyticsEventModel) => a.eventType === 'purchase').length,
      liveRevenue: recentAnalytics
        .filter((a: AnalyticsEventModel) => a.eventType === 'purchase')
        .reduce((sum: number, a: AnalyticsEventModel) => sum + (a.orderValue || 0), 0)
    };
  } catch (error: unknown) {
    console.error("Realtime metrics error:", error);
    return { activeUsers: 0, recentPurchases: 0, liveRevenue: 0 };
  }
}

async function calculateTrends(shop: string, dateRange: AnalyticsPeriod): Promise<Trends> {
  // Calculate trends by comparing current period with previous period
  const periodDuration = new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime();
  const previousPeriodStart = new Date(new Date(dateRange.start).getTime() - periodDuration);
  const previousPeriodEnd = new Date(dateRange.start);

  try {
    const [currentPeriod, previousPeriod] = await Promise.all([
      getCartAnalytics(shop, dateRange),
      getCartAnalytics(shop, { 
        start: previousPeriodStart.toISOString(), 
        end: previousPeriodEnd.toISOString() 
      })
    ]);

    return {
      revenueChange: calculatePercentageChange(currentPeriod.totalRevenue, previousPeriod.totalRevenue),
      conversionChange: calculatePercentageChange(currentPeriod.conversionRate, previousPeriod.conversionRate),
      aovChange: calculatePercentageChange(currentPeriod.averageOrderValue, previousPeriod.averageOrderValue),
      orderChange: calculatePercentageChange(currentPeriod.completedOrders, previousPeriod.completedOrders)
    };
  } catch (error: unknown) {
    console.error("Trends calculation error:", error);
    return { revenueChange: 0, conversionChange: 0, aovChange: 0, orderChange: 0 };
  }
}

async function getGeographicData(shop: string, dateRange: AnalyticsPeriod): Promise<GeographicData[]> {
  try {
    const analytics = await prisma.analyticsEvent.findMany({
      where: {
        storeHash: shop,
        eventType: 'purchase',
        timestamp: {
          gte: new Date(dateRange.start),
          lte: new Date(dateRange.end),
        },
      },
    });

    // Group by country from event metadata
    const geoStats = analytics.reduce((acc: Record<string, { orders: number; revenue: number }>, record: AnalyticsEventModel) => {
      const country = (record as unknown as { country?: string }).country || 'Unknown';
      if (!acc[country]) acc[country] = { orders: 0, revenue: 0 };
      acc[country].orders++;
      acc[country].revenue += record.orderValue || 0;
      return acc;
    }, {} as Record<string, { orders: number; revenue: number }>);

    return Object.entries(geoStats).map(([country, stats]): GeographicData => ({
      country,
      orders: stats.orders,
      revenue: stats.revenue,
    }));
  } catch (error: unknown) {
    console.error("Geographic data error:", error);
    return [];
  }
}

async function getDeviceBreakdown(shop: string, dateRange: AnalyticsPeriod): Promise<DeviceBreakdown[]> {
  try {
    const analytics = await prisma.analyticsEvent.findMany({
      where: {
        storeHash: shop,
        timestamp: {
          gte: new Date(dateRange.start),
          lte: new Date(dateRange.end),
        },
      },
    });

    // Group by device type
    const deviceStats = analytics.reduce((acc: Record<string, number>, record: AnalyticsEventModel) => {
      const device = (record as unknown as { deviceType?: string }).deviceType || 'Unknown';
      if (!acc[device]) acc[device] = 0;
      acc[device]++;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(deviceStats).map(([device, count]): DeviceBreakdown => ({ device, count }));
  } catch (error: unknown) {
    console.error("Device breakdown error:", error);
    return [];
  }
}

// Helper functions
function calculateDateRange(period: string, startDate?: string | null, endDate?: string | null): AnalyticsPeriod {
  const now = new Date();
  
  if (startDate && endDate) {
    return { start: startDate, end: endDate };
  }
  
  switch (period) {
    case '7d':
      return {
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: now.toISOString()
      };
    case '30d':
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: now.toISOString()
      };
    case '90d':
      return {
        start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        end: now.toISOString()
      };
    default:
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: now.toISOString()
      };
  }
}

function calculatePercentageChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

