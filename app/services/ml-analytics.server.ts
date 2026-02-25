/**
 * ML Analytics Service
 * Provides data quality metrics and order statistics for ML personalization
 */

import { getOrders } from "~/services/bigcommerce-api.server";
import prismaClient from "~/db.server";
import { logger } from "~/utils/logger.server";

const prisma = prismaClient;

export interface DataQualityMetrics {
  orderCount: number;
  qualityLevel: 'new_store' | 'growing' | 'good' | 'rich';
  qualityScore: number; // 0-100
  hasEnoughData: boolean;
  recommendedMode: 'basic' | 'standard' | 'advanced';
}

/**
 * Get order count and data quality metrics for a store
 */
export async function getDataQualityMetrics(storeHash: string): Promise<DataQualityMetrics> {
  try {
    // Fetch recent orders from BigCommerce to estimate count
    const orders = await getOrders(storeHash, { limit: 250 });
    const orderCount = orders.length;

    if (orderCount === 0) {
      return {
        orderCount: 0,
        qualityLevel: 'new_store',
        qualityScore: 0,
        hasEnoughData: false,
        recommendedMode: 'basic'
      };
    }

    // If we got 250 orders, there are likely more
    const estimatedCount = orderCount >= 250 ? Math.floor(orderCount * 1.5) : orderCount;

    // Calculate quality metrics
    let qualityLevel: 'new_store' | 'growing' | 'good' | 'rich';
    let qualityScore: number;
    let recommendedMode: 'basic' | 'standard' | 'advanced';

    if (estimatedCount < 10) {
      qualityLevel = 'new_store';
      qualityScore = Math.min(estimatedCount * 5, 25); // 0-25
      recommendedMode = 'basic';
    } else if (estimatedCount < 100) {
      qualityLevel = 'growing';
      qualityScore = 25 + Math.min((estimatedCount - 10) * 0.5, 25); // 25-50
      recommendedMode = 'standard';
    } else if (estimatedCount < 500) {
      qualityLevel = 'good';
      qualityScore = 50 + Math.min((estimatedCount - 100) * 0.1, 25); // 50-75
      recommendedMode = 'advanced';
    } else {
      qualityLevel = 'rich';
      qualityScore = 75 + Math.min((estimatedCount - 500) * 0.01, 25); // 75-100
      recommendedMode = 'advanced';
    }

    return {
      orderCount: estimatedCount,
      qualityLevel,
      qualityScore: Math.min(qualityScore, 100),
      hasEnoughData: estimatedCount >= 10,
      recommendedMode
    };

  } catch (error) {
    logger.error('Error fetching data quality metrics:', error);
    return getDefaultMetrics();
  }
}

function getDefaultMetrics(): DataQualityMetrics {
  return {
    orderCount: 0,
    qualityLevel: 'new_store',
    qualityScore: 0,
    hasEnoughData: false,
    recommendedMode: 'basic'
  };
}

/**
 * Track ML recommendation event
 */
export async function trackMLRecommendation(params: {
  storeHash: string;
  productIds: string[];
  sessionId?: string;
  customerId?: string;
  source: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { storeHash, productIds, sessionId, customerId, source, metadata } = params;

    // Store multiple tracking events (one per product)
    const events = productIds.map((productId, index) => ({
      storeHash,
      event: 'ml_recommendation_served',
      productId,
      sessionId: sessionId || 'anonymous',
      customerId: customerId || null,
      source,
      position: index,
      metadata: metadata ? JSON.stringify(metadata) : null,
    }));

    await prisma.trackingEvent.createMany({
      data: events,
      skipDuplicates: true,
    });

    return { success: true };
  } catch (error) {
    logger.error('Error tracking ML recommendation:', error);
    return { success: false };
  }
}

/**
 * Get ML profile for user (respecting privacy settings)
 */
export async function getMLUserProfile(params: {
  storeHash: string;
  sessionId: string;
  customerId?: string;
  privacyLevel: 'basic' | 'standard' | 'advanced';
}) {
  try {
    const { storeHash, sessionId, customerId, privacyLevel } = params;

    // For basic privacy, return minimal profile
    if (privacyLevel === 'basic') {
      return {
        sessionId,
        privacyLevel,
        viewedProducts: [],
        preferences: {}
      };
    }

    // Try to find existing profile
    let profile = await prisma.mLUserProfile.findUnique({
      where: {
        storeHash_sessionId: {
          storeHash,
          sessionId
        }
      }
    });

    // Create if doesn't exist
    if (!profile && (privacyLevel === 'standard' || privacyLevel === 'advanced')) {
      profile = await prisma.mLUserProfile.create({
        data: {
          storeHash,
          sessionId,
          customerId: privacyLevel === 'advanced' ? customerId : null,
          privacyLevel,
          lastActivity: new Date(),
        }
      });
    }

    return profile;
  } catch (error) {
    logger.error('Error fetching ML user profile:', error);
    return null;
  }
}

/**
 * Update ML user profile with new interaction
 */
export async function updateMLUserProfile(params: {
  storeHash: string;
  sessionId: string;
  interaction: {
    type: 'view' | 'cart' | 'purchase';
    productId: string;
  };
  privacyLevel: 'basic' | 'standard' | 'advanced';
}) {
  try {
    const { storeHash, sessionId, interaction, privacyLevel } = params;

    // Don't track for basic privacy
    if (privacyLevel === 'basic') {
      return { success: true };
    }

    const profile = await prisma.mLUserProfile.upsert({
      where: {
        storeHash_sessionId: {
          storeHash,
          sessionId
        }
      },
      update: {
        lastActivity: new Date(),
        // Update interaction arrays based on type
        ...(interaction.type === 'view' && {
          viewedProducts: {
            push: interaction.productId
          }
        }),
        ...(interaction.type === 'cart' && {
          cartedProducts: {
            push: interaction.productId
          }
        }),
        ...(interaction.type === 'purchase' && {
          purchasedProducts: {
            push: interaction.productId
          }
        }),
      },
      create: {
        storeHash,
        sessionId,
        privacyLevel,
        lastActivity: new Date(),
        viewedProducts: interaction.type === 'view' ? [interaction.productId] : [],
        cartedProducts: interaction.type === 'cart' ? [interaction.productId] : [],
        purchasedProducts: interaction.type === 'purchase' ? [interaction.productId] : [],
      }
    });

    return { success: true, profile };
  } catch (error) {
    logger.error('Error updating ML user profile:', error);
    return { success: false };
  }
}
