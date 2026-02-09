/**
 * ML Analytics Service
 * Provides data quality metrics and order statistics for ML personalization
 */

import { unauthenticated } from "~/shopify.server";
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

interface ShopifyGraphQLResponse {
  data?: {
    orders?: {
      edges?: Array<{
        node: {
          id: string;
          createdAt?: string;
        };
      }>;
      pageInfo?: {
        hasNextPage: boolean;
      };
    };
  };
  errors?: unknown[];
}

/**
 * Get order count and data quality metrics for a shop
 */
export async function getDataQualityMetrics(shop: string): Promise<DataQualityMetrics> {
  try {
    // Query Shopify for order count
    const { admin } = await unauthenticated.admin(shop);
    
    const response = await admin.graphql(`#graphql
      query getOrderCount {
        orders(first: 1) {
          edges {
            node {
              id
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `);

    if (!response.ok) {
      logger.warn('Failed to fetch order count from Shopify');
      return getDefaultMetrics();
    }

    const data: ShopifyGraphQLResponse = await response.json();
    
    // Get total order count (approximate from first query)
    // For exact count, we'd need to paginate, but this gives us a quick estimate
    const hasOrders = data?.data?.orders?.edges?.length > 0;
    
    if (!hasOrders) {
      return {
        orderCount: 0,
        qualityLevel: 'new_store',
        qualityScore: 0,
        hasEnoughData: false,
        recommendedMode: 'basic'
      };
    }

    // Fetch paginated orders to get accurate count (up to 250 for performance)
    const orderCountResponse = await admin.graphql(`#graphql
      query getOrderList {
        orders(first: 250, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              createdAt
            }
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `);

    const orderData: ShopifyGraphQLResponse = await orderCountResponse.json();
    const orders = orderData?.data?.orders?.edges || [];
    const hasMoreOrders = orderData?.data?.orders?.pageInfo?.hasNextPage || false;
    
    // Estimate total if we hit the limit
    let orderCount = orders.length;
    if (hasMoreOrders) {
      orderCount = Math.max(250, Math.floor(orderCount * 1.5)); // Conservative estimate
    }

    // Calculate quality metrics
    let qualityLevel: 'new_store' | 'growing' | 'good' | 'rich';
    let qualityScore: number;
    let recommendedMode: 'basic' | 'standard' | 'advanced';

    if (orderCount < 10) {
      qualityLevel = 'new_store';
      qualityScore = Math.min(orderCount * 5, 25); // 0-25
      recommendedMode = 'basic';
    } else if (orderCount < 100) {
      qualityLevel = 'growing';
      qualityScore = 25 + Math.min((orderCount - 10) * 0.5, 25); // 25-50
      recommendedMode = 'standard';
    } else if (orderCount < 500) {
      qualityLevel = 'good';
      qualityScore = 50 + Math.min((orderCount - 100) * 0.1, 25); // 50-75
      recommendedMode = 'advanced';
    } else {
      qualityLevel = 'rich';
      qualityScore = 75 + Math.min((orderCount - 500) * 0.01, 25); // 75-100
      recommendedMode = 'advanced';
    }

    return {
      orderCount,
      qualityLevel,
      qualityScore: Math.min(qualityScore, 100),
      hasEnoughData: orderCount >= 10,
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
  shop: string;
  productIds: string[];
  sessionId?: string;
  customerId?: string;
  source: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { shop, productIds, sessionId, customerId, source, metadata } = params;

    // Store multiple tracking events (one per product)
    const events = productIds.map((productId, index) => ({
      shop,
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
  shop: string;
  sessionId: string;
  customerId?: string;
  privacyLevel: 'basic' | 'standard' | 'advanced';
}) {
  try {
    const { shop, sessionId, customerId, privacyLevel } = params;

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
        shop_sessionId: {
          shop,
          sessionId
        }
      }
    });

    // Create if doesn't exist
    if (!profile && (privacyLevel === 'standard' || privacyLevel === 'advanced')) {
      profile = await prisma.mLUserProfile.create({
        data: {
          shop,
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
  shop: string;
  sessionId: string;
  interaction: {
    type: 'view' | 'cart' | 'purchase';
    productId: string;
  };
  privacyLevel: 'basic' | 'standard' | 'advanced';
}) {
  try {
    const { shop, sessionId, interaction, privacyLevel } = params;

    // Don't track for basic privacy
    if (privacyLevel === 'basic') {
      return { success: true };
    }

    const profile = await prisma.mLUserProfile.upsert({
      where: {
        shop_sessionId: {
          shop,
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
        shop,
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
