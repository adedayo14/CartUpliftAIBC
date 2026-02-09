-- Add onboarding tracking fields to Settings table
-- This migration is backward compatible and uses ALTER TABLE ADD COLUMN IF NOT EXISTS

-- Add onboarding completion tracking
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- Add individual step tracking
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingStepThemeEditor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingStepRecommendations" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingStepFirstBundle" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingStepPreview" BOOLEAN NOT NULL DEFAULT false;

-- Add dismissal tracking
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "onboardingDismissed" BOOLEAN NOT NULL DEFAULT false;
