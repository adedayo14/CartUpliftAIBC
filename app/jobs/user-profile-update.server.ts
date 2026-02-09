/**
 * ============================================================================
 * USER PROFILE AUTO-UPDATE JOB
 * ============================================================================
 * 
 * PURPOSE:
 * Analyzes tracking events to automatically update MLUserProfile records.
 * Extracts behavioral patterns: viewed products, carted products, categories,
 * price preferences, etc.
 * 
 * RUNS: Daily (alongside learning job)
 * 
 * PRIVACY RESPECTING:
 * - Basic: Only anonymousId, no customer linking
 * - Standard: Session tracking, category preferences
 * - Advanced: Full tracking with customer ID, purchase history
 * 
 * LOGIC:
 * 1. Get all tracking events from last 30 days
 * 2. Group by sessionId (and customerId if privacy allows)
 * 3. Extract behavioral patterns:
 *    - Viewed products (impressions)
 *    - Carted products (add_to_cart events)
 *    - Purchased products (purchase events)
 *    - Category preferences (frequency analysis)
 *    - Price range preferences (min/max/avg)
 * 4. Update or create MLUserProfile records
 */

import prisma from "~/db.server";
import { startHealthLog } from "~/services/health-logger.server";
import { logger } from "~/utils/logger.server";

interface SessionBehavior {
  sessionId: string;
  customerId?: string;
  viewedProducts: Set<string>;
  cartedProducts: Set<string>;
  purchasedProducts: Set<string>;
  pricePoints: number[];
  lastActivity: Date;
  privacyLevel: string;
}

/**
 * Run user profile updates for a single shop
 */
