// Phase 6: Real Analytics Dashboard - Replace mock with Shopify data
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prisma from "../db.server";
import type { AnalyticsEventModel } from "~/types/prisma";

// Shopify Admin API client type
type ShopifyAdminClient = Awaited<ReturnType<typeof authenticate.admin>>['admin'];

// Shopify GraphQL types
interface ShopifyOrderNode {
  id: string;
  name: string;
  createdAt: string;
  totalPrice: string;
  subtotalPrice: string;
  totalTax: string;
  currencyCode: string;
  fulfillmentStatus: string;
  financialStatus: string;
  customer: {
    id: string;
    email: string;
  } | null;
  shippingAddress: {
    country: string;
    province: string;
    city: string;
  } | null;
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        quantity: number;
        product: {
          id: string;
          title: string;
          vendor: string;
        };
        variant: {
          id: string;
          title: string;
          price: string;
        };
      };
    }>;
  };
}

interface ShopifyOrderEdge {
  node: ShopifyOrderNode;
}

interface ShopifyOrdersResponse {
  data: {
    orders: {
      edges: ShopifyOrderEdge[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

interface ShopifyMetrics {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  completedOrders: number;
  topProducts: TopProduct[];
  ordersByDay: OrderByDay[];
  customerSegments: CustomerSegments;
}

interface TopProduct {
  id: string;
  title: string;
  vendor: string;
  quantity: number;
  revenue: number;
}

interface OrderByDay {
  date: string;
  orders: number;
  revenue: number;
}

interface CustomerSegments {
  newCustomers: number;
  returningCustomers: number;
  vipCustomers: number;
  totalCustomers: number;
}

interface CustomerStat {
  id: string;
  email: string;
  orders: number;
  revenue: number;
}

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
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

// SECURITY: Rate limiting - 50 requests per minute (analytics aggregation)
const rateLimitResult = await rateLimitRequest(request, shop, {
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
    
    // Get real Shopify order data
    const shopifyMetrics = await getShopifyOrderMetrics(admin, dateRange);
    
    // Get cart uplift analytics from our database
    const cartAnalytics = await getCartAnalytics(session.shop, dateRange);
    
    // Get bundle performance data
    const bundleMetrics = await getBundleAnalytics(session.shop, dateRange);
    
    // Get real-time metrics for dashboard
    const realtimeMetrics = await getRealtimeMetrics(session.shop);
    
    // Combine all metrics
    const analytics = {
      period: dateRange,
      shopifyMetrics,
      cartMetrics: cartAnalytics,
      bundleMetrics,
      realtimeMetrics,
      trends: await calculateTrends(session.shop, dateRange),
      geographic: await getGeographicData(admin, dateRange),
      deviceBreakdown: await getDeviceBreakdown(session.shop, dateRange)
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

// Get real order data from Shopify
async function getShopifyOrderMetrics(admin: ShopifyAdminClient, dateRange: AnalyticsPeriod): Promise<ShopifyMetrics> {
  const ordersQuery = `
    query getOrderMetrics($query: String!) {
      orders(first: 250, query: $query) {
        edges {
          node {
            id
            name
            createdAt
            totalPrice
            subtotalPrice
            totalTax
            currencyCode
            fulfillmentStatus
            financialStatus
            customer {
              id
              email
            }
            shippingAddress {
              country
              province
              city
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  quantity
                  product {
                    id
                    title
                    vendor
                  }
                  variant {
                    id
                    title
                    price
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(ordersQuery, {
      variables: {
        query: `created_at:>=${dateRange.start} created_at:<=${dateRange.end}`
      }
    });

    const data = await response.json() as ShopifyOrdersResponse;

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const orders = data.data.orders.edges.map(({ node }: ShopifyOrderEdge) => node);

    return {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum: number, order: ShopifyOrderNode) =>
        sum + parseFloat(order.totalPrice), 0),
      averageOrderValue: orders.length > 0 ?
        orders.reduce((sum: number, order: ShopifyOrderNode) => sum + parseFloat(order.totalPrice), 0) / orders.length : 0,
      completedOrders: orders.filter((order: ShopifyOrderNode) =>
        order.fulfillmentStatus === 'fulfilled' ||
        order.financialStatus === 'paid').length,
      topProducts: getTopProducts(orders),
      ordersByDay: getOrdersByDay(orders, dateRange),
      customerSegments: getCustomerSegments(orders)
    };
  } catch (error: unknown) {
    console.error("Shopify metrics error:", error);
    return {
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
      completedOrders: 0,
      topProducts: [],
      ordersByDay: [],
      customerSegments: []
    };
  }
}

// Get cart analytics from our database
async function getCartAnalytics(shop: string, dateRange: AnalyticsPeriod): Promise<CartMetrics> {
  try {
    // Query AnalyticsEvent model for real cart tracking data
    const analytics = await prisma.analyticsEvent.findMany({
      where: {
        shop,
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

async function getBundleAnalytics(_shop: string, _dateRange: AnalyticsPeriod): Promise<BundleMetrics[]> {
  try {
    // Get bundle performance data
    // Use empty array temporarily until ABEvent is properly set up
    const bundleAnalytics: AnalyticsEventModel[] = [];

    return getBundleMetrics(bundleAnalytics);
  } catch (error: unknown) {
    console.error("Bundle analytics error:", error);
    return [];
  }
}

async function getRealtimeMetrics(_shop: string): Promise<RealtimeMetrics> {
  try {
    // Use empty array temporarily until ABEvent is properly set up
    const recentAnalytics: AnalyticsEventModel[] = [];

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

async function getGeographicData(_admin: ShopifyAdminClient, _dateRange: AnalyticsPeriod): Promise<GeographicData[]> {
  // This would use Shopify's Analytics API if available
  // For now, return placeholder data
  return [
    { country: 'US', orders: 0, revenue: 0 },
    { country: 'CA', orders: 0, revenue: 0 },
    { country: 'GB', orders: 0, revenue: 0 }
  ];
}

async function getDeviceBreakdown(_shop: string, _dateRange: AnalyticsPeriod): Promise<DeviceBreakdown[]> {
  try {
    // Use Settings table temporarily until ABEvent is properly set up
    // This would be replaced with actual analytics data when the schema is updated
    const analytics: AnalyticsEventModel[] = [];
    // Group by device type if you track this data
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

function getTopProducts(orders: ShopifyOrderNode[]): TopProduct[] {
  const productStats = new Map<string, TopProduct>();

  orders.forEach(order => {
    order.lineItems.edges.forEach(({ node }) => {
      const productId = node.product.id;
      if (!productStats.has(productId)) {
        productStats.set(productId, {
          id: productId,
          title: node.product.title,
          vendor: node.product.vendor,
          quantity: 0,
          revenue: 0
        });
      }
      
      const stats = productStats.get(productId);
      stats.quantity += node.quantity;
      stats.revenue += parseFloat(node.variant.price) * node.quantity;
    });
  });
  
  return Array.from(productStats.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function getOrdersByDay(orders: ShopifyOrderNode[], _dateRange: AnalyticsPeriod): OrderByDay[] {
  const dayStats = new Map<string, OrderByDay>();
  
  orders.forEach(order => {
    const date = new Date(order.createdAt).toISOString().split('T')[0];
    if (!dayStats.has(date)) {
      dayStats.set(date, { date, orders: 0, revenue: 0 });
    }
    
    const stats = dayStats.get(date);
    stats.orders++;
    stats.revenue += parseFloat(order.totalPrice);
  });
  
  return Array.from(dayStats.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function getCustomerSegments(orders: ShopifyOrderNode[]): CustomerSegments {
  const customerStats = new Map<string, CustomerStat>();
  
  orders.forEach(order => {
    if (order.customer?.id) {
      const customerId = order.customer.id;
      if (!customerStats.has(customerId)) {
        customerStats.set(customerId, {
          id: customerId,
          email: order.customer.email,
          orders: 0,
          revenue: 0
        });
      }
      
      const stats = customerStats.get(customerId);
      stats.orders++;
      stats.revenue += parseFloat(order.totalPrice);
    }
  });
  
  const customers = Array.from(customerStats.values());
  
  return {
    newCustomers: customers.filter(c => c.orders === 1).length,
    returningCustomers: customers.filter(c => c.orders > 1).length,
    vipCustomers: customers.filter(c => c.revenue > 500).length,
    totalCustomers: customers.length
  };
}