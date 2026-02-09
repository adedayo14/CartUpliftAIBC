import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { trackCartEvent } from "~/models/cartAnalytics.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin, getCorsHeaders } from "../services/security.server";
// BILLING DISABLED - Uncomment after DB migration
// import { checkOrderLimit, incrementOrderCount } from "../services/orderCounter.server";
// Note: This endpoint is called from the storefront (unauthenticated). Do not require admin auth.

/**
 * Cart event type definition
 */
interface CartEvent {
  eventType: string;
  sessionId: string;
  shop: string;
  productId?: string;
  productTitle?: string;
  revenue?: number;
  timestamp: Date;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const shopFromBody = (formData.get("shop") as string) || "";

    // SECURITY: Validate CORS origin
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shopFromBody);
    if (!allowedOrigin) {
      return json({ error: "Invalid origin" }, { status: 403 });
    }

    // SECURITY: Rate limiting - 100 requests per minute, burst of 40
    const rateLimitResult = await rateLimitRequest(request, shopFromBody, {
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

    const eventType = formData.get("eventType") as string;
    const sessionId = formData.get("sessionId") as string;
    const productId = formData.get("productId") as string | null;
    const productTitle = formData.get("productTitle") as string | null;
    const revenue = formData.get("revenue") ? parseFloat(formData.get("revenue") as string) : null;

    // BILLING DISABLED - Order limit checking commented out until DB migration
    // Check order limits before processing checkout events
    // if (eventType === "checkout_initiated" && shopFromBody) {
    //   const limitCheck = await checkOrderLimit(shopFromBody);
    //   
    //   if (!limitCheck.allowed) {
    //     return json({ 
    //       success: false,
    //       error: "ORDER_LIMIT_REACHED",
    //       message: "You've reached your plan's order limit. Please upgrade to continue.",
    //       remaining: limitCheck.remaining,
    //       plan: limitCheck.plan
    //     }, { 
    //       status: 403,
    //       headers: {
    //         "Access-Control-Allow-Origin": "*",
    //       }
    //     });
    //   }
    //
    //   // Increment order count for checkout events
    //   await incrementOrderCount(shopFromBody);
    // }

    const cartEvent: CartEvent = {
      eventType,
      sessionId,
      shop: shopFromBody,
      productId: productId || undefined,
      productTitle: productTitle || undefined,
      revenue: revenue || undefined,
      timestamp: new Date(),
    };

    // Track event to database (async, best-effort)
    await trackCartEvent(cartEvent).catch((error) => {
      console.error("Failed to track cart event:", error);
      // Don't fail the request if tracking fails
    });

    return json({ success: true, timestamp: cartEvent.timestamp.toISOString() }, {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("Cart tracking error:", error);
    return json({ error: "Failed to track event" }, { status: 500 });
  }
};

/**
 * Support CORS preflight requests
 */
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
      // Fallback for preflight without shop context (no wildcard)
      corsHeaders = {};
    }

    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return json({ status: 'ok' });
};
