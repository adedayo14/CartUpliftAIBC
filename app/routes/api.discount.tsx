import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
import { rateLimitByIP } from "../utils/rateLimiter.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // SECURITY: IP-based rate limiting to prevent discount code enumeration
    const rateLimitResult = await rateLimitByIP(request, {
      maxRequests: 10,
      windowMs: 60 * 1000, // 10 per minute per IP
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }

    const { session, storeHash } = await authenticateAdmin(request);

    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { discountCode } = body;

    if (!discountCode) {
      return json({ error: "Discount code is required" }, { status: 400 });
    }

    // BigCommerce Coupons API (GET /v2/coupons?code=...) validates discount codes.
    try {
      // Validate discount code via BigCommerce Coupons API (v2)
      const couponsResponse = await bigcommerceApi(
        storeHash,
        `/coupons?code=${encodeURIComponent(discountCode)}`,
        { version: "v2" }
      );
      const coupons = await couponsResponse.json();

      if (!Array.isArray(coupons) || coupons.length === 0) {
        return json({
          success: false,
          error: "Invalid discount code"
        });
      }

      const coupon = coupons[0];

      if (!coupon.enabled) {
        return json({
          success: false,
          error: "This discount code is no longer active"
        });
      }

      return json({
        success: true,
        discount: {
          id: String(coupon.id),
          code: coupon.code,
          title: coupon.name,
          type: coupon.type,
          value: coupon.amount,
          enabled: coupon.enabled,
        }
      });

    } catch (apiError) {
      console.error('Discount validation error:', apiError);
      return json({
        success: false,
        error: "Unable to validate discount code"
      });
    }

  } catch (error) {
    console.error('Discount validation error:', error);
    return json({ 
      success: false, 
      error: "Internal server error" 
    }, { status: 500 });
  }
};
