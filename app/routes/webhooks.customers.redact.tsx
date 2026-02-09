import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "~/utils/logger.server";

/**
 * GDPR COMPLIANCE: customers/redact webhook
 *
 * PURPOSE: Delete all customer data when customer requests deletion (right to be forgotten).
 *
 * PRIVACY LEVELS:
 * - Basic/Balanced: We don't store customerId, only sessionId/anonymousId (nothing to delete)
 * - Advanced: We store customerId and must delete ALL customer-identifiable data
 *
 * DATA TO DELETE (if privacy level = advanced):
 * - MLUserProfile: Behavioral profiles linked to customerId
 * - AnalyticsEvent: Cart and purchase events with customerId
 * - TrackingEvent: Product interaction tracking with customerId
 * - CustomerBundle: Bundle interaction history with customerId
 * - RecommendationAttribution: Purchase attribution data with customerId
 *
 * SHOPIFY REQUIREMENT:
 * Must respond with 200 within 5 seconds and delete data within 48 hours.
 * We delete immediately using Promise.allSettled for reliability.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();

  try {
    const { shop, payload } = await authenticate.webhook(request);
    const customerId = payload.customer?.id?.toString();
    const customerEmail = payload.customer?.email;

    logger.info("Customer redact webhook received", {
      shop,
      customerId,
      email: customerEmail
    });

    if (!customerId) {
      logger.warn("Customer redact missing customer ID", { shop });
      return new Response(null, { status: 200 });
    }

    // Get shop settings to check privacy level
    const settings = await db.settings.findUnique({
      where: { shop },
      select: { mlPrivacyLevel: true }
    });

    const privacyLevel = settings?.mlPrivacyLevel || 'basic';

    // If privacy level is basic/balanced, we don't store customerId
    if (privacyLevel !== 'advanced') {
      logger.info("Customer redact - basic/balanced privacy, no customerId stored", {
        shop,
        privacyLevel,
        customerId
      });
      return new Response(null, { status: 200 });
    }

    // Privacy level is 'advanced' - delete all customer data
    logger.info("Customer redact - deleting advanced privacy data", {
      shop,
      customerId
    });

    // Delete ALL customer data from ALL tables
    // Use Promise.allSettled to ensure all deletions attempt even if one fails
    const deletionResults = await Promise.allSettled([
      // ML User Profiles - hard delete all profiles with this customerId
      db.mLUserProfile.deleteMany({
        where: { shop, customerId }
      }),

      // Analytics Events - delete all events linked to this customer
      db.analyticsEvent.deleteMany({
        where: { shop, customerId }
      }),

      // Tracking Events - delete all product interaction tracking
      db.trackingEvent.deleteMany({
        where: { shop, customerId }
      }),

      // Customer Bundle Interactions - delete bundle interaction history
      db.customerBundle.deleteMany({
        where: { shop, customerId }
      }),

      // Recommendation Attribution - delete purchase attribution data
      db.recommendationAttribution.deleteMany({
        where: { shop, customerId }
      })
    ]);

    // Count successful deletions and any failures
    let totalDeleted = 0;
    const failures: string[] = [];

    deletionResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        totalDeleted += result.value.count;
      } else {
        const tableNames = [
          'MLUserProfile',
          'AnalyticsEvent',
          'TrackingEvent',
          'CustomerBundle',
          'RecommendationAttribution'
        ];
        failures.push(`${tableNames[index]}: ${result.reason}`);
      }
    });

    const duration = Date.now() - startTime;

    if (failures.length > 0) {
      logger.warn("Customer redact completed with some failures", {
        shop,
        customerId,
        duration,
        totalDeleted,
        failures
      });
    } else {
      logger.info("Customer redact completed successfully", {
        shop,
        customerId,
        duration,
        totalDeleted
      });
    }

    // Always return 200 to Shopify (even if some deletions failed)
    return new Response(null, { status: 200 });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Customer redact error", { error, duration });

    // Still return 200 to Shopify (don't fail the webhook)
    // Shopify expects 200 even if deletion fails
    return new Response(null, { status: 200 });
  }
};
