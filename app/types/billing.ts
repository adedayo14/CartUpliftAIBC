/**
 * Billing Types
 * Shared types for billing that can be used in both client and server code
 */

export type PlanTier = "starter" | "growth" | "pro";

export interface PricingPlan {
  id: PlanTier;
  name: string;
  price: number;
  interval: "EVERY_30_DAYS" | "ANNUAL";
  orderLimit: number;
  trialDays: number;
  features: string[];
  supportLevel: string;
}

export interface SubscriptionInfo {
  shop: string;
  planTier: PlanTier;
  planStatus: string;
  orderCount: number;
  orderLimit: number;
  hardLimit: number;
  isApproaching: boolean;
  isInGrace: boolean;
  isLimitReached: boolean;
  trialEndsAt: Date | null;
  billingPeriodEnd: Date | null;
  billingPeriodStart: Date;
  isDevelopmentStore?: boolean;
}
