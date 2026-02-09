import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "~/utils/logger.server";

/**
 * GDPR COMPLIANCE: customers/data_request webhook
 *
 * PURPOSE: Export all customer data we have stored when customer requests it.
 *
 * PRIVACY LEVELS:
 * - Basic/Balanced: We don't store customerId, only sessionId/anonymousId
 * - Advanced: We store customerId for personalization
 *
 * DATA WE MAY STORE (if privacy level = advanced):
 * - MLUserProfile: Behavioral data (viewed/carted/purchased products)
 * - AnalyticsEvent: Cart and purchase events
 * - TrackingEvent: Product interaction tracking
 * - CustomerBundle: Bundle interaction history
 * - RecommendationAttribution: Purchase attribution data
 *
 * SHOPIFY REQUIREMENT:
 * Must respond with 200 and customer data in JSON format within 30 seconds.
 * If no data exists, respond with empty data structure.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();

  try {
    const { shop, payload } = await authenticate.webhook(request);
    const customerId = payload.customer?.id?.toString();
    const customerEmail = payload.customer?.email;

    logger.info("Customer data request webhook received", {
      shop,
      customerId,
      email: customerEmail
    });

    if (!customerId) {
      logger.warn("Customer data request missing customer ID", { shop });
      return new Response(
        JSON.stringify({
          customer_id: null,
          shop,
          message: "No customer ID provided",
          data_collected: {}
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Get shop settings to check privacy level
    const settings = await db.settings.findUnique({
      where: { shop },
      select: { mlPrivacyLevel: true }
    });

    const privacyLevel = settings?.mlPrivacyLevel || 'basic';

    // If privacy level is basic/balanced, we don't store customerId
    if (privacyLevel !== 'advanced') {
      logger.info("Customer data request - basic/balanced privacy, no customerId stored", {
        shop,
        privacyLevel
      });
      return new Response(
        JSON.stringify({
          customer_id: customerId,
          shop,
          privacy_level: privacyLevel,
          message: "No customer-identifying data stored (privacy level: " + privacyLevel + ")",
          data_collected: {}
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Privacy level is 'advanced' - collect all customer data
    logger.info("Customer data request - collecting advanced privacy data", { shop, customerId });

    const [
      mlProfiles,
      analyticsEvents,
      trackingEvents,
      bundleInteractions,
      attributions
    ] = await Promise.allSettled([
      // ML User Profiles (behavioral data)
      db.mLUserProfile.findMany({
        where: { shop, customerId, deletedAt: null },
        select: {
          id: true,
          sessionId: true,
          privacyLevel: true,
          viewedProducts: true,
          cartedProducts: true,
          purchasedProducts: true,
          categoryPreferences: true,
          priceRangePreference: true,
          lastActivity: true,
          createdAt: true
        }
      }),

      // Analytics Events (cart/purchase tracking)
      db.analyticsEvent.findMany({
        where: { shop, customerId },
        select: {
          id: true,
          eventType: true,
          sessionId: true,
          orderId: true,
          orderValue: true,
          productIds: true,
          timestamp: true
        },
        orderBy: { timestamp: 'desc' },
        take: 1000 // Limit to last 1000 events
      }),

      // Tracking Events (product impressions/clicks)
      db.trackingEvent.findMany({
        where: { shop, customerId },
        select: {
          id: true,
          event: true,
          productId: true,
          productTitle: true,
          sessionId: true,
          source: true,
          position: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 1000 // Limit to last 1000 events
      }),

      // Customer Bundle Interactions
      db.customerBundle.findMany({
        where: { shop, customerId },
        select: {
          id: true,
          bundleId: true,
          action: true,
          cartValue: true,
          discountApplied: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }),

      // Recommendation Attribution (purchase attribution)
      db.recommendationAttribution.findMany({
        where: { shop, customerId },
        select: {
          id: true,
          productId: true,
          orderId: true,
          orderNumber: true,
          orderValue: true,
          attributedRevenue: true,
          conversionTimeMinutes: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Extract successful results
    const customerData = {
      customer_id: customerId,
      customer_email: customerEmail,
      shop,
      privacy_level: privacyLevel,
      data_export_date: new Date().toISOString(),
      data_collected: {
        ml_profiles: mlProfiles.status === 'fulfilled' ? mlProfiles.value : [],
        analytics_events: analyticsEvents.status === 'fulfilled' ? analyticsEvents.value : [],
        tracking_events: trackingEvents.status === 'fulfilled' ? trackingEvents.value : [],
        bundle_interactions: bundleInteractions.status === 'fulfilled' ? bundleInteractions.value : [],
        recommendation_attributions: attributions.status === 'fulfilled' ? attributions.value : []
      },
      summary: {
        total_ml_profiles: mlProfiles.status === 'fulfilled' ? mlProfiles.value.length : 0,
        total_analytics_events: analyticsEvents.status === 'fulfilled' ? analyticsEvents.value.length : 0,
        total_tracking_events: trackingEvents.status === 'fulfilled' ? trackingEvents.value.length : 0,
        total_bundle_interactions: bundleInteractions.status === 'fulfilled' ? bundleInteractions.value.length : 0,
        total_attributions: attributions.status === 'fulfilled' ? attributions.value.length : 0
      }
    };

    const duration = Date.now() - startTime;
    logger.info("Customer data request completed", {
      shop,
      customerId,
      duration,
      totalRecords: Object.values(customerData.summary).reduce((a, b) => a + b, 0)
    });

    return new Response(
      JSON.stringify(customerData, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Customer data request error", { error, duration });

    // Still return 200 to Shopify (don't fail the webhook)
    return new Response(
      JSON.stringify({
        error: "Failed to export customer data",
        message: error instanceof Error ? error.message : "Unknown error",
        data_collected: {}
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
