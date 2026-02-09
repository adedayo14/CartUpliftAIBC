import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "~/shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin } from "../services/security.server";
import prismaClient from "~/db.server";
import type { TrackingEventModel } from "~/types/prisma";

const prisma = prismaClient;

// Shopify Admin API client type
type ShopifyAdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>['admin'];

// Request/Response types
interface PopularRecommendationRequest {
  shop: string;
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

interface ShopifyProductsResponse {
  data?: {
    products?: {
      edges: Array<{
        node: {
          id: string;
          title: string;
        };
      }>;
    };
  };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const data = await request.json() as PopularRecommendationRequest;
    const { shop, exclude_ids, customer_preferences, privacy_level } = data;

    if (!shop) {
      return json({ error: 'Shop parameter required' }, { status: 400 });
    }

    // SECURITY: Validate CORS origin for storefront access
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    if (!allowedOrigin) {
      return json({ error: "Invalid origin" }, { status: 403 });
    }

    // SECURITY: Rate limiting - 50 requests per minute (competitive data protection)
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 50,
      windowMs: 60 * 1000,
      burstMax: 20,
      burstWindowMs: 10 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        {
          error: "Rate limit exceeded",
          retryAfter: rateLimitResult.retryAfter
        },
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
      shop,
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
  shop: string,
  excludeIds: string[],
  customerPreferences: CustomerPreferences | undefined,
  privacyLevel: string
): Promise<PopularRecommendation[]> {
  try {
    const popularProducts = await getPopularProducts(shop, excludeIds);
    
    if (popularProducts.length === 0) {
      return await getFallbackPopularProducts(shop, excludeIds);
    }
    
    if (privacyLevel === 'basic') {
      return popularProducts.slice(0, 20).map(product => ({
        product_id: product.product_id,
        score: product.popularity_score,
        reason: 'Trending product',
        strategy: 'popularity_basic',
        popularity_metrics: {
          view_count: product.view_count,
          purchase_count: product.purchase_count,
          cart_count: product.cart_count,
          conversion_rate: product.conversion_rate
        }
      }));
    }
    
    const personalizedRecommendations = applyPersonalizationFilters(
      popularProducts,
      customerPreferences
    );
    
    return personalizedRecommendations.slice(0, 20);
  } catch (error: unknown) {
    console.error('Error generating popular recommendations:', error);
    return [];
  }
}

async function getPopularProducts(shop: string, excludeIds: string[]): Promise<PopularProduct[]> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const trackingEvents = await prisma.trackingEvent.findMany({
      where: {
        shop: shop,
        createdAt: { gte: thirtyDaysAgo }
      },
      select: {
        productId: true,
        eventType: true
      }
    });
    
    if (trackingEvents.length === 0) {
      return [];
    }
    
    const productMetrics = new Map<string, { views: number; carts: number; purchases: number }>();

    trackingEvents.forEach((event: TrackingEventModel) => {
      if (!event.productId) return;
      
      const existing = productMetrics.get(event.productId) || { views: 0, carts: 0, purchases: 0 };
      
      if (event.eventType === 'view') existing.views++;
      if (event.eventType === 'add_to_cart') existing.carts++;
      if (event.eventType === 'purchase') existing.purchases++;
      
      productMetrics.set(event.productId, existing);
    });
    
    const popularProducts = Array.from(productMetrics.entries())
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

    return popularProducts;
  } catch (error: unknown) {
    console.error('Error fetching popular products:', error);
    return [];
  }
}

async function getFallbackPopularProducts(shop: string, excludeIds: string[]): Promise<PopularRecommendation[]> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    
    const productsResp = await admin.graphql(
      `#graphql
        query getPopularProducts($first: Int!) {
          products(first: $first, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      `,
      { variables: { first: 30 } }
    );
    
    if (!productsResp.ok) {
      return [];
    }

    const data = await productsResp.json() as ShopifyProductsResponse;
    const products = data?.data?.products?.edges || [];

    return products
      .filter((edge) => {
        const pid = edge.node.id.replace('gid://shopify/Product/', '');
        return !excludeIds.includes(pid);
      })
      .map((edge, index: number): PopularRecommendation => ({
        product_id: edge.node.id.replace('gid://shopify/Product/', ''),
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
      strategy: 'popularity_standard',
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
    strategy: 'popularity_personalized',
    popularity_metrics: {
      view_count: product.view_count,
      purchase_count: product.purchase_count,
      cart_count: product.cart_count,
      conversion_rate: product.conversion_rate
    }
  }));
}
