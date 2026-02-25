import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { getProducts } from "~/services/bigcommerce-api.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin } from "../services/security.server";
import prismaClient from "~/db.server";
import type { TrackingEventModel } from "~/types/prisma";

const prisma = prismaClient;

interface PopularRecommendationRequest {
  storeHash: string;
  exclude_ids?: string[];
  customer_preferences?: CustomerPreferences;
  privacy_level?: string;
}

interface CustomerPreferences {
  sessionId?: string;
  [key: string]: unknown;
}

interface PopularProduct {
  product_id: string;
  view_count: number;
  cart_count: number;
  purchase_count: number;
  conversion_rate: number;
  popularity_score: number;
}

interface PopularRecommendation {
  product_id: string;
  score: number;
  reason: string;
  strategy: 'popularity_basic' | 'popularity_standard' | 'popularity_personalized' | 'popularity_fallback';
  popularity_metrics?: {
    view_count: number;
    purchase_count: number;
    cart_count: number;
    conversion_rate: number;
  };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const data = await request.json() as PopularRecommendationRequest;
    const { storeHash, exclude_ids, customer_preferences, privacy_level } = data;

    if (!storeHash) {
      return json({ error: 'storeHash parameter required' }, { status: 400 });
    }

    // SECURITY: Validate CORS origin for storefront access
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, storeHash);
    if (!allowedOrigin) {
      return json({ error: "Invalid origin" }, { status: 403 });
    }

    // SECURITY: Rate limiting
    const rateLimitResult = await rateLimitRequest(request, storeHash, {
      maxRequests: 50,
      windowMs: 60 * 1000,
      burstMax: 20,
      burstWindowMs: 10 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Retry-After": String(rateLimitResult.retryAfter || 60),
          },
        }
      );
    }

    const recommendations = await generatePopularRecommendations(
      storeHash,
      exclude_ids || [],
      customer_preferences,
      privacy_level || 'basic'
    );

    return json({ recommendations }, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });

  } catch (error: unknown) {
    console.error('Popular recommendations error:', error);
    return json({ error: 'Failed to generate popular recommendations' }, { status: 500 });
  }
}

async function generatePopularRecommendations(
  storeHash: string,
  excludeIds: string[],
  customerPreferences: CustomerPreferences | undefined,
  privacyLevel: string
): Promise<PopularRecommendation[]> {
  try {
    const popularProducts = await getPopularProducts(storeHash, excludeIds);

    if (popularProducts.length === 0) {
      return await getFallbackPopularProducts(storeHash, excludeIds);
    }

    if (privacyLevel === 'basic') {
      return popularProducts.slice(0, 20).map(product => ({
        product_id: product.product_id,
        score: product.popularity_score,
        reason: 'Trending product',
        strategy: 'popularity_basic' as const,
        popularity_metrics: {
          view_count: product.view_count,
          purchase_count: product.purchase_count,
          cart_count: product.cart_count,
          conversion_rate: product.conversion_rate
        }
      }));
    }

    return applyPersonalizationFilters(popularProducts, customerPreferences);
  } catch (error: unknown) {
    console.error('Error generating popular recommendations:', error);
    return [];
  }
}

async function getPopularProducts(storeHash: string, excludeIds: string[]): Promise<PopularProduct[]> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trackingEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash,
        createdAt: { gte: thirtyDaysAgo }
      },
      select: {
        productId: true,
        eventType: true
      }
    });

    if (trackingEvents.length === 0) return [];

    const productMetrics = new Map<string, { views: number; carts: number; purchases: number }>();

    trackingEvents.forEach((event: TrackingEventModel) => {
      if (!event.productId) return;
      const existing = productMetrics.get(event.productId) || { views: 0, carts: 0, purchases: 0 };
      if (event.eventType === 'view') existing.views++;
      if (event.eventType === 'add_to_cart') existing.carts++;
      if (event.eventType === 'purchase') existing.purchases++;
      productMetrics.set(event.productId, existing);
    });

    return Array.from(productMetrics.entries())
      .filter(([productId]) => !excludeIds.includes(productId))
      .map(([productId, metrics]) => {
        const conversionRate = metrics.views > 0 ? metrics.purchases / metrics.views : 0;
        const popularityScore =
          (metrics.views * 0.3) +
          (metrics.carts * 0.5) +
          (metrics.purchases * 2.0) +
          (conversionRate * 100);

        return {
          product_id: productId,
          view_count: metrics.views,
          cart_count: metrics.carts,
          purchase_count: metrics.purchases,
          conversion_rate: conversionRate,
          popularity_score: popularityScore
        };
      })
      .sort((a, b) => b.popularity_score - a.popularity_score);
  } catch (error: unknown) {
    console.error('Error fetching popular products:', error);
    return [];
  }
}

async function getFallbackPopularProducts(storeHash: string, excludeIds: string[]): Promise<PopularRecommendation[]> {
  try {
    // Fetch best-selling products from BigCommerce
    const result = await getProducts(storeHash, {
      limit: 30,
      sort: "total_sold",
      direction: "desc",
      is_visible: true,
    });

    return result.products
      .filter(product => !excludeIds.includes(String(product.id)))
      .map((product, index): PopularRecommendation => ({
        product_id: String(product.id),
        score: 1.0 - (index * 0.02),
        reason: 'Best selling product',
        strategy: 'popularity_fallback'
      }))
      .slice(0, 20);
  } catch (error: unknown) {
    console.error('Error fetching fallback products:', error);
    return [];
  }
}

function applyPersonalizationFilters(
  popularProducts: PopularProduct[],
  customerPreferences: CustomerPreferences | undefined
): PopularRecommendation[] {
  if (!customerPreferences?.sessionId) {
    return popularProducts.map(product => ({
      product_id: product.product_id,
      score: product.popularity_score,
      reason: 'Trending product',
      strategy: 'popularity_standard' as const,
      popularity_metrics: {
        view_count: product.view_count,
        purchase_count: product.purchase_count,
        cart_count: product.cart_count,
        conversion_rate: product.conversion_rate
      }
    }));
  }

  return popularProducts.map(product => ({
    product_id: product.product_id,
    score: product.popularity_score,
    reason: 'Trending in your interests',
    strategy: 'popularity_personalized' as const,
    popularity_metrics: {
      view_count: product.view_count,
      purchase_count: product.purchase_count,
      cart_count: product.cart_count,
      conversion_rate: product.conversion_rate
    }
  }));
}
