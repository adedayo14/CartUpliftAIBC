// Unified tracking endpoint for cart analytics and recommendations
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import {
  validateStoreHash,
  validateProductId,
  validateVariantId,
  validateSessionId,
  sanitizeTextInput,
  validateNumericInput,
  validateCorsOrigin,
  getCorsHeaders
} from "../services/security.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const origin = request.headers.get('origin');
  let corsHeaders: Record<string, string> | undefined;

  try {
    const formData = await request.formData();

    // Phase 3: Input validation
    const rawEventType = formData.get("eventType") as string;
    const rawShop = formData.get("shop") as string;
    const rawSessionId = formData.get("sessionId") as string;

    const eventType = sanitizeTextInput(rawEventType, 50);
    const shop = validateStoreHash(rawShop) ? rawShop : null;
    const sessionId = validateSessionId(rawSessionId);

    if (!eventType || !shop) {
      console.warn('[Track API] Invalid inputs:', { eventType: !!eventType, shop: !!shop });
      return json({ error: "Missing or invalid required fields" }, { status: 400 });
    }

    // Phase 3: CORS validation (per-shop allowlist, no admin API available)
    const allowedOrigin = await validateCorsOrigin(origin, shop); // No admin API, uses cached domains
    corsHeaders = getCorsHeaders(allowedOrigin);

    // Phase 3: Rate limiting with burst support (100 rpm, 40 burst)
    try {
      await rateLimitRequest(request, shop, { sustainedLimit: 100, burstLimit: 40 });
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.warn(`[Track API] Rate limit exceeded for shop: ${shop}`);
        return error; // Return 429 response
      }
      throw error;
    }

    // Handle recommendation/product tracking (for ML analytics)
    if (eventType === "impression" || eventType === "click" || eventType === "add_to_cart") {
      const rawProductId = formData.get("productId") as string;
      const rawVariantId = formData.get("variantId") as string | null;
      const rawParentProductId = formData.get("parentProductId") as string | null;
      const rawProductTitle = formData.get("productTitle") as string | null;
      const rawSource = formData.get("source") as string | null;
      const rawPosition = formData.get("position") as string | null;

      // Validate inputs
      const productId = validateProductId(rawProductId) || validateVariantId(rawProductId);
      const variantId = validateVariantId(rawVariantId);
      const parentProductId = validateProductId(rawParentProductId);
      const productTitle = sanitizeTextInput(rawProductTitle, 200);
      const source = sanitizeTextInput(rawSource, 50);
      const position = validateNumericInput(rawPosition, 0, 100);

      if (!productId) {
        console.warn('[Track API] Invalid productId:', rawProductId);
        return json({ error: "Invalid or missing productId for product event" }, { status: 400 });
      }

      // 🛡️ DEDUPLICATION: Check if this exact event already exists for this session
      // Only allow 1 impression and 1 click per product per session
      if (eventType === "impression" || eventType === "click") {
        const existingEvent = await db.trackingEvent.findFirst({
          where: {
            storeHash: shop,
            event: eventType,
            productId,
            sessionId: sessionId || undefined,
          },
        });

        if (existingEvent) {
          console.log(`🛡️ Deduplication: ${eventType} for product ${productId} already tracked in session ${sessionId}`);
          return json({ success: true, deduplicated: true }, {
            headers: corsHeaders,
          });
        }
      }

      // Build metadata to store variant/product relationship
      const metadata: Record<string, string> = {};
      if (variantId) metadata.variantId = variantId;
      if (parentProductId) metadata.productId = parentProductId;

      await db.trackingEvent.create({
        data: {
          storeHash: shop,
          event: eventType,
          productId, // This will be the variant ID in most cases
          productTitle: productTitle || undefined,
          sessionId: sessionId || undefined,
          source: source || "cart_drawer",
          position: position || undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          createdAt: new Date(),
        },
      });

      console.log(`✅ Tracked ${eventType} for product ${productId} in session ${sessionId}`);

      return json({ success: true }, {
        headers: corsHeaders,
      });
    }

    // Handle cart analytics tracking (cart open/close, checkout, etc.)
    const rawAnalyticsProductId = formData.get("productId") as string | null;
    const rawAnalyticsProductTitle = formData.get("productTitle") as string | null;
    const rawRevenue = formData.get("revenue") as string | null;
    const rawOrderId = formData.get("orderId") as string | null;

    // Validate analytics inputs
    const analyticsProductId = validateProductId(rawAnalyticsProductId);
    const analyticsProductTitle = sanitizeTextInput(rawAnalyticsProductTitle, 200);
    const revenue = validateNumericInput(rawRevenue, 0, 1000000);
    const orderId = sanitizeTextInput(rawOrderId, 100);

    await db.analyticsEvent.create({
      data: {
        storeHash: shop,
        eventType,
        sessionId: sessionId || undefined,
        orderId: orderId || undefined,
        orderValue: revenue || undefined,
        productIds: analyticsProductId ? JSON.stringify([analyticsProductId]) : undefined,
        metadata: {
          productTitle: analyticsProductTitle,
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date(),
      },
    });

    return json({ success: true }, {
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    console.error("Tracking error:", error);
    return json({ error: "Failed to track event" }, {
      status: 500,
      headers: {
        ...(corsHeaders || {}),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });
  }
};

// Support CORS preflight
export const loader = async ({ request }: ActionFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    // Try to get shop from query params for preflight validation
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const origin = request.headers.get('origin');

    let corsHeaders: Record<string, string>;
    if (shop && origin) {
      const allowedOrigin = await validateCorsOrigin(origin, shop);
      corsHeaders = getCorsHeaders(allowedOrigin);
    } else {
      // No shop context; return minimal headers without wildcard
      corsHeaders = {};
    }

    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  return json({ status: 'ok' });
};
