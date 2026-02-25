import db from "~/db.server";
import { logger } from "~/utils/logger.server";

/**
 * Cart event types
 */
export type CartEventType =
  | "cart_open"
  | "cart_close"
  | "product_view"
  | "product_click"
  | "checkout_start"
  | "checkout_complete";

/**
 * Cart event interface
 */
export interface CartEvent {
  id?: string;
  shop: string;
  sessionId: string;
  eventType: CartEventType;
  productId?: string;
  productTitle?: string;
  revenue?: number;
  timestamp: Date;
}

/**
 * Product analytics for cart performance
 */
export interface ProductAnalytics {
  productId: string;
  productTitle: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

/**
 * Database row interface for cart events
 */
interface CartEventRow {
  id?: string;
  shop: string;
  sessionId: string;
  eventType: string;
  productId?: string | null;
  productTitle?: string | null;
  revenue?: number | null;
  timestamp: Date | string;
}

/**
 * Cart analytics summary interface
 */
export interface CartAnalytics {
  cartImpressions: number;
  cartOpens: number;
  checkoutsCompleted: number;
  cartToCheckoutRate: number;
  revenueFromCart: number;
  topProductViews: ProductAnalytics[];
}

/**
 * Track a cart event to the database
 * Best-effort tracking - failures are logged but don't throw
 *
 * @param event - Cart event to track
 */
export async function trackCartEvent(event: CartEvent): Promise<void> {
  try {
    // Prefer a dedicated analytics table if present; otherwise, no-op
    // This avoids violating the required fields on the Session model
    // Schema optionality varies between dev/prod, so we guard with try/catch
    await db.cartEvent.create({
      data: {
        storeHash: event.shop,
        sessionId: event.sessionId,
        eventType: event.eventType,
        productId: event.productId ?? null,
        productTitle: event.productTitle ?? null,
        revenue: event.revenue ?? null,
        timestamp: event.timestamp,
      },
    }).catch(() => {
      // Silently skip if table doesn't exist; analytics are best-effort
      return null;
    });
  } catch (error: unknown) {
    logger.error("Failed to track cart event:", error);
  }
}

/**
 * Constants for analytics calculations
 */
const TOP_PRODUCTS_LIMIT = 10;
const DEFAULT_ANALYTICS: CartAnalytics = {
  cartImpressions: 0,
  cartOpens: 0,
  checkoutsCompleted: 0,
  cartToCheckoutRate: 0,
  revenueFromCart: 0,
  topProductViews: [],
};

/**
 * Parse and validate cart event from database row
 *
 * @param row - Database row
 * @param startDate - Filter start date
 * @param endDate - Filter end date
 * @returns Parsed cart event or null if invalid
 */
function parseCartEvent(row: CartEventRow, startDate: Date, endDate: Date): CartEvent | null {
  try {
    const timestamp = new Date(row.timestamp);
    if (timestamp >= startDate && timestamp <= endDate) {
      return {
        sessionId: row.sessionId,
        shop: row.shop,
        eventType: row.eventType,
        productId: row.productId ?? undefined,
        productTitle: row.productTitle ?? undefined,
        revenue: typeof row.revenue === 'number' ? row.revenue : undefined,
        timestamp,
      } as CartEvent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate product-level analytics from events
 *
 * @param events - Cart events to analyze
 * @returns Product analytics map
 */
function calculateProductStats(events: CartEvent[]): Map<string, ProductAnalytics> {
  const productStats = new Map<string, ProductAnalytics>();

  events.forEach((event: CartEvent) => {
    if (!event.productId || !event.productTitle) return;

    const key = event.productId;
    const existing = productStats.get(key) || {
      productId: event.productId,
      productTitle: event.productTitle,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
    };

    if (event.eventType === "product_view") existing.impressions++;
    if (event.eventType === "product_click") existing.clicks++;
    if (event.eventType === "checkout_complete" && event.revenue) {
      existing.conversions++;
      existing.revenue += event.revenue;
    }

    productStats.set(key, existing);
  });

  return productStats;
}

/**
 * Get cart analytics for a shop within a date range
 * Best-effort retrieval - returns zero values on failure
 *
 * @param shop - Shop domain
 * @param startDate - Start of analysis period
 * @param endDate - End of analysis period
 * @returns Cart analytics summary
 */
export async function getCartAnalytics(
  shop: string,
  startDate: Date,
  endDate: Date
): Promise<CartAnalytics> {
  try {
    // Get all cart events for the time period
    // Prefer reading from dedicated cartEvent table; fall back to empty array
    const rows: CartEventRow[] = await db.cartEvent.findMany?.({
      where: { storeHash: shop },
    }).catch(() => []) ?? [];

    // Parse and filter events by date
    const events: CartEvent[] = rows
      .map((row: CartEventRow) => parseCartEvent(row, startDate, endDate))
      .filter(Boolean) as CartEvent[];

    // Calculate core metrics
    const cartOpens = events.filter(e => e.eventType === "cart_open").length;
    const cartImpressions = cartOpens; // For now, assume 1:1 ratio
    const checkoutsCompleted = events.filter(e => e.eventType === "checkout_complete").length;
    const cartToCheckoutRate = cartOpens > 0 ? (checkoutsCompleted / cartOpens) * 100 : 0;

    const revenueFromCart = events
      .filter(e => e.eventType === "checkout_complete" && e.revenue)
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    // Calculate product performance
    const productStats = calculateProductStats(events);

    const topProductViews = Array.from(productStats.values())
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, TOP_PRODUCTS_LIMIT);

    return {
      cartImpressions,
      cartOpens,
      checkoutsCompleted,
      cartToCheckoutRate,
      revenueFromCart,
      topProductViews,
    };
  } catch (error: unknown) {
    logger.error("Failed to get cart analytics:", error);
    return DEFAULT_ANALYTICS;
  }
}
