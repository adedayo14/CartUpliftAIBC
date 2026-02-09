/**
 * Billing Service - Shopify Managed Pricing
 *
 * This app uses Shopify Managed Pricing - all billing is handled through the
 * Shopify App Store. Merchants upgrade/downgrade via the App Store pricing page.
 *
 * This service:
 * - Syncs plan changes from Shopify to our database
 * - Tracks order counts for billing limits
 * - Enforces plan limits (free/starter/growth/pro)
 */

import prisma from "~/db.server";
import { PRICING_PLANS, getOrderLimit, getHardOrderLimit } from "../config/billing.server";
import type { PlanTier, SubscriptionInfo } from "../types/billing";
import { logger } from "~/utils/logger.server";

// Simplified admin context type - we only need graphql method
interface AdminContext {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

/**
 * Get current plan from Shopify Managed Pricing
 * Maps Shopify's plan name to our internal tier
 */
async function getShopifyManagedPlan(admin: AdminContext): Promise<PlanTier | null> {
  try {
    const response = await admin.graphql(`#graphql
      query {
        currentAppInstallation {
          activeSubscriptions {
            name
            status
            test
          }
        }
      }
    `);

    const result = await response.json();
    const subscriptions = result.data?.currentAppInstallation?.activeSubscriptions;

    if (!subscriptions || subscriptions.length === 0) {
      return null;
    }

    // Get the first active subscription
    const activeSub = subscriptions[0];
    const planName = activeSub.name?.toLowerCase() || '';

    // Map Shopify plan name to our tier
    // Shopify will use names like "Cart Uplift - Starter", "Cart Uplift - Growth", etc.
    if (planName.includes('starter')) return 'starter';
    if (planName.includes('growth')) return 'growth';
    if (planName.includes('pro')) return 'pro';

    // Default to starter if we can't match
    return 'starter';
  } catch (error) {
    logger.error('Failed to fetch Shopify Managed Pricing plan:', error);
    return null;
  }
}

/**
 * Get or create subscription for a shop
 * Now syncs with Shopify Managed Pricing
 */
export async function getOrCreateSubscription(
  shop: string,
  admin?: AdminContext
): Promise<SubscriptionInfo> {
  let subscription = await prisma.subscription.findUnique({
    where: { shop },
  });

  // Sync with Shopify Managed Pricing if admin context provided
  if (admin) {
    const shopifyPlan = await getShopifyManagedPlan(admin);
    if (shopifyPlan && subscription) {
      // Update plan if different from Shopify's record
      if (subscription.planTier !== shopifyPlan) {
        subscription = await prisma.subscription.update({
          where: { shop },
          data: {
            planTier: shopifyPlan,
            planStatus: "active",
          },
        });
        logger.log(`✅ Synced plan from Shopify Managed Pricing: ${shopifyPlan}`);
      }
    }
  }

  if (!subscription) {
    // Create starter trial subscription for new shops
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days from now

    subscription = await prisma.subscription.create({
      data: {
        shop,
        planTier: "starter",
        planStatus: "trial",
        billingPeriodStart: now,
        monthlyOrderCount: 0,
        trialEndsAt: trialEnd,
      },
    });
  }

  // Check if we need to reset the counter (new billing period - every 30 days)
  const now = new Date();
  const daysSinceReset = Math.floor(
    (now.getTime() - subscription.lastOrderCountReset.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceReset >= 30 && subscription.monthlyOrderCount > 0) {
    // Auto-reset for new billing period
    subscription = await prisma.subscription.update({
      where: { shop },
      data: {
        monthlyOrderCount: 0,
        lastOrderCountReset: now,
        billingPeriodStart: now,
        orderLimitWarningShown: false,
        orderLimitReached: false,
      },
    });
  }

  const planTier = subscription.planTier as PlanTier;
  const orderLimit = getOrderLimit(planTier);
  const hardLimit = getHardOrderLimit(planTier);
  const orderCount = subscription.monthlyOrderCount;

  // Detect development stores - they can't purchase plans, so disable limits
  const isDevelopmentStore = shop.includes('.myshopify.com') &&
    (process.env.NODE_ENV === 'development' || process.env.SHOPIFY_BILLING_TEST_MODE === 'true');

  return {
    shop,
    planTier,
    planStatus: subscription.planStatus,
    orderCount,
    orderLimit,
    hardLimit,
    isApproaching: !isDevelopmentStore && orderLimit !== Infinity && orderCount >= orderLimit * 0.9,
    isInGrace: !isDevelopmentStore && orderCount >= orderLimit && orderCount < hardLimit,
    isLimitReached: !isDevelopmentStore && hardLimit !== Infinity && orderCount >= hardLimit,
    trialEndsAt: subscription.trialEndsAt,
    billingPeriodEnd: subscription.billingPeriodEnd,
    billingPeriodStart: subscription.billingPeriodStart,
    isDevelopmentStore,
  };
}

/**
 * Increment order count and check limits
 */
export async function incrementOrderCount(shop: string): Promise<{
  newCount: number;
  limitReached: boolean;
  shouldShowWarning: boolean;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { shop },
  });

  if (!subscription) {
    throw new Error("Subscription not found");
  }

  // Check if we need to reset the counter (new billing period)
  const now = new Date();
  const daysSinceReset = Math.floor(
    (now.getTime() - subscription.lastOrderCountReset.getTime()) / (1000 * 60 * 60 * 24)
  );

  let newCount = subscription.monthlyOrderCount;
  let shouldReset = false;

  if (daysSinceReset >= 30) {
    // Reset counter for new billing period
    newCount = 0;
    shouldReset = true;
  }

  // Increment count
  newCount += 1;

  const planTier = subscription.planTier as PlanTier;
  const orderLimit = getOrderLimit(planTier);
  const hardLimit = getHardOrderLimit(planTier);
  
  const limitReached = hardLimit !== Infinity && newCount >= hardLimit;
  const shouldShowWarning = orderLimit !== Infinity && newCount >= orderLimit * 0.9 && !subscription.orderLimitWarningShown;

  // Update database
  await prisma.subscription.update({
    where: { shop },
    data: {
      monthlyOrderCount: newCount,
      orderLimitReached: limitReached,
      orderLimitWarningShown: shouldShowWarning || subscription.orderLimitWarningShown,
      ...(shouldReset ? {
        lastOrderCountReset: now,
        billingPeriodStart: now,
        orderLimitWarningShown: false, // Reset warning for new period
      } : {}),
    },
  });

  return {
    newCount,
    limitReached,
    shouldShowWarning,
  };
}

/**
 * Reset monthly order count (called at billing cycle reset)
 */
export async function resetOrderCount(shop: string): Promise<void> {
  await prisma.subscription.update({
    where: { shop },
    data: {
      monthlyOrderCount: 0,
      lastOrderCountReset: new Date(),
      orderLimitWarningShown: false,
      orderLimitReached: false,
    },
  });
}

/**
 * Check if shop can use app (not over hard limit)
 */
export async function canUseApp(shop: string): Promise<boolean> {
  const info = await getOrCreateSubscription(shop);
  return !info.isLimitReached;
}
