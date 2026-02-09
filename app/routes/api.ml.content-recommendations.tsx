import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "~/shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin } from "../services/security.server";
import prismaClient from "~/db.server";

const prisma = prismaClient;

// Shopify Admin API client type
type ShopifyAdminClient = Awaited<ReturnType<typeof unauthenticated.admin>>['admin'];

// Request/Response types
interface ContentRecommendationRequest {
  shop: string;
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

interface ShopifyProductNode {
  id: string;
  title: string;
  productType: string;
  vendor: string;
  tags?: string[];
}

interface ShopifyProductsQueryResponse {
  data?: {
    nodes?: Array<ShopifyProductNode | null>;
  };
}

interface ShopifySimilarProductsResponse {
  data?: {
    products?: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          productType: string;
          vendor: string;
        };
      }>;
    };
  };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const data = await request.json() as ContentRecommendationRequest;
    const { shop, product_ids, exclude_ids, customer_preferences, privacy_level } = data;

    if (!shop) {
      return json({ error: 'Shop parameter required' }, { status: 400 });
    }

    // SECURITY: Validate CORS origin for storefront access
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    if (!allowedOrigin) {
      return json({ error: "Invalid origin" }, { status: 403 });
    }

    // SECURITY: Rate limiting - 50 requests per minute for ML recommendations
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
    
    const recommendations = await generateContentRecommendations(
      shop,
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
  shop: string,
  productIds: string[],
  excludeIds: string[],
  customerPreferences: CustomerPreferences | undefined,
  privacyLevel: string
): Promise<Recommendation[]> {
  try {
    const { admin } = await unauthenticated.admin(shop);
    
    const gids = productIds.map(id => `gid://shopify/Product/${id}`);
    const baseProductsResp = await admin.graphql(
      `#graphql
        query getProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              productType
              vendor
              tags
            }
          }
        }
      `,
      { variables: { ids: gids } }
    );
    
    if (!baseProductsResp.ok) {
      return [];
    }

    const baseData = await baseProductsResp.json() as ShopifyProductsQueryResponse;
    const baseProducts = baseData?.data?.nodes?.filter((node): node is ShopifyProductNode => node !== null) || [];
    
    if (baseProducts.length === 0) {
      return [];
    }
    
    if (privacyLevel === 'basic') {
      return await getBasicContentRecommendations(admin, baseProducts, excludeIds, productIds);
    }
    
    return await getPersonalizedContentRecommendations(
      admin,
      shop,
      baseProducts,
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

async function getBasicContentRecommendations(
  admin: ShopifyAdminClient,
  baseProducts: ShopifyProductNode[],
  excludeIds: string[],
  productIds: string[]
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];
  
  for (const product of baseProducts) {
    const productType = product.productType;
    const query = productType ? `product_type:${productType}` : '';
    
    const similarResp = await admin.graphql(
      `#graphql
        query findSimilar($query: String, $first: Int!) {
          products(first: $first, query: $query, sortKey: RELEVANCE) {
            edges {
              node {
                id
                title
                productType
                vendor
              }
            }
          }
        }
      `,
      { variables: { query, first: 20 } }
    );

    if (similarResp.ok) {
      const data = await similarResp.json() as ShopifySimilarProductsResponse;
      const products = data?.data?.products?.edges || [];
      
      for (const edge of products) {
        const p = edge.node;
        const pid = p.id.replace('gid://shopify/Product/', '');
        
        if (excludeIds.includes(pid) || productIds.includes(pid)) continue;
        
        let score = 0.5;
        if (p.productType === productType) score += 0.3;
        if (p.vendor === product.vendor) score += 0.2;
        
        recommendations.push({
          product_id: pid,
          score,
          reason: `Similar to ${product.title}`,
          strategy: 'content_category'
        });
      }
    }
  }
  
  const uniqueRecommendations = Array.from(
    new Map(recommendations.map(r => [r.product_id, r])).values()
  );
  
  return uniqueRecommendations.sort((a, b) => b.score - a.score).slice(0, 20);
}

async function getPersonalizedContentRecommendations(
  admin: ShopifyAdminClient,
  shop: string,
  baseProducts: ShopifyProductNode[],
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
          shop_sessionId: {
            shop: shop,
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
  
  for (const product of baseProducts) {
    const productId = product.id.replace('gid://shopify/Product/', '');
    
    try {
      const cached = await prisma.mLProductSimilarity.findMany({
        where: {
          shop: shop,
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
              reason: `Frequently viewed together`,
              strategy: 'content_personalized'
            });
          }
        });
        continue;
      }
    } catch (e: unknown) {
      console.warn('Failed to fetch cached similarities:', e);
    }
    
    const basicRecs = await getBasicContentRecommendations(admin, [product], excludeIds, productIds);
    recommendations.push(...basicRecs);
  }
  
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
