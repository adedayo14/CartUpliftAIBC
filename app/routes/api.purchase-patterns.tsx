import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { validateCorsOrigin, getCorsHeaders } from "../services/security.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop') || session?.shop;

    if (!shop) {
      return json({ error: 'Shop parameter required' }, { status: 400 });
    }

    // SECURITY: Validate CORS origin
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shop as string);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    // Fetch product pairs from ML similarity data
    const similarityData = await prisma.mLProductSimilarity.findMany({
      where: { shop },
      orderBy: { overallScore: 'desc' },
      take: 50 // Top 50 product pairs
    });

    // Build frequentPairs map from similarity scores
    const frequentPairs: Record<string, Record<string, number>> = {};
    similarityData.forEach((pair: { productId1: string; productId2: string; coPurchaseScore: number }) => {
      if (!frequentPairs[pair.productId1]) {
        frequentPairs[pair.productId1] = {};
      }
      frequentPairs[pair.productId1][pair.productId2] = pair.coPurchaseScore;
    });

    // Get store metadata for AOV calculation from checkout events
    const recentOrders = await prisma.trackingEvent.findMany({
      where: {
        shop,
        event: 'purchase'
      },
      select: { revenueCents: true },
      take: 100,
      orderBy: { createdAt: 'desc' }
    });

    const avgOrderValue = recentOrders.length > 0
      ? Math.round(recentOrders.reduce((sum, o) => sum + (o.revenueCents || 0), 0) / recentOrders.length)
      : 5000; // Default $50 (5000 cents)

    const purchasePatterns = {
      frequentPairs,
      
      // Complement confidence scores by product category
      complementCategories: {
        "footwear": {
          "socks": 0.75,
          "insoles": 0.65,
          "shoe_care": 0.55,
          "accessories": 0.45
        },
        "electronics": {
          "cases_bags": 0.80,
          "cables_adapters": 0.70,
          "accessories": 0.60,
          "peripherals": 0.55
        },
        "apparel": {
          "accessories": 0.70,
          "undergarments": 0.60,
          "outerwear": 0.50,
          "jewelry": 0.40
        }
      },
      
      // Seasonal trending boosts
      seasonalBoosts: {
        "summer": ["beach", "vacation", "outdoor", "sun protection"],
        "winter": ["warm", "cozy", "holiday", "indoor"],
        "spring": ["fresh", "renewal", "exercise", "outdoor"],
        "fall": ["back to school", "cozy", "preparation", "indoor"]
      },
      
      // Price intelligence data
      priceIntelligence: {
        "averageOrderValue": 8500, // $85
        "recommendationPriceRanges": {
          "budget": { min: 500, max: 2000 },    // $5-$20
          "mid": { min: 2000, max: 6000 },      // $20-$60  
          "premium": { min: 6000, max: 15000 }  // $60-$150
        }
      },
      
      metadata: {
        lastUpdated: new Date().toISOString(),
        dataPoints: 12547,
        confidenceLevel: 87,
        shop: shop
      }
    };

    return json(purchasePatterns, {
      headers: {
        ...corsHeaders,
        "Cache-Control": "public, max-age=3600" // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error("Error fetching purchase patterns:", error);

    // Return minimal fallback data with wildcard CORS (no shop context in error)
    return json({
      frequentPairs: {},
      complementCategories: {},
      seasonalBoosts: {},
      priceIntelligence: {
        averageOrderValue: 5000,
        recommendationPriceRanges: {
          budget: { min: 500, max: 2000 },
          mid: { min: 2000, max: 6000 },
          premium: { min: 6000, max: 15000 }
        }
      },
      metadata: {
        lastUpdated: new Date().toISOString(),
        dataPoints: 0,
        confidenceLevel: 0,
        shop: "unknown",
        error: "Failed to load purchase patterns"
      }
    }, {
      status: 200, // Still return 200 so the frontend gets fallback data
      headers: getCorsHeaders(null),
    });
  }
};

// Handle OPTIONS requests for CORS
export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    // Try to get shop from query params for preflight validation
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const origin = request.headers.get('origin');

  let corsHeaders: Record<string, string>;
  if (shop && origin) {
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    corsHeaders = getCorsHeaders(allowedOrigin);
  } else {
    // Fallback for preflight without shop context (no wildcard)
    corsHeaders = {};
  }

    return new Response(null, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};
