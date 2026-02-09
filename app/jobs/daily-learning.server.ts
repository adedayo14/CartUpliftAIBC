import db from "~/db.server";
import { startHealthLog } from "~/services/health-logger.server";
import { logger } from "~/utils/logger.server";

// ML-related type definitions
interface ProductStats {
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
}

interface ProductPerformanceUpdate {
  shop: string;
  productId: string;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
  ctr: number;
  cvr: number;
  confidence: number;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  lastUpdated: Date;
}

interface DailyLearningResult {
  success: boolean;
  productsAnalyzed?: number;
  blacklisted?: number;
  boosted?: number;
  error?: string;
  shop?: string;
}

/**
 * 🧠 DAILY LEARNING JOB
 * 
 * Purpose: Analyze recommendation performance and auto-adjust
 * Schedule: Daily at 2 AM
 * 
 * Process:
 * 1. Get last 30 days of tracking events (impressions, clicks)
 * 2. Get last 30 days of attribution data (purchases, revenue)
 * 3. Calculate per-product: CTR, CVR, confidence score
 * 4. Apply rules:
 *    - CVR < 0.5% after 100+ impressions → Blacklist
 *    - CVR > 2% → High confidence (boost)
 *    - CVR 0.5-2% → Medium confidence (neutral)
 * 5. Update MLProductPerformance table
 */

