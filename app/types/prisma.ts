/**
 * Prisma Type Extensions
 * Properly typed interfaces for Prisma models and operations
 */

import type { PrismaClient, Prisma } from "@prisma/client";

// Re-export PrismaClient with proper typing
export type { PrismaClient };

// Type-safe database client
export type TypedPrismaClient = PrismaClient;

// Settings model types
export type SettingsModel = Prisma.SettingsGetPayload<{}>;
export type SettingsCreateInput = Prisma.SettingsCreateInput;
export type SettingsUpdateInput = Prisma.SettingsUpdateInput;
export type SettingsUpsertArgs = Prisma.SettingsUpsertArgs;

// Extended Settings type with all potential fields (handles schema mismatches)
export type ExtendedSettings = SettingsModel & {
  // Fields that might not be in production DB yet
  enableTitleCaps?: boolean;
  enableEnhancedBundles?: boolean;
  showPurchaseCounts?: boolean;
  showRecentlyViewed?: boolean;
  showTestimonials?: boolean;
  showTrustBadges?: boolean;
  highlightHighValue?: boolean;
  enhancedImages?: boolean;
  animatedSavings?: boolean;
  highValueThreshold?: number;
  bundlePriority?: string;
  badgeHighValueText?: string;
  badgePopularText?: string;
  badgeTrendingText?: string;
  testimonialsList?: string;
};

// Bundle model types
export type BundleModel = Prisma.BundleGetPayload<{}>;
export type BundleWithProducts = Prisma.BundleGetPayload<{
  include: { products: true };
}>;
export type BundleCreateInput = Prisma.BundleCreateInput;
export type BundleUpdateInput = Prisma.BundleUpdateInput;

// BundleProduct model types
export type BundleProductModel = Prisma.BundleProductGetPayload<{}>;
export type BundleProductCreateInput = Prisma.BundleProductCreateInput;

// Experiment model types (A/B Testing)
export type ExperimentModel = Prisma.ExperimentGetPayload<{}>;
export type ExperimentWithVariants = Prisma.ExperimentGetPayload<{
  include: { variants: true };
}>;
export type VariantModel = Prisma.VariantGetPayload<{}>;
export type EventModel = Prisma.EventGetPayload<{}>;

// Analytics model types
export type AnalyticsEventModel = Prisma.AnalyticsEventGetPayload<{}>;
export type TrackingEventModel = Prisma.TrackingEventGetPayload<{}>;

// ML model types
export type MLUserProfileModel = Prisma.MLUserProfileGetPayload<{}>;
export type MLProductSimilarityModel = Prisma.MLProductSimilarityGetPayload<{}>;
export type MLProductPerformanceModel = Prisma.MLProductPerformanceGetPayload<{}>;
export type RecommendationAttributionModel = Prisma.RecommendationAttributionGetPayload<{}>;

// Subscription model types
export type SubscriptionModel = Prisma.SubscriptionGetPayload<{}>;
export type BilledOrderModel = Prisma.BilledOrderGetPayload<{}>;

// Session model types
export type SessionModel = Prisma.SessionGetPayload<{}>;

// Common Prisma operation types
export type WhereUniqueInput<T> = T extends "settings"
  ? Prisma.SettingsWhereUniqueInput
  : T extends "bundle"
  ? Prisma.BundleWhereUniqueInput
  : T extends "experiment"
  ? Prisma.ExperimentWhereUniqueInput
  : never;

// Database error types
export interface PrismaError extends Error {
  code?: string;
  meta?: Record<string, unknown>;
  clientVersion?: string;
}

// Helper type for unknown field errors
export interface UnknownFieldError {
  message: string;
  fields: string[];
}
