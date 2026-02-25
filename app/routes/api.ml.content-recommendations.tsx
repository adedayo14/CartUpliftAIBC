import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { getProducts, type BCProduct } from "~/services/bigcommerce-api.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin } from "../services/security.server";
import prismaClient from "~/db.server";

const prisma = prismaClient;

interface ContentRecommendationRequest {
  storeHash: string;
  product_ids?: string[];
  exclude_ids?: string[];
  customer_preferences?: CustomerPreferences;
  privacy_level?: string;
}

interface CustomerPreferences {
  sessionId?: string;
  [key: string]: unknown;
}

interface Recommendation {
  product_id: string;
  score: number;
  reason: string;
  strategy: 'content_category' | 'content_personalized';
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const data = await request.json() as ContentRecommendationRequest;
    const { storeHash, product_ids, exclude_ids, customer_preferences, privacy_level } = data;

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

    const recommendations = await generateContentRecommendations(
      storeHash,
      product_ids || [],
      exclude_ids || [],
      customer_preferences,
      privacy_level || 'basic'
    );

    return json({ recommendations });

  } catch (error: unknown) {
    console.error('Content recommendations error:', error);
    return json({ error: 'Failed to generate content recommendations' }, { status: 500 });
  }
}

async function generateContentRecommendations(
  storeHash: string,
  productIds: string[],
  excludeIds: string[],
  customerPreferences: CustomerPreferences | undefined,
  privacyLevel: string
): Promise<Recommendation[]> {
  try {
    // Fetch catalog products for similarity matching
    const result = await getProducts(storeHash, {
      limit: 50,
      is_visible: true,
    });
    const catalogProducts = result.products;

    if (catalogProducts.length === 0) return [];

    // Find the base products from the catalog
    const baseProducts = catalogProducts.filter(p => productIds.includes(String(p.id)));

    if (baseProducts.length === 0 && productIds.length > 0) {
      // Products weren't in the first page, fetch them individually
      // For now use all catalog products as base for recommendations
      return getBasicContentRecommendations(catalogProducts, excludeIds, productIds);
    }

    if (privacyLevel === 'basic') {
      return getBasicContentRecommendations(catalogProducts, excludeIds, productIds);
    }

    return await getPersonalizedContentRecommendations(
      storeHash,
      catalogProducts,
      excludeIds,
      productIds,
      customerPreferences,
      privacyLevel
    );
  } catch (error: unknown) {
    console.error('Error generating content recommendations:', error);
    return [];
  }
}

function getBasicContentRecommendations(
  catalogProducts: BCProduct[],
  excludeIds: string[],
  productIds: string[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Simple category/brand based recommendations
  const baseProduct = catalogProducts.find(p => productIds.includes(String(p.id)));

  for (const product of catalogProducts) {
    const pid = String(product.id);
    if (excludeIds.includes(pid) || productIds.includes(pid)) continue;

    let score = 0.5;
    if (baseProduct) {
      // Category match
      if (product.categories?.some(c => baseProduct.categories?.includes(c))) score += 0.3;
      // Brand match
      if (product.brand_id && product.brand_id === baseProduct.brand_id) score += 0.2;
    }

    recommendations.push({
      product_id: pid,
      score,
      reason: baseProduct ? `Similar to ${baseProduct.name}` : 'Popular product',
      strategy: 'content_category'
    });
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 20);
}

async function getPersonalizedContentRecommendations(
  storeHash: string,
  catalogProducts: BCProduct[],
  excludeIds: string[],
  productIds: string[],
  customerPreferences: CustomerPreferences | undefined,
  privacyLevel: string
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];

  let userHistory: string[] = [];
  if (customerPreferences?.sessionId && privacyLevel !== 'basic') {
    try {
      const profile = await prisma.mLUserProfile.findUnique({
        where: {
          storeHash_sessionId: {
            storeHash,
            sessionId: customerPreferences.sessionId
          }
        }
      });

      if (profile) {
        userHistory = [
          ...(profile.viewedProducts || []),
          ...(profile.cartedProducts || []),
          ...(profile.purchasedProducts || [])
        ];
      }
    } catch (e: unknown) {
      console.warn('Failed to fetch user profile:', e);
    }
  }

  // Check for cached similarity data
  for (const productId of productIds) {
    try {
      const cached = await prisma.mLProductSimilarity.findMany({
        where: {
          storeHash,
          productId1: productId
        },
        orderBy: { overallScore: 'desc' },
        take: 10
      });

      if (cached.length > 0) {
        cached.forEach((sim) => {
          if (!excludeIds.includes(sim.productId2) && !productIds.includes(sim.productId2)) {
            recommendations.push({
              product_id: sim.productId2,
              score: sim.overallScore,
              reason: 'Frequently viewed together',
              strategy: 'content_personalized'
            });
          }
        });
        continue;
      }
    } catch (e: unknown) {
      console.warn('Failed to fetch cached similarities:', e);
    }

    // Fall back to basic recommendations
    const basicRecs = getBasicContentRecommendations(catalogProducts, excludeIds, productIds);
    recommendations.push(...basicRecs);
  }

  // Boost products user has viewed
  if (userHistory.length > 0) {
    recommendations.forEach(rec => {
      if (userHistory.includes(rec.product_id)) {
        rec.score *= 1.5;
        rec.reason += ' (based on your interests)';
      }
    });
  }

  const uniqueRecommendations = Array.from(
    new Map(recommendations.map(r => [r.product_id, r])).values()
  );

  return uniqueRecommendations.sort((a, b) => b.score - a.score).slice(0, 20);
}
