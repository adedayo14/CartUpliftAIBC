-- Migration: Convert FREE plan to STARTER trial
-- This migration updates existing subscriptions from the removed FREE tier

-- Update all existing FREE subscriptions to STARTER with 14-day trial
UPDATE "Subscription"
SET
  "planTier" = 'starter',
  "planStatus" = 'trial',
  "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "planTier" = 'free';

-- Update the default values (already done in schema.prisma, but documenting here)
-- New default: planTier = 'starter', planStatus = 'trial'