export async function runUserProfileUpdate(shop: string, settings?: { mlPrivacyLevel?: string }) {
  const healthLogger = await startHealthLog(shop, 'profile_update');

  healthLogger.log(`🔄 [PROFILE UPDATE] Starting for shop: ${shop}`);
  
  try {
    // Get shop's privacy settings
    let privacyLevel = 'basic';
    if (settings?.mlPrivacyLevel) {
      privacyLevel = settings.mlPrivacyLevel;
    } else {
      const shopSettings = await prisma.settings.findUnique({
        where: { shop },
        select: { mlPrivacyLevel: true }
      });
      privacyLevel = shopSettings?.mlPrivacyLevel || 'basic';
    }
    
    // Get tracking events from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const events = await prisma.trackingEvent.findMany({
      where: {
        shop,
        createdAt: { gte: thirtyDaysAgo }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (events.length === 0) {
      healthLogger.log(`⚠️  [PROFILE UPDATE] No tracking events for ${shop} - skipping`);
      return { shop, profilesUpdated: 0, profilesCreated: 0 };
    }
    
    // Group events by session
    const sessionMap = new Map<string, SessionBehavior>();
    
    for (const event of events) {
      if (!event.sessionId) continue;
      
      if (!sessionMap.has(event.sessionId)) {
        sessionMap.set(event.sessionId, {
          sessionId: event.sessionId,
          customerId: event.customerId || undefined,
          viewedProducts: new Set(),
          cartedProducts: new Set(),
          purchasedProducts: new Set(),
          pricePoints: [],
          lastActivity: event.createdAt,
          privacyLevel
        });
      }
      
      const behavior = sessionMap.get(event.sessionId)!;
      
      // Update last activity
      if (event.createdAt > behavior.lastActivity) {
        behavior.lastActivity = event.createdAt;
      }
      
      // Track customerId if privacy allows
      if (privacyLevel === 'advanced' && event.customerId) {
        behavior.customerId = event.customerId;
      }
      
      // Categorize events
      switch (event.event) {
        case 'impression':
          behavior.viewedProducts.add(event.productId);
          break;
        case 'click':
          behavior.viewedProducts.add(event.productId);
          break;
        case 'add_to_cart':
          behavior.cartedProducts.add(event.productId);
          break;
        case 'purchase':
          behavior.purchasedProducts.add(event.productId);
          // Track price points for purchase events
          if (event.revenueCents) {
            behavior.pricePoints.push(event.revenueCents / 100);
          }
          break;
      }
    }

    healthLogger.log(`📊 [PROFILE UPDATE] Found ${sessionMap.size} unique sessions`);
    
    // Update or create profiles
    let profilesUpdated = 0;
    let profilesCreated = 0;
    
    for (const [sessionId, behavior] of sessionMap.entries()) {
      // Calculate price range preferences
      let priceRangePreference = null;
      if (behavior.pricePoints.length > 0) {
        const sortedPrices = behavior.pricePoints.sort((a, b) => a - b);
        priceRangePreference = {
          min: sortedPrices[0],
          max: sortedPrices[sortedPrices.length - 1],
          avg: sortedPrices.reduce((sum, p) => sum + p, 0) / sortedPrices.length,
          median: sortedPrices[Math.floor(sortedPrices.length / 2)]
        };
      }
      
      // Prepare profile data
      const profileData = {
        shop,
        sessionId,
        customerId: privacyLevel === 'advanced' ? behavior.customerId : null,
        anonymousId: privacyLevel === 'basic' ? `anon_${sessionId.slice(0, 8)}` : null,
        privacyLevel,
        viewedProducts: Array.from(behavior.viewedProducts),
        cartedProducts: Array.from(behavior.cartedProducts),
        purchasedProducts: Array.from(behavior.purchasedProducts),
        priceRangePreference: priceRangePreference || undefined,
        lastActivity: behavior.lastActivity,
        dataRetentionDays: 30
      };
      
      // Upsert profile
      try {
        const result = await prisma.mLUserProfile.upsert({
          where: {
            shop_sessionId: {
              shop,
              sessionId
            }
          },
          update: {
            customerId: profileData.customerId,
            viewedProducts: profileData.viewedProducts,
            cartedProducts: profileData.cartedProducts,
            purchasedProducts: profileData.purchasedProducts,
            priceRangePreference: profileData.priceRangePreference,
            lastActivity: profileData.lastActivity,
            privacyLevel: profileData.privacyLevel
          },
          create: profileData
        });
        
        if (result.createdAt === result.updatedAt) {
          profilesCreated++;
        } else {
          profilesUpdated++;
        }
      } catch (error) {
        healthLogger.error(`❌ [PROFILE UPDATE] Error upserting profile for session ${sessionId}:`, error);
        healthLogger.logError(error as Error);
      }
    }

    healthLogger.log(`✅ [PROFILE UPDATE] ${shop}: Updated ${profilesUpdated}, Created ${profilesCreated}`);

    await healthLogger.success({
      recordsProcessed: sessionMap.size,
      recordsCreated: profilesCreated,
      recordsUpdated: profilesUpdated,
      metadata: {
        trackingEvents: events.length,
        privacyLevel
      }
    });
    
    return {
      shop,
      profilesUpdated,
      profilesCreated,
      privacyLevel
    };

  } catch (error) {
    healthLogger.error(`❌ [PROFILE UPDATE] Error for ${shop}:`, error);

    await healthLogger.failure(error as Error);
    
    return {
      shop,
      profilesUpdated: 0,
      profilesCreated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Run user profile updates for all shops
 */
export async function runUserProfileUpdateForAllShops() {
  logger.log(`🚀 [PROFILE UPDATE] Starting batch update for all shops`);
  
  try {
    // Get all shops with their privacy settings
    const shops = await prisma.settings.findMany({
      select: { 
        shop: true,
        mlPrivacyLevel: true
      }
    });
    
    logger.log(`📋 [PROFILE UPDATE] Found ${shops.length} shops to process`);
    
    const results = [];
    for (const { shop, mlPrivacyLevel } of shops) {
      const result = await runUserProfileUpdate(shop, { mlPrivacyLevel });
      results.push(result);
    }
    
    const successCount = results.filter(r => !r.error).length;
    const totalUpdated = results.reduce((sum, r) => sum + r.profilesUpdated, 0);
    const totalCreated = results.reduce((sum, r) => sum + r.profilesCreated, 0);
    
    logger.log(`✅ [PROFILE UPDATE] Batch complete: ${successCount}/${shops.length} shops, ${totalUpdated} updated, ${totalCreated} created`);
    
    return {
      success: true,
      totalShops: shops.length,
      successfulShops: successCount,
      totalUpdated,
      totalCreated,
      results
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('❌ [PROFILE UPDATE] Batch update failed:', {
      error: errorMessage,
      stack: errorStack
    });
    return {
      success: false,
      error: errorMessage
    };
  }
}
