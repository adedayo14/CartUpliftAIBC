import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getSettings, saveSettings, getDefaultSettings } from "../models/settings.server";
import { authenticate } from "../shopify.server";
import { LAYOUT_MAP, HTTP_METHODS } from "~/constants/bundle";
import { validateShopDomain, validateCorsOrigin, getCorsHeaders } from "../services/security.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { getOrCreateSubscription } from "../services/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    // SECURITY: Validate CORS origin
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = await validateCorsOrigin(origin, shop);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    // SECURITY: Rate limiting - 100 requests per minute for settings reads
    try {
      await rateLimitRequest(request, shop, {
        maxRequests: 100,
        windowMs: 60 * 1000,
        burstMax: 40,
        burstWindowMs: 10 * 1000,
      });
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }

    // 🔒 BILLING LIMIT CHECK: Return 402 if order limit reached
    const subscription = await getOrCreateSubscription(shop, admin);
    if (subscription.isLimitReached) {
      return new Response("Payment Required - Order limit reached", {
        status: 402,
        headers: corsHeaders,
      });
    }

    const settings = await getSettings(shop);
    
    // Track app embed activation on first storefront load
    if (!settings.appEmbedActivated) {
      await saveSettings(shop, { 
        appEmbedActivated: true, 
        appEmbedActivatedAt: new Date() 
      });
      settings.appEmbedActivated = true;
      settings.appEmbedActivatedAt = new Date();
    }
    
    // Normalize layout for theme (row/column expected in CSS/JS)
    const normalized = {
      source: 'db',
      ...settings,
    // Ensure storefront has a caps flag for grid/header even if prod mirrors the global toggle
    enableRecommendationTitleCaps: (settings as Record<string, unknown>).enableRecommendationTitleCaps ?? (settings as Record<string, unknown>).enableTitleCaps ?? false,
      recommendationLayout: LAYOUT_MAP[settings.recommendationLayout as keyof typeof LAYOUT_MAP] || settings.recommendationLayout,
    };

  return json(normalized, {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": `${HTTP_METHODS.GET}, ${HTTP_METHODS.POST}, ${HTTP_METHODS.PUT}, ${HTTP_METHODS.DELETE}, ${HTTP_METHODS.OPTIONS}`,
      },
    });
  } catch (error) {
    // Fail open: serve defaults so preview and storefront keep working
    // Use wildcard for error fallback since we don't have shop context
    const defaults = getDefaultSettings();
    const normalized = {
      source: 'defaults',
      ...defaults,
      recommendationLayout: LAYOUT_MAP[defaults.recommendationLayout as keyof typeof LAYOUT_MAP] || defaults.recommendationLayout,
    };
    return json(normalized, {
      headers: {
        ...getCorsHeaders(null),
        "Access-Control-Allow-Methods": `${HTTP_METHODS.GET}, ${HTTP_METHODS.POST}, ${HTTP_METHODS.PUT}, ${HTTP_METHODS.DELETE}, ${HTTP_METHODS.OPTIONS}`,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
}

export async function action({ request }: LoaderFunctionArgs) {
  if (request.method !== HTTP_METHODS.POST) {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const contentType = request.headers.get('content-type');

    // Handle JSON payload with embedded shop/session
    if (contentType?.includes('application/json')) {
      const payload = await request.json();
      const { shop: rawShop, settings } = payload;

      // SECURITY: Validate shop domain
      if (!rawShop || !validateShopDomain(rawShop)) {
        console.warn('[Settings API] Invalid shop domain:', rawShop);
        return json({ error: "Valid shop parameter required" }, { status: 400 });
      }

      // SECURITY: Rate limiting for settings writes - 200 requests per minute (admin-only, authenticated)
      try {
        await rateLimitRequest(request, rawShop, {
          maxRequests: 200,
          windowMs: 60 * 1000,
          burstMax: 50,
          burstWindowMs: 10 * 1000,
        });
      } catch (error) {
        if (error instanceof Response) return error;
        throw error;
      }

      const savedSettings = await saveSettings(rawShop, settings);

      return json({ success: true, settings: savedSettings });
    }

    // Fallback: Try to authenticate (this may hang in embedded context)
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const formData = await request.formData();
    const settings = Object.fromEntries(formData);

    const savedSettings = await saveSettings(shop, settings as Record<string, unknown>);

    return json({ success: true, settings: savedSettings });
  } catch (error) {
    return json({ error: "Failed to save settings", details: (error as Error).message }, { status: 500 });
  }
}
