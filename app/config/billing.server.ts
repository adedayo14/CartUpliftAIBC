/**
 * Billing Configuration - BigCommerce Unified Billing
 * Defines pricing plans and order limits for Cart Uplift
 *
 * BILLING METHOD: BigCommerce Unified Billing
 * - Subscriptions managed via BigCommerce checkout
 * - Plan changes handled via BigCommerce billing + sync
 *
 * Pricing Philosophy:
 * - All plans have access to all features
 * - Plans differ only by order volume and support level
 * - Simpler pricing = better conversion
 *
 * Order Limit Enforcement:
 * - Hard limit is plan limit + 10% buffer
 * - Buffer prevents edge case complaints and provides grace period
 * - At limit, app shows upgrade prompt but continues working during grace
 */

import type { PlanTier, PricingPlan } from "../types/billing";
import { ORDER_LIMITS, LIMIT_BUFFER_PERCENTAGE as IMPORTED_LIMIT_BUFFER_PERCENTAGE } from "./constants";

export type { PlanTier, PricingPlan };

export const PRICING_PLANS: Record<PlanTier, PricingPlan> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 29,
    interval: "MONTH",
    orderLimit: ORDER_LIMITS.STARTER,
    trialDays: 14,
    features: [
      "AI product recommendations",
      "Smart product pairing",
      "Free shipping & gift promos",
      "Enhanced cart drawer",
      "Real-time analytics & insights",
      "Full customization & privacy",
      `Up to ${ORDER_LIMITS.STARTER} orders/month`
    ],
    supportLevel: "Priority email support"
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 79,
    interval: "MONTH",
    orderLimit: ORDER_LIMITS.GROWTH,
    trialDays: 14,
    features: [
      "AI product recommendations",
      "Smart product pairing",
      "Free shipping & gift promos",
      "Enhanced cart drawer",
      "Real-time analytics & insights",
      "Full customization & privacy",
      `Up to ${ORDER_LIMITS.GROWTH.toLocaleString()} orders/month`
    ],
    supportLevel: "Priority email support"
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 199,
    interval: "MONTH",
    orderLimit: ORDER_LIMITS.PRO,
    trialDays: 14,
    features: [
      "AI product recommendations",
      "Smart product pairing",
      "Free shipping & gift promos",
      "Enhanced cart drawer",
      "Real-time analytics & insights",
      "Full customization & privacy",
      "Unlimited orders"
    ],
    supportLevel: "Dedicated support"
  }
};

/**
 * Order limit enforcement with 10% grace buffer
 * Prevents edge case complaints while maintaining compliance
 * Re-exported from constants.ts for backwards compatibility
 */
export const LIMIT_BUFFER_PERCENTAGE = IMPORTED_LIMIT_BUFFER_PERCENTAGE;

/**
 * Get plan details by tier
 */
export function getPlan(tier: PlanTier): PricingPlan {
  return PRICING_PLANS[tier];
}

/**
 * Check if a plan exists
 */
export function isValidPlan(tier: string): tier is PlanTier {
  return tier in PRICING_PLANS;
}

/**
 * Get order limit for a plan with 10% grace buffer
 */
export function getHardOrderLimit(tier: PlanTier): number {
  // Fallback for legacy "free" tier during migration
  if (!(tier in PRICING_PLANS)) {
    return 550; // Default to STARTER limit + 10% buffer
  }
  const baseLimit = PRICING_PLANS[tier].orderLimit;
  if (baseLimit === Infinity) return Infinity;
  return Math.floor(baseLimit * (1 + LIMIT_BUFFER_PERCENTAGE));
}

/**
 * Get base order limit (displayed limit)
 */
export function getOrderLimit(tier: PlanTier): number {
  // Fallback for legacy "free" tier during migration
  if (!(tier in PRICING_PLANS)) {
    return 500; // Default to STARTER limit
  }
  return PRICING_PLANS[tier].orderLimit;
}

/**
 * Check if usage is approaching limit (90% of base limit)
 * Shows warning to upgrade before hitting buffer
 */
export function isApproachingLimit(currentCount: number, tier: PlanTier): boolean {
  const limit = getOrderLimit(tier);
  if (limit === Infinity) return false;
  return currentCount >= limit * 0.9;
}

/**
 * Check if hard limit is reached (base + 10% buffer)
 * App should disable at this point
 */
export function isLimitReached(currentCount: number, tier: PlanTier): boolean {
  const hardLimit = getHardOrderLimit(tier);
  if (hardLimit === Infinity) return false;
  return currentCount >= hardLimit;
}

/**
 * Check if in grace period (between base limit and hard limit)
 */
export function isInGracePeriod(currentCount: number, tier: PlanTier): boolean {
  const baseLimit = getOrderLimit(tier);
  const hardLimit = getHardOrderLimit(tier);
  if (baseLimit === Infinity) return false;
  return currentCount >= baseLimit && currentCount < hardLimit;
}

/**
 * Calculate remaining orders
 */
export function getRemainingOrders(currentCount: number, tier: PlanTier): number {
  const limit = getOrderLimit(tier);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - currentCount);
}

/**
 * Format order limit for display
 */
export function formatOrderLimit(tier: PlanTier): string {
  const limit = getOrderLimit(tier);
  if (limit === Infinity) return "Unlimited";
  return limit.toLocaleString();
}

/**
 * Get all plans sorted by price
 */
export function getAllPlans(): PricingPlan[] {
  return Object.values(PRICING_PLANS).sort((a, b) => a.price - b.price);
}

/**
 * Check if plan A is higher tier than plan B
 */
export function isHigherTier(planA: PlanTier, planB: PlanTier): boolean {
  const prices: Record<PlanTier, number> = {
    starter: 29,
    growth: 79,
    pro: 199
  };
  return prices[planA] > prices[planB];
}
