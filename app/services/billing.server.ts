/**
 * Billing Service - BigCommerce Unified Billing
 *
 * This service:
 * - Tracks order counts for billing limits
 * - Enforces plan limits (free/starter/growth/pro)
 * - Syncs with BigCommerce Unified Billing when enabled
 */

import prisma from "~/db.server";
import { PRICING_PLANS, getOrderLimit, getHardOrderLimit } from "../config/billing.server";
import type { PlanTier, SubscriptionInfo } from "../types/billing";
import { env } from "~/utils/env.server";
import { syncUnifiedBillingSubscription } from "./unified-billing.server";

/**
 * Get or create subscription for a store
 * Syncs Unified Billing subscription status when available
 */
export async function getOrCreateSubscription(
  storeHash: string
): Promise<SubscriptionInfo> {
  let subscription = await prisma.subscription.findUnique({
    where: { storeHash },
  });

  if (env.billingProvider === 'bigcommerce') {
    await syncUnifiedBillingSubscription(storeHash);
    subscription = await prisma.subscription.findUnique({ where: { storeHash } }) || subscription;
  }

  if (!subscription) {
    // Create starter trial subscription for new stores
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days from now

    subscription = await prisma.subscription.create({
      data: {
        storeHash,
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
      where: { storeHash },
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

  // Detect development mode
  const isDevelopmentStore = process.env.NODE_ENV === 'development';

  return {
    storeHash,
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
export async function incrementOrderCount(storeHash: string): Promise<{
  newCount: number;
  limitReached: boolean;
  shouldShowWarning: boolean;
}> {
  const subscription = await prisma.subscription.findUnique({
    where: { storeHash },
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
    where: { storeHash },
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
export async function resetOrderCount(storeHash: string): Promise<void> {
  await prisma.subscription.update({
    where: { storeHash },
    data: {
      monthlyOrderCount: 0,
      lastOrderCountReset: new Date(),
      orderLimitWarningShown: false,
      orderLimitReached: false,
    },
  });
}

/**
 * Check if store can use app (not over hard limit)
 */
export async function canUseApp(storeHash: string): Promise<boolean> {
  const info = await getOrCreateSubscription(storeHash);
  return !info.isLimitReached;
}
