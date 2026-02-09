import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin, getCorsHeaders } from "../services/security.server";
import db from "../db.server";

/**
 * Track ML recommendation served events
 * Called by theme extension when recommendations are displayed
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { shop, sessionId, customerId, anchorProducts, recommendedProducts } = body;

    if (!shop || !anchorProducts || !recommendedProducts) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // SECURITY: Validate CORS origin
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    if (!allowedOrigin) {
      return json({ error: "Invalid origin" }, { status: 403 });
    }

    // SECURITY: Rate limiting - 100 requests per minute, burst of 40
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 100,
      windowMs: 60 * 1000,
      burstMax: 40,
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

    console.log('📈 ML recommendation served', {
      shop,
      anchorCount: anchorProducts.length,
      recommendedCount: recommendedProducts.length
    });

    // Try to save the ml_recommendation_served event
    // If trackingEvent table doesn't exist, just log and return success
    try {
      if (db.trackingEvent) {
        await db.trackingEvent.create({
          data: {
            shop,
            event: 'ml_recommendation_served',
            productId: anchorProducts[0] || '',
            sessionId: sessionId || null,
            customerId: customerId || null,
            source: 'cart_drawer',
            metadata: JSON.stringify({
              anchors: anchorProducts,
              recommendationCount: recommendedProducts.length,
              recommendationIds: recommendedProducts, // 🎯 KEY: For purchase attribution
              clientGenerated: true,
              timestamp: new Date().toISOString()
            }),
            createdAt: new Date()
          }
        });
        console.log('✅ ml_recommendation_served event saved successfully');
      } else {
        console.log('ℹ️ TrackingEvent table not available, skipping save');
      }
    } catch (dbError) {
      console.warn('⚠️ Failed to save tracking event (non-critical):', dbError);
      // Don't fail the request if tracking fails
    }

    return json({ success: true }, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });

  } catch (error) {
    console.error('❌ Failed to save ml_recommendation_served event:', error);
    return json({ error: "Failed to save event" }, { status: 500 });
  }
};

// Handle OPTIONS for CORS
export const loader = async ({ request }: ActionFunctionArgs) => {
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
};