export async function runDailyLearning(shop: string): Promise<DailyLearningResult> {
  const healthLogger = await startHealthLog(shop, 'daily_learning');
  
  logger.log(`🧠 Starting daily learning for shop: ${shop}`);
  
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Step 1: Get all tracking events (impressions & clicks)
    const trackingEvents = await db.trackingEvent?.findMany({
      where: {
        shop,
        createdAt: { gte: thirtyDaysAgo },
        event: { in: ['ml_recommendation_served', 'impression', 'click'] }
      },
      select: {
        productId: true,
        event: true,
        metadata: true
      }
    }) || [];
    
    logger.log(`📊 Found ${trackingEvents.length} tracking events`);

    // Step 2: Get all attribution data (purchases)
    const attributions = await db.recommendationAttribution?.findMany({
      where: {
        shop,
        createdAt: { gte: thirtyDaysAgo }
      },
      select: {
        productId: true,
        attributedRevenue: true
      }
    }) || [];
    
    logger.log(`💰 Found ${attributions.length} attributed purchases`);

    // Step 3: Aggregate data per product
    const productStats = new Map<string, ProductStats>();
    
    // Count impressions and clicks
    for (const event of trackingEvents) {
      // Handle ml_recommendation_served events (contains multiple products)
      if (event.event === 'ml_recommendation_served') {
        try {
          const metadata = typeof event.metadata === 'string' 
            ? JSON.parse(event.metadata) 
            : event.metadata;
          
          const recommendedIds = metadata?.recommendationIds || [];
          
          for (const productId of recommendedIds) {
            if (!productStats.has(productId)) {
              productStats.set(productId, { impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
            }
            const stats = productStats.get(productId)!;
            stats.impressions++;
          }
        } catch (e) {
          logger.warn('Failed to parse metadata:', e);
        }
      } 
      // Handle individual impression/click events
      else {
        const productId = event.productId;
        if (!productStats.has(productId)) {
          productStats.set(productId, { impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
        }
        const stats = productStats.get(productId)!;
        
        if (event.event === 'impression') {
          stats.impressions++;
        } else if (event.event === 'click') {
          stats.clicks++;
        }
      }
    }
    
    // Count purchases and revenue
    for (const attr of attributions) {
      if (!productStats.has(attr.productId)) {
        productStats.set(attr.productId, { impressions: 0, clicks: 0, purchases: 0, revenue: 0 });
      }
      const stats = productStats.get(attr.productId)!;
      stats.purchases++;
      stats.revenue += attr.attributedRevenue || 0;
    }
    
    logger.log(`📈 Analyzed ${productStats.size} unique products`);

    // Step 4: Calculate metrics and apply rules
    const updates: ProductPerformanceUpdate[] = [];
    let blacklistedCount = 0;
    let boostedCount = 0;
    
    for (const [productId, stats] of productStats.entries()) {
      const { impressions, clicks, purchases, revenue } = stats;
      
      // Skip if insufficient data
      if (impressions < 10) {
        logger.log(`⏭️  Skipping ${productId}: Only ${impressions} impressions`);
        continue;
      }
      
      // Calculate rates
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const cvr = impressions > 0 ? purchases / impressions : 0;
      
      // Calculate confidence score (0-1)
      // Weighted: 40% CVR, 40% CTR, 20% sample size
      const sampleSizeScore = Math.min(impressions / 100, 1); // Maxes out at 100 impressions
      const confidence = (cvr * 0.4) + (ctr * 0.4) + (sampleSizeScore * 0.2);
      
      // Determine if should be blacklisted
      let isBlacklisted = false;
      let blacklistReason: string | null = null;
      
      if (impressions >= 100) {
        if (cvr < 0.005) { // Less than 0.5% conversion
          isBlacklisted = true;
          blacklistReason = 'low_cvr';
          blacklistedCount++;
        } else if (ctr < 0.03) { // Less than 3% click rate
          isBlacklisted = true;
          blacklistReason = 'low_ctr';
          blacklistedCount++;
        }
      }
      
      if (cvr > 0.02) { // Over 2% conversion
        boostedCount++;
      }
      
      updates.push({
        shop,
        productId,
        impressions,
        clicks,
        purchases,
        revenue,
        ctr,
        cvr,
        confidence,
        isBlacklisted,
        blacklistReason,
        lastUpdated: new Date()
      });
    }
    
    // Step 5: Bulk update database
    logger.log(`💾 Updating ${updates.length} product performance records`);

    for (const update of updates) {
      await db.mLProductPerformance?.upsert({
        where: {
          shop_productId: {
            shop: update.shop,
            productId: update.productId
          }
        },
        create: update,
        update: {
          impressions: update.impressions,
          clicks: update.clicks,
          purchases: update.purchases,
          revenue: update.revenue,
          ctr: update.ctr,
          cvr: update.cvr,
          confidence: update.confidence,
          isBlacklisted: update.isBlacklisted,
          blacklistReason: update.blacklistReason,
          lastUpdated: update.lastUpdated
        }
      }).catch((e: unknown) => {
        logger.warn(`Failed to update ${update.productId}:`, e);
        healthLogger.logError(e instanceof Error ? e : String(e));
      });
    }
    
    logger.log(`✅ Daily learning complete for ${shop}`);
    logger.log(`   📊 ${updates.length} products analyzed`);
    logger.log(`   🚫 ${blacklistedCount} products blacklisted`);
    logger.log(`   ⭐ ${boostedCount} high-performers identified`);

    await healthLogger.success({
      recordsProcessed: updates.length,
      recordsUpdated: updates.length,
      metadata: {
        blacklisted: blacklistedCount,
        boosted: boostedCount,
        trackingEvents: trackingEvents.length,
        attributions: attributions.length
      }
    });
    
    return {
      success: true,
      productsAnalyzed: updates.length,
      blacklisted: blacklistedCount,
      boosted: boostedCount
    };
    
  } catch (error: unknown) {
    logger.error(`❌ Daily learning failed for ${shop}:`, error);

    await healthLogger.failure(error instanceof Error ? error : String(error));
    
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

/**
 * Run learning for all shops
 */
export async function runDailyLearningForAllShops() {
  logger.log('🌍 Running daily learning for all shops...');
  
  try {
    // Get all unique shops from settings
    const shops = await db.settings?.findMany({
      select: { shop: true },
      distinct: ['shop']
    }) || [];
    
    logger.log(`Found ${shops.length} shops to process`);

    const results: DailyLearningResult[] = [];
    for (const { shop } of shops) {
      const result = await runDailyLearning(shop);
      results.push({ shop, ...result });
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.log(`✅ Daily learning complete: ${successful} succeeded, ${failed} failed`);

    return results;
  } catch (error: unknown) {
    logger.error('❌ Failed to run daily learning for all shops:', error);
    throw error;
  }
}
