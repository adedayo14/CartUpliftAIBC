-- Prisma Baseline Migration
-- Purpose: establish baseline for existing production DB to unblock `prisma migrate deploy` (P3005).
-- This file mirrors the current schema as defined by prisma/schema.prisma and should be treated as already applied in prod.

-- WARNING: This is a baseline artifact. When running against an already-provisioned DB,
-- ensure you baseline once (see https://pris.ly/d/migrate-baseline). In fresh envs, this
-- will create the initial schema.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."ExperimentStatus" AS ENUM ('running', 'completed', 'paused');

-- CreateEnum
CREATE TYPE "public"."ExperimentType" AS ENUM ('discount', 'bundle', 'shipping', 'upsell');

-- CreateEnum
CREATE TYPE "public"."AttributionWindow" AS ENUM ('session', '24h', '7d');

-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('assignment', 'exposure', 'conversion');

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Settings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "enableApp" BOOLEAN NOT NULL DEFAULT true,
    "showOnlyOnCartPage" BOOLEAN NOT NULL DEFAULT false,
    "autoOpenCart" BOOLEAN NOT NULL DEFAULT true,
    "enableFreeShipping" BOOLEAN NOT NULL DEFAULT false,
    "freeShippingThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "enableRecommendations" BOOLEAN NOT NULL DEFAULT false,
    "enableAddons" BOOLEAN NOT NULL DEFAULT false,
    "enableDiscountCode" BOOLEAN NOT NULL DEFAULT true,
    "enableNotes" BOOLEAN NOT NULL DEFAULT false,
    "enableExpressCheckout" BOOLEAN NOT NULL DEFAULT true,
    "enableAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "enableRecommendationTitleCaps" BOOLEAN NOT NULL DEFAULT false,
    "cartIcon" TEXT NOT NULL DEFAULT 'cart',
    "freeShippingText" TEXT NOT NULL DEFAULT 'You''re {amount} away from free shipping!',
    "freeShippingAchievedText" TEXT NOT NULL DEFAULT '🎉 Congratulations! You''ve unlocked free shipping!',
    "recommendationsTitle" TEXT NOT NULL DEFAULT 'You might also like',
    "actionText" TEXT NOT NULL DEFAULT 'Add discount code',
    "addButtonText" TEXT NOT NULL DEFAULT 'Add',
    "checkoutButtonText" TEXT NOT NULL DEFAULT 'CHECKOUT',
    "applyButtonText" TEXT NOT NULL DEFAULT 'Apply',
    "discountLinkText" TEXT NOT NULL DEFAULT '+ Got a promotion code?',
    "notesLinkText" TEXT NOT NULL DEFAULT '+ Add order notes',
    "backgroundColor" TEXT NOT NULL DEFAULT '#ffffff',
    "textColor" TEXT NOT NULL DEFAULT '#1A1A1A',
    "buttonColor" TEXT NOT NULL DEFAULT '#000000',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#ffffff',
    "recommendationsBackgroundColor" TEXT NOT NULL DEFAULT '#ecebe3',
    "shippingBarBackgroundColor" TEXT NOT NULL DEFAULT '#f0f0f0',
    "shippingBarColor" TEXT NOT NULL DEFAULT '#121212',
    "recommendationLayout" TEXT NOT NULL DEFAULT 'horizontal',
    "maxRecommendations" INTEGER NOT NULL DEFAULT 6,
    "maxRecommendationProducts" INTEGER NOT NULL DEFAULT 4,
    "complementDetectionMode" TEXT NOT NULL DEFAULT 'automatic',
    "manualRecommendationProducts" TEXT NOT NULL DEFAULT '',
    "progressBarMode" TEXT NOT NULL DEFAULT 'free-shipping',
    "enableGiftGating" BOOLEAN NOT NULL DEFAULT false,
    "giftProgressStyle" TEXT NOT NULL DEFAULT 'single-next',
    "giftThresholds" TEXT NOT NULL DEFAULT '[]',
    "giftNoticeText" TEXT NOT NULL DEFAULT 'Free gift added: {{product}} (worth {{amount}})',
    "giftPriceText" TEXT NOT NULL DEFAULT 'FREE',
    "mlPersonalizationMode" TEXT NOT NULL DEFAULT 'basic',
    "enableMLRecommendations" BOOLEAN NOT NULL DEFAULT false,
    "mlPrivacyLevel" TEXT NOT NULL DEFAULT 'basic',
    "enableAdvancedPersonalization" BOOLEAN NOT NULL DEFAULT false,
    "enableBehaviorTracking" BOOLEAN NOT NULL DEFAULT false,
    "mlDataRetentionDays" TEXT NOT NULL DEFAULT '30',
    "hideRecommendationsAfterThreshold" BOOLEAN NOT NULL DEFAULT false,
    "enableThresholdBasedSuggestions" BOOLEAN NOT NULL DEFAULT false,
    "thresholdSuggestionMode" TEXT NOT NULL DEFAULT 'smart',
    "enableManualRecommendations" BOOLEAN NOT NULL DEFAULT false,
    "enableSmartBundles" BOOLEAN NOT NULL DEFAULT false,
    "bundlesOnProductPages" BOOLEAN NOT NULL DEFAULT true,
    "bundlesInCartDrawer" BOOLEAN NOT NULL DEFAULT false,
    "bundlesOnCollectionPages" BOOLEAN NOT NULL DEFAULT false,
    "bundlesOnCartPage" BOOLEAN NOT NULL DEFAULT false,
    "bundlesOnCheckoutPage" BOOLEAN NOT NULL DEFAULT false,
    "defaultBundleDiscount" TEXT NOT NULL DEFAULT '15',
    "bundleTitleTemplate" TEXT NOT NULL DEFAULT 'Complete your setup',
    "bundleDiscountPrefix" TEXT NOT NULL DEFAULT 'BUNDLE',
    "bundleConfidenceThreshold" TEXT NOT NULL DEFAULT 'medium',
    "bundleSavingsFormat" TEXT NOT NULL DEFAULT 'both',
    "showIndividualPricesInBundle" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyBundleDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "themeEmbedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "themeEmbedLastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Bundle" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categoryIds" TEXT,
    "productIds" TEXT NOT NULL,
    "minProducts" INTEGER NOT NULL DEFAULT 2,
    "maxProducts" INTEGER,
    "aiAutoApprove" BOOLEAN NOT NULL DEFAULT false,
    "aiDiscountMax" DOUBLE PRECISION,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalAddToCart" INTEGER NOT NULL DEFAULT 0,
    "totalPurchases" INTEGER NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "displayTitle" TEXT,
    "displayRules" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BundleProduct" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "productTitle" TEXT,
    "productHandle" TEXT,
    "productPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerBundle" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "customerId" TEXT,
    "bundleId" TEXT NOT NULL,
    "sessionId" TEXT,
    "action" TEXT NOT NULL,
    "cartValue" DOUBLE PRECISION,
    "discountApplied" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ab_experiments" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."ExperimentType" NOT NULL DEFAULT 'discount',
    "status" "public"."ExperimentStatus" NOT NULL DEFAULT 'running',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "active_variant_id" INTEGER,
    "attribution" "public"."AttributionWindow" NOT NULL DEFAULT 'session',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ab_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ab_variants" (
    "id" SERIAL NOT NULL,
    "experiment_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "value_format" TEXT NOT NULL DEFAULT 'percent',
    "traffic_pct" DECIMAL(65,30) NOT NULL DEFAULT 50.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ab_events" (
    "id" SERIAL NOT NULL,
    "type" "public"."EventType" NOT NULL,
    "experiment_id" INTEGER NOT NULL,
    "variant_id" INTEGER,
    "unit_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30),
    "currency" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ab_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."analytics_events" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sessionId" TEXT,
    "customerId" TEXT,
    "orderId" TEXT,
    "orderValue" DECIMAL(65,30),
    "currency" TEXT DEFAULT 'USD',
    "bundleId" TEXT,
    "productIds" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shop_key" ON "public"."Settings"("shop");

-- CreateIndex
CREATE INDEX "Bundle_shop_idx" ON "public"."Bundle"("shop");

-- CreateIndex
CREATE INDEX "BundleProduct_bundleId_idx" ON "public"."BundleProduct"("bundleId");

-- CreateIndex
CREATE INDEX "BundleProduct_productId_idx" ON "public"."BundleProduct"("productId");

-- CreateIndex
CREATE INDEX "CustomerBundle_shop_idx" ON "public"."CustomerBundle"("shop");

-- CreateIndex
CREATE INDEX "CustomerBundle_bundleId_idx" ON "public"."CustomerBundle"("bundleId");

-- CreateIndex
CREATE INDEX "CustomerBundle_customerId_idx" ON "public"."CustomerBundle"("customerId");

-- CreateIndex
CREATE INDEX "ab_events_experiment_id_variant_id_occurred_at_idx" ON "public"."ab_events"("experiment_id", "variant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ab_events_type_occurred_at_idx" ON "public"."ab_events"("type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_shop_timestamp_idx" ON "public"."analytics_events"("shop", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_shop_eventType_timestamp_idx" ON "public"."analytics_events"("shop", "eventType", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_bundleId_timestamp_idx" ON "public"."analytics_events"("bundleId", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_timestamp_idx" ON "public"."analytics_events"("sessionId", "timestamp" DESC);

-- AddForeignKey
ALTER TABLE "public"."BundleProduct" ADD CONSTRAINT "BundleProduct_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "public"."Bundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ab_variants" ADD CONSTRAINT "ab_variants_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ab_events" ADD CONSTRAINT "ab_events_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "public"."ab_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ab_events" ADD CONSTRAINT "ab_events_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."ab_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
