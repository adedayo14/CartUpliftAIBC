import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { validateCorsOrigin } from "../services/security.server";

// In-memory storage for demo - in production, use a database
let trackingData: Record<string, {
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  lastUpdated: string;
}> = {};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const eventType = formData.get("event") as string;
  const productId = formData.get("productId") as string;
  const shop = formData.get("shop") as string;
  const revenue = parseFloat(formData.get("revenue") as string || "0");

  if (!eventType || !productId || !shop) {
    return json({ error: "Missing required parameters" }, { status: 400 });
  }

  // SECURITY: Validate CORS origin
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = await validateCorsOrigin(origin, shop);
  if (!allowedOrigin) {
    return json({ error: "Invalid origin" }, { status: 403 });
  }

  // SECURITY: Rate limiting - 100 requests per minute
  const rateLimitResult = await rateLimitRequest(request, shop, {
    maxRequests: 100,
    windowMs: 60 * 1000,
    burstMax: 40,
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

  const key = `${shop}_${productId}`;

  // Initialize tracking if not exists
  if (!trackingData[key]) {
    trackingData[key] = {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  // Update metrics based on event type
  switch (eventType) {
    case "impression":
      trackingData[key].impressions++;
      break;
    case "click":
      trackingData[key].clicks++;
      break;
    case "conversion":
      trackingData[key].conversions++;
      trackingData[key].revenue += revenue;
      break;
  }

  trackingData[key].lastUpdated = new Date().toISOString();

  return json({ success: true }, {
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
};

export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Shop parameter is required" }, { status: 400 });
  }

  // Get all tracking data for this shop
  const shopData = Object.entries(trackingData)
    .filter(([key]) => key.startsWith(`${shop}_`))
    .map(([key, data]) => {
      const productId = key.replace(`${shop}_`, '');
      const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : 0;
      const conversionRate = data.clicks > 0 ? (data.conversions / data.clicks) * 100 : 0;

      return {
        productId,
        impressions: data.impressions,
        clicks: data.clicks,
        conversions: data.conversions,
        ctr: Math.round(ctr * 10) / 10,
        conversionRate: Math.round(conversionRate * 10) / 10,
        revenue: data.revenue,
        lastUpdated: data.lastUpdated
      };
    })
    .sort((a, b) => b.revenue - a.revenue); // Sort by revenue

  return json({
    trackingData: shopData,
    summary: {
      totalImpressions: shopData.reduce((sum, item) => sum + item.impressions, 0),
      totalClicks: shopData.reduce((sum, item) => sum + item.clicks, 0),
      totalConversions: shopData.reduce((sum, item) => sum + item.conversions, 0),
      totalRevenue: shopData.reduce((sum, item) => sum + item.revenue, 0),
      avgCTR: shopData.length > 0 ? 
        Math.round((shopData.reduce((sum, item) => sum + item.ctr, 0) / shopData.length) * 10) / 10 : 0,
      avgConversionRate: shopData.length > 0 ? 
        Math.round((shopData.reduce((sum, item) => sum + item.conversionRate, 0) / shopData.length) * 10) / 10 : 0
    }
  });
};
