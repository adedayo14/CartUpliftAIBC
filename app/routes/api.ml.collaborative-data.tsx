import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import type { PrismaClient } from "@prisma/client";
import { authenticateAdmin } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prismaClient from "~/db.server";

const prisma = prismaClient as unknown as PrismaClient;

// Type definitions
interface RequestData {
  shop: string;
  privacy_level: string;
  include_user_similarities?: boolean;
  session_id?: string;
}

interface ItemSimilarity {
  item1_id: string;
  item2_id: string;
  similarity: number;
  category_score?: number;
  price_score?: number;
  support?: number;
}

interface GlobalStats {
  total_interactions: number;
  view_count: number;
  cart_count: number;
  purchase_count: number;
  conversion_rate: number;
  cart_rate: number;
  data_quality: string;
}

interface UserInteraction {
  product_id: string;
  interaction_type: string;
  weight: number;
}

interface UserSimilarity {
  user_id: string;
  similarity: number;
  common_products: number;
}

interface CollaborativeDataResponse {
  item_similarities: ItemSimilarity[];
  global_stats: GlobalStats;
  user_item_interactions: UserInteraction[];
  user_similarities: UserSimilarity[];
}

interface TrackingEvent {
  eventType: string;
}

interface MLProductSimilarity {
  productId1: string;
  productId2: string;
  overallScore: number;
  categoryScore?: number;
  priceScore?: number;
  cooccurrenceCount?: number;
}

interface MLUserProfile {
  sessionId: string;
  viewedProducts?: string[];
  cartedProducts?: string[];
  purchasedProducts?: string[];
}

export async function action({ request }: ActionFunctionArgs) {
  // SECURITY: Require admin authentication for ML data access
  const { session, storeHash } = await authenticateAdmin(request);
  const authenticatedShop = storeHash;

  try {
    const data = await request.json() as RequestData;
    const { shop, privacy_level, include_user_similarities, session_id } = data;

    if (!shop) {
      return json({ error: 'Shop parameter required' }, { status: 400 });
    }

    // SECURITY: Verify shop ownership
    if (shop !== authenticatedShop) {
      return json({ error: 'Unauthorized shop access' }, { status: 403 });
    }

    // SECURITY: Rate limiting - 10 requests per minute (expensive ML data)
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 10,
      windowMs: 60 * 1000,
      burstMax: 5,
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
            "Retry-After": String(rateLimitResult.retryAfter || 60),
          },
        }
      );
    }
    
    if (privacy_level === 'basic') {
      return json<CollaborativeDataResponse>({
        item_similarities: await getAggregatedItemSimilarities(shop),
        global_stats: await getGlobalStats(shop),
        user_item_interactions: [],
        user_similarities: []
      });
    }

    const response: CollaborativeDataResponse = {
      item_similarities: await getItemSimilarities(shop),
      global_stats: await getGlobalStats(shop),
      user_item_interactions: privacy_level === 'advanced' ?
        await getUserItemInteractions(shop, session_id) : [],
      user_similarities: include_user_similarities && privacy_level === 'advanced' ?
        await getUserSimilarities(shop, session_id) : []
    };
    
    return json(response);

  } catch (error: unknown) {
    console.error('Collaborative filtering data error:', error);
    return json({ error: 'Failed to load collaborative data' }, { status: 500 });
  }
}

async function getAggregatedItemSimilarities(shop: string): Promise<ItemSimilarity[]> {
  try {
    const similarities = await prisma.mLProductSimilarity.findMany({
      where: { storeHash: shop },
      orderBy: { overallScore: 'desc' },
      take: 100,
      select: {
        productId1: true,
        productId2: true,
        overallScore: true
      }
    });

    return similarities.map((sim: MLProductSimilarity) => ({
      item1_id: sim.productId1,
      item2_id: sim.productId2,
      similarity: sim.overallScore
    }));
  } catch (error: unknown) {
    console.error('Error fetching aggregated similarities:', error);
    return [];
  }
}

async function getItemSimilarities(shop: string): Promise<ItemSimilarity[]> {
  try {
    const similarities = await prisma.mLProductSimilarity.findMany({
      where: { storeHash: shop },
      orderBy: { overallScore: 'desc' },
      take: 200
    });

    return similarities.map((sim: MLProductSimilarity) => ({
      item1_id: sim.productId1,
      item2_id: sim.productId2,
      similarity: sim.overallScore,
      category_score: sim.categoryScore || 0,
      price_score: sim.priceScore || 0,
      support: sim.cooccurrenceCount || 0
    }));
  } catch (error: unknown) {
    console.error('Error fetching item similarities:', error);
    return [];
  }
}

