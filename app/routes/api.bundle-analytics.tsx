// Bundle analytics tracking endpoint
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";
import {
  validateStoreHash,
  validateProductId,
  sanitizeTextInput,
  validateCorsOrigin,
  getCorsHeaders,
  validateSessionId
} from "../services/security.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const origin = request.headers.get('origin');
  let corsHeaders: Record<string, string> | undefined;

  try {
    const payload = await request.json();

    // Extract and validate inputs
    const rawBundleId = payload.bundleId;
    const rawBundleName = payload.bundleName;
    const rawBundleType = payload.bundleType;
    const rawEvent = payload.event;
    const rawProducts = payload.products;
    const rawSessionId = payload.sessionId;
    const rawShop = payload.shop;

    // Convert to string if needed before sanitizing
    const bundleId = sanitizeTextInput(String(rawBundleId || ''), 100);
    const bundleName = sanitizeTextInput(String(rawBundleName || ''), 200);
    const bundleType = sanitizeTextInput(String(rawBundleType || ''), 50);
    const event = sanitizeTextInput(String(rawEvent || ''), 50);
    const shop = validateStoreHash(rawShop) ? rawShop : null;
    const sessionId = validateSessionId(rawSessionId) || null;

    if (!bundleId || !event || !shop) {
      console.warn('[Bundle Analytics] Invalid inputs:', {
        bundleId: !!bundleId,
        event: !!event,
        shop: !!shop,
        raw: { bundleId: rawBundleId, event: rawEvent, shop: rawShop }
      });
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // CORS validation
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    corsHeaders = getCorsHeaders(allowedOrigin);

    // Rate limiting (100 rpm, 40 burst)
    try {
      await rateLimitRequest(request, shop, { sustainedLimit: 100, burstLimit: 40 });
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.warn(`[Bundle Analytics] Rate limit exceeded for shop: ${shop}`);
        return error;
      }
      throw error;
    }

    // Only track 'view' and 'click' events (add_to_cart is tracked via order webhook)
    if (event !== 'view' && event !== 'click') {
      console.log(`[Bundle Analytics] Ignoring event type: ${event}`);
      return json({ success: true }, { headers: corsHeaders });
    }

    // Build metadata
    const metadata: Record<string, any> = {
      bundleName,
      bundleType,
      timestamp: new Date().toISOString()
    };

    if (rawProducts && Array.isArray(rawProducts)) {
      metadata.products = rawProducts.filter(p => validateProductId(p)).slice(0, 10); // Limit to 10 products
    }

    // Create tracking event with source='bundle'
    await db.trackingEvent.create({
      data: {
        storeHash: shop,
        event,
        productId: bundleId, // Store bundle ID in productId field
        productTitle: bundleName,
        sessionId,
        source: 'bundle', // Important: This distinguishes bundle events from product events
        metadata,
        createdAt: new Date(),
      },
    });

    console.log(`✅ Tracked bundle ${event} for bundle ${bundleId} (${bundleName})`);

    return json({ success: true }, {
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    console.error("[Bundle Analytics] Error:", error);
    return json({ error: "Failed to track bundle event" }, {
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
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const origin = request.headers.get('origin');

    let corsHeaders: Record<string, string>;
    if (shop && origin) {
      const allowedOrigin = await validateCorsOrigin(origin, shop);
      corsHeaders = getCorsHeaders(allowedOrigin);
    } else {
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
