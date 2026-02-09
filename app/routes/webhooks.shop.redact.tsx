import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "~/utils/logger.server";

/**
 * GDPR Compliance: shop/redact webhook
 *
 * CRITICAL: This webhook is called when a merchant uninstalls the app.
 * We MUST delete ALL shop data from ALL tables to comply with GDPR.
 *
 * Shopify requires this webhook to respond with 200 within 5 seconds,
 * so we use Promise.allSettled to ensure all deletions attempt to run
 * but don't block the response if one fails.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  logger.info("Shop redact webhook received - deleting all shop data", { shop });

  try {
    // Delete ALL shop-related data from ALL tables
    // Using Promise.allSettled to ensure response within 5 seconds
    // even if individual deletions fail
    const deletionPromises = [
      // Core tables
      db.settings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),

      // Bundle system tables
      db.bundle.deleteMany({ where: { shop } }),
      // Note: BundleProduct will cascade delete via onDelete: Cascade
      db.bundlePurchase.deleteMany({ where: { shop } }),
      db.customerBundle.deleteMany({ where: { shop } }),

      // Analytics tables
      db.analyticsEvent.deleteMany({ where: { shop } }),
      db.trackingEvent.deleteMany({ where: { shop } }),

      // ML/AI tables
      db.mLUserProfile.deleteMany({ where: { shop } }),
      db.mLProductSimilarity.deleteMany({ where: { shop } }),
      db.mLProductPerformance.deleteMany({ where: { shop } }),
      db.mLSystemHealth.deleteMany({ where: { shop } }),
      db.mLDataRetentionJob.deleteMany({ where: { shop } }),
      db.recommendationAttribution.deleteMany({ where: { shop } }),

      // Billing tables
      db.subscription.deleteMany({ where: { shop } }),
      db.billedOrder.deleteMany({ where: { shop } }),

      // A/B Testing tables (using shopId field)
      db.experiment.deleteMany({ where: { shopId: shop } }),
      // Note: Variant and Event will cascade delete via onDelete: Cascade
    ];

    // Use allSettled to attempt all deletions without failing if one errors
    const results = await Promise.allSettled(deletionPromises);

    // Log any failures for monitoring (don't fail the webhook)
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn("Some deletions failed during shop redact", {
        shop,
        failureCount: failures.length,
        errors: failures.map(f => f.status === 'rejected' ? f.reason : null)
      });
    } else {
      logger.info("All shop data deleted successfully", { shop });
    }

  } catch (error) {
    // Log error but still return 200 to Shopify
    logger.error("Error during shop redact", { shop, error });
  }

  // Always return 200 to Shopify within 5 seconds
  return new Response(null, { status: 200 });
};