async function getGlobalStats(shop: string): Promise<GlobalStats> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const trackingEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash: shop,
        createdAt: { gte: thirtyDaysAgo }
      },
      select: {
        eventType: true
      }
    });

    const totalInteractions = trackingEvents.length;
    const viewCount = trackingEvents.filter((e: TrackingEvent) => e.eventType === 'view').length;
    const cartCount = trackingEvents.filter((e: TrackingEvent) => e.eventType === 'add_to_cart').length;
    const purchaseCount = trackingEvents.filter((e: TrackingEvent) => e.eventType === 'purchase').length;
    
    const conversionRate = viewCount > 0 ? purchaseCount / viewCount : 0;
    const cartRate = viewCount > 0 ? cartCount / viewCount : 0;
    
    return {
      total_interactions: totalInteractions,
      view_count: viewCount,
      cart_count: cartCount,
      purchase_count: purchaseCount,
      conversion_rate: conversionRate,
      cart_rate: cartRate,
      data_quality: totalInteractions > 1000 ? 'good' : totalInteractions > 100 ? 'moderate' : 'limited'
    };
  } catch (error: unknown) {
    console.error('Error fetching global stats:', error);
    return {
      total_interactions: 0,
      view_count: 0,
      cart_count: 0,
      purchase_count: 0,
      conversion_rate: 0,
      cart_rate: 0,
      data_quality: 'limited'
    };
  }
}

async function getUserItemInteractions(shop: string, sessionId?: string): Promise<UserInteraction[]> {
  try {
    if (!sessionId) {
      return [];
    }

    const profile = await prisma.mLUserProfile.findUnique({
      where: {
        storeHash_sessionId: {
          storeHash: shop,
          sessionId
        }
      }
    }) as MLUserProfile | null;

    if (!profile) {
      return [];
    }

    const interactions: UserInteraction[] = [];

    if (profile.viewedProducts) {
      profile.viewedProducts.forEach((productId: string) => {
        interactions.push({
          product_id: productId,
          interaction_type: 'view',
          weight: 1.0
        });
      });
    }

    if (profile.cartedProducts) {
      profile.cartedProducts.forEach((productId: string) => {
        interactions.push({
          product_id: productId,
          interaction_type: 'cart',
          weight: 2.0
        });
      });
    }

    if (profile.purchasedProducts) {
      profile.purchasedProducts.forEach((productId: string) => {
        interactions.push({
          product_id: productId,
          interaction_type: 'purchase',
          weight: 3.0
        });
      });
    }

    return interactions;
  } catch (error: unknown) {
    console.error('Error fetching user interactions:', error);
    return [];
  }
}

async function getUserSimilarities(shop: string, sessionId?: string): Promise<UserSimilarity[]> {
  try {
    if (!sessionId) {
      return [];
    }

    const currentProfile = await prisma.mLUserProfile.findUnique({
      where: {
        storeHash_sessionId: {
          storeHash: shop,
          sessionId
        }
      }
    }) as MLUserProfile | null;

    if (!currentProfile) {
      return [];
    }

    const allProfiles = await prisma.mLUserProfile.findMany({
      where: {
        storeHash: shop,
        sessionId: { not: sessionId }
      },
      take: 50
    }) as MLUserProfile[];

    const currentProducts = new Set([
      ...(currentProfile.viewedProducts || []),
      ...(currentProfile.cartedProducts || []),
      ...(currentProfile.purchasedProducts || [])
    ]);

    const similarities: UserSimilarity[] = allProfiles
      .map((profile: MLUserProfile) => {
        const otherProducts = new Set([
          ...(profile.viewedProducts || []),
          ...(profile.cartedProducts || []),
          ...(profile.purchasedProducts || [])
        ]);

        const intersection = new Set(
          [...currentProducts].filter(p => otherProducts.has(p))
        );

        const union = new Set([...currentProducts, ...otherProducts]);

        const jaccardSimilarity = union.size > 0 ? intersection.size / union.size : 0;

        return {
          user_id: profile.sessionId,
          similarity: jaccardSimilarity,
          common_products: intersection.size
        };
      })
      .filter(s => s.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    return similarities;
  } catch (error: unknown) {
    console.error('Error fetching user similarities:', error);
    return [];
  }
}
