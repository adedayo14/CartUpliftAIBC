/**
 * Database Migration Utilities
 *
 * Provides runtime detection of database schema features to ensure
 * backward compatibility during rolling deployments.
 */

import prisma from "../db.server";

// Cache for feature detection to avoid repeated queries
const featureCache = new Map<string, { value: boolean; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute cache

/**
 * Check if onboarding fields exist in the Settings table
 * This allows the app to work both before and after the migration
 */
export async function hasOnboardingFields(): Promise<boolean> {
  const cacheKey = 'onboarding_fields';
  const cached = featureCache.get(cacheKey);

  // Return cached value if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  try {
    // Try to query one of the onboarding fields
    // If it exists, the query succeeds; if not, it throws
    await prisma.$queryRaw`
      SELECT "onboardingCompleted"
      FROM "Settings"
      LIMIT 1
    `;

    // Cache the positive result
    featureCache.set(cacheKey, { value: true, timestamp: Date.now() });
    return true;
  } catch (error) {
    // Field doesn't exist - cache the negative result
    featureCache.set(cacheKey, { value: false, timestamp: Date.now() });
    return false;
  }
}

/**
 * Safely query Settings with onboarding fields
 * Falls back to basic fields if onboarding fields don't exist
 */
export async function getSettingsWithOnboarding(shop: string) {
  const hasOnboarding = await hasOnboardingFields();

  if (hasOnboarding) {
    // Full query with onboarding fields
    return await prisma.settings.findUnique({
      where: { shop },
      select: {
        appEmbedActivated: true,
        appEmbedActivatedAt: true,
        enableRecommendations: true,
        enableMLRecommendations: true,
        onboardingCompleted: true,
        onboardingDismissed: true,
        onboardingStepThemeEditor: true,
        onboardingStepRecommendations: true,
        onboardingStepFirstBundle: true,
        onboardingStepPreview: true,
      }
    });
  } else {
    // Fallback query without onboarding fields
    return await prisma.settings.findUnique({
      where: { shop },
      select: {
        appEmbedActivated: true,
        appEmbedActivatedAt: true,
        enableRecommendations: true,
        enableMLRecommendations: true,
      }
    });
  }
}

/**
 * Safely update onboarding fields
 * Only updates if the fields exist in the database
 */
export async function updateOnboardingStep(
  shop: string,
  stepId: string
): Promise<boolean> {
  const hasOnboarding = await hasOnboardingFields();

  if (!hasOnboarding) {
    // If fields don't exist, just update basic activation for theme-editor
    if (stepId === "theme-editor") {
      await prisma.settings.upsert({
        where: { shop },
        update: {
          appEmbedActivated: true,
          appEmbedActivatedAt: new Date()
        },
        create: {
          shop,
          appEmbedActivated: true,
          appEmbedActivatedAt: new Date()
        },
      });
      return true;
    }
    return false;
  }

  // Build update data based on step
  const updateData: Record<string, boolean | Date> = {};

  if (stepId === "theme-editor") {
    updateData.onboardingStepThemeEditor = true;
    updateData.appEmbedActivated = true;
    updateData.appEmbedActivatedAt = new Date();
  } else if (stepId === "recommendations") {
    updateData.onboardingStepRecommendations = true;
  } else if (stepId === "first-bundle") {
    updateData.onboardingStepFirstBundle = true;
  } else if (stepId === "preview") {
    updateData.onboardingStepPreview = true;
  }

  // Check if all steps will be complete
  const currentSettings = await prisma.settings.findUnique({ where: { shop } });

  if (currentSettings) {
    const allStepsComplete =
      (updateData.onboardingStepThemeEditor || (currentSettings as any).onboardingStepThemeEditor) &&
      (updateData.onboardingStepRecommendations || (currentSettings as any).onboardingStepRecommendations) &&
      (updateData.onboardingStepFirstBundle || (currentSettings as any).onboardingStepFirstBundle) &&
      (updateData.onboardingStepPreview || (currentSettings as any).onboardingStepPreview);

    if (allStepsComplete) {
      updateData.onboardingCompleted = true;
      updateData.onboardingCompletedAt = new Date();
    }
  }

  await prisma.settings.upsert({
    where: { shop },
    update: updateData,
    create: { shop, ...updateData },
  });

  return true;
}

/**
 * Safely dismiss onboarding
 */
export async function dismissOnboarding(shop: string): Promise<boolean> {
  const hasOnboarding = await hasOnboardingFields();

  if (!hasOnboarding) {
    // Can't dismiss if fields don't exist - just return success
    return true;
  }

  await prisma.settings.upsert({
    where: { shop },
    update: { onboardingDismissed: true },
    create: { shop, onboardingDismissed: true },
  });

  return true;
}

/**
 * Clear the feature detection cache
 * Call this after running migrations
 */
export function clearFeatureCache() {
  featureCache.clear();
}
