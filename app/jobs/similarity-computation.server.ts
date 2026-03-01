/**
 * ============================================================================
 * SIMILARITY COMPUTATION JOB
 * ============================================================================
 *
 * PURPOSE:
 * Analyzes actual order data, product metadata, and browsing behavior to compute
 * product-to-product similarity scores. Fills MLProductSimilarity table.
 *
 * RUNS: Weekly (more compute-intensive than daily learning)
 *
 * SCORES:
 * - coPurchaseScore: How often products are bought together (Jaccard + frequency)
 * - categoryScore: Category overlap between products (Jaccard on category arrays)
 * - priceScore: Price proximity (1 - |diff| / max price)
 * - coViewScore: How often products are viewed in the same session
 * - overallScore: Weighted combination of all scores
 *
 * WEIGHTS: coPurchase 0.4, category 0.2, price 0.1, coView 0.3
 */

import prisma from "~/db.server";
import { startHealthLog } from "~/services/health-logger.server";
import { logger } from "~/utils/logger.server";
import { getAllProductCategoryAndPriceMap } from "~/services/bigcommerce-api.server";

interface ProductPair {
  productId1: string;
  productId2: string;
  coPurchaseCount: number;
  sharedCustomers: Set<string>;
}

interface CoViewPair {
  count: number;
  sharedSessions: Set<string>;
}

interface ProductMetadata {
  id: string;
  totalOrders: number;
  customers: Set<string>;
}

// Score weights for the overall similarity calculation
const WEIGHTS = {
  coPurchase: 0.4,
  category: 0.2,
  price: 0.1,
  coView: 0.3,
};

/**
 * Calculate category similarity using Jaccard index on category arrays.
 * Returns 0-1 score where 1 = identical categories.
 */
function computeCategoryScore(cats1: number[], cats2: number[]): number {
  if (cats1.length === 0 && cats2.length === 0) return 0;
  if (cats1.length === 0 || cats2.length === 0) return 0;

  const set1 = new Set(cats1);
  const set2 = new Set(cats2);

  let intersection = 0;
  for (const c of set1) {
    if (set2.has(c)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Calculate price similarity as proximity score.
 * Returns 0-1 score where 1 = same price, 0 = vastly different.
 */
function computePriceScore(price1: number, price2: number): number {
  if (price1 <= 0 && price2 <= 0) return 0;
  const maxPrice = Math.max(price1, price2);
  if (maxPrice === 0) return 0;
  return 1 - Math.abs(price1 - price2) / maxPrice;
}

/**
 * Run similarity computation for a single shop
 */
export async function runSimilarityComputation(shop: string) {
  const healthLogger = await startHealthLog(shop, 'similarity_computation');

  healthLogger.log(`[SIMILARITY] Starting computation for shop: ${shop}`);

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // ── Step 1: Fetch purchase events ──
    const purchaseEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash: shop,
        event: 'purchase',
        createdAt: { gte: ninetyDaysAgo },
        orderId: { not: null }
      },
      select: {
        orderId: true,
        productId: true,
        sessionId: true
      }
    });

    // ── Step 2: Fetch product_view events for co-view scoring ──
    const viewEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash: shop,
        event: 'product_view',
        createdAt: { gte: ninetyDaysAgo },
        sessionId: { not: null }
      },
      select: {
        productId: true,
        sessionId: true
      }
    });

    healthLogger.log(`[SIMILARITY] Data: ${purchaseEvents.length} purchases, ${viewEvents.length} views`);

    if (purchaseEvents.length === 0 && viewEvents.length === 0) {
      healthLogger.log(`[SIMILARITY] No data for ${shop} - skipping`);
      return { shop, analyzed: 0, similaritiesCreated: 0 };
    }

    // ── Step 3: Fetch product categories & prices from BigCommerce API ──
    let productCatalog = new Map<string, { categories: number[]; price: number }>();
    try {
      productCatalog = await getAllProductCategoryAndPriceMap(shop);
      healthLogger.log(`[SIMILARITY] Fetched catalog data for ${productCatalog.size} products`);
    } catch (err) {
      healthLogger.log(`[SIMILARITY] Could not fetch catalog data, proceeding without category/price scores`);
    }

    // ── Step 4: Build co-purchase matrix ──
    const orderMap = new Map<string, Set<string>>();
    const productMetadata = new Map<string, ProductMetadata>();

    for (const event of purchaseEvents) {
      if (!event.orderId) continue;

      if (!orderMap.has(event.orderId)) {
        orderMap.set(event.orderId, new Set());
      }
      orderMap.get(event.orderId)!.add(event.productId);

      if (!productMetadata.has(event.productId)) {
        productMetadata.set(event.productId, {
          id: event.productId,
          totalOrders: 0,
          customers: new Set()
        });
      }
      const meta = productMetadata.get(event.productId)!;
      meta.totalOrders++;
      meta.customers.add(event.orderId);
    }

    const purchasePairMap = new Map<string, ProductPair>();

    for (const [orderId, productIds] of orderMap.entries()) {
      const productsArray = Array.from(productIds);

      for (let i = 0; i < productsArray.length; i++) {
        for (let j = i + 1; j < productsArray.length; j++) {
          const [id1, id2] = [productsArray[i], productsArray[j]].sort();
          const pairKey = `${id1}|${id2}`;

          if (!purchasePairMap.has(pairKey)) {
            purchasePairMap.set(pairKey, {
              productId1: id1,
              productId2: id2,
              coPurchaseCount: 0,
              sharedCustomers: new Set()
            });
          }

          const pair = purchasePairMap.get(pairKey)!;
          pair.coPurchaseCount++;
          pair.sharedCustomers.add(orderId);
        }
      }
    }

    // ── Step 5: Build co-view matrix ──
    const sessionViewMap = new Map<string, Set<string>>();

    for (const event of viewEvents) {
      if (!event.sessionId) continue;
      if (!sessionViewMap.has(event.sessionId)) {
        sessionViewMap.set(event.sessionId, new Set());
      }
      sessionViewMap.get(event.sessionId)!.add(event.productId);
    }

    const coViewPairMap = new Map<string, CoViewPair>();
    let totalViewSessions = 0;

    for (const [_sessionId, productIds] of sessionViewMap.entries()) {
      if (productIds.size < 2) continue; // Need at least 2 products viewed in a session
      totalViewSessions++;

      const productsArray = Array.from(productIds);
      for (let i = 0; i < productsArray.length; i++) {
        for (let j = i + 1; j < productsArray.length; j++) {
          const [id1, id2] = [productsArray[i], productsArray[j]].sort();
          const pairKey = `${id1}|${id2}`;

          if (!coViewPairMap.has(pairKey)) {
            coViewPairMap.set(pairKey, { count: 0, sharedSessions: new Set() });
          }

          const cvPair = coViewPairMap.get(pairKey)!;
          cvPair.count++;
          cvPair.sharedSessions.add(_sessionId);
        }
      }
    }

    healthLogger.log(`[SIMILARITY] ${purchasePairMap.size} purchase pairs, ${coViewPairMap.size} co-view pairs from ${totalViewSessions} sessions`);

    // ── Step 6: Merge all pairs and compute scores ──
    // Collect all unique product pairs from both purchases and views
    const allPairKeys = new Set<string>();
    for (const key of purchasePairMap.keys()) allPairKeys.add(key);
    for (const key of coViewPairMap.keys()) allPairKeys.add(key);

    const similarityRecords: Array<{
      storeHash: string;
      productId1: string;
      productId2: string;
      categoryScore: number;
      priceScore: number;
      coViewScore: number;
      coPurchaseScore: number;
      overallScore: number;
      sampleSize: number;
    }> = [];

    for (const pairKey of allPairKeys) {
      const [id1, id2] = pairKey.split('|');
      const purchasePair = purchasePairMap.get(pairKey);
      const coViewPair = coViewPairMap.get(pairKey);

      // ── Co-purchase score ──
      let coPurchaseScore = 0;
      let sampleSize = 0;

      if (purchasePair) {
        const meta1 = productMetadata.get(id1);
        const meta2 = productMetadata.get(id2);

        if (meta1 && meta2) {
          const intersection = purchasePair.sharedCustomers.size;
          const union = meta1.customers.size + meta2.customers.size - intersection;
          const jaccardScore = union > 0 ? intersection / union : 0;
          const maxOrders = Math.max(meta1.totalOrders, meta2.totalOrders);
          const frequencyScore = maxOrders > 0 ? purchasePair.coPurchaseCount / maxOrders : 0;
          coPurchaseScore = (jaccardScore * 0.6) + (frequencyScore * 0.4);
        }

        sampleSize = purchasePair.coPurchaseCount;
      }

      // ── Category score ──
      const catalog1 = productCatalog.get(id1);
      const catalog2 = productCatalog.get(id2);
      const categoryScore = (catalog1 && catalog2)
        ? computeCategoryScore(catalog1.categories, catalog2.categories)
        : 0;

      // ── Price score ──
      const priceScore = (catalog1 && catalog2)
        ? computePriceScore(catalog1.price, catalog2.price)
        : 0;

      // ── Co-view score ──
      let coViewScore = 0;
      if (coViewPair && totalViewSessions > 0) {
        // Normalize by total multi-product sessions
        coViewScore = Math.min(1, coViewPair.count / Math.max(totalViewSessions * 0.1, 1));
      }

      // ── Overall score (weighted) ──
      const overallScore =
        (coPurchaseScore * WEIGHTS.coPurchase) +
        (categoryScore * WEIGHTS.category) +
        (priceScore * WEIGHTS.price) +
        (coViewScore * WEIGHTS.coView);

      // Only store if meaningful
      const hasPurchaseSignal = purchasePair && purchasePair.coPurchaseCount >= 2;
      const hasViewSignal = coViewPair && coViewPair.count >= 2;
      const hasCatalogSignal = categoryScore > 0.3;

      if (overallScore > 0.05 && (hasPurchaseSignal || hasViewSignal || hasCatalogSignal)) {
        // Create bidirectional records
        similarityRecords.push({
          storeHash: shop,
          productId1: id1,
          productId2: id2,
          categoryScore,
          priceScore,
          coViewScore,
          coPurchaseScore,
          overallScore,
          sampleSize: sampleSize + (coViewPair?.count || 0)
        });

        similarityRecords.push({
          storeHash: shop,
          productId1: id2,
          productId2: id1,
          categoryScore,
          priceScore,
          coViewScore,
          coPurchaseScore,
          overallScore,
          sampleSize: sampleSize + (coViewPair?.count || 0)
        });
      }
    }

    // ── Step 7: Store in database ──
    await prisma.$transaction(async (tx) => {
      await tx.mLProductSimilarity.deleteMany({
        where: { storeHash: shop }
      });

      const batchSize = 1000;
      for (let i = 0; i < similarityRecords.length; i += batchSize) {
        const batch = similarityRecords.slice(i, i + batchSize);
        await tx.mLProductSimilarity.createMany({
          data: batch,
          skipDuplicates: true
        });
      }
    });

    healthLogger.log(`[SIMILARITY] ${shop}: Created ${similarityRecords.length} similarity records`);

    await healthLogger.success({
      recordsProcessed: allPairKeys.size,
      recordsCreated: similarityRecords.length,
      metadata: {
        purchaseEvents: purchaseEvents.length,
        viewEvents: viewEvents.length,
        orderCount: orderMap.size,
        viewSessions: totalViewSessions,
        productCount: productMetadata.size,
        catalogProducts: productCatalog.size
      }
    });

    return {
      shop,
      analyzed: allPairKeys.size,
      similaritiesCreated: similarityRecords.length
    };

  } catch (error) {
    healthLogger.error(`[SIMILARITY] Error for ${shop}:`, error);

    await healthLogger.failure(error as Error);

    return {
      shop,
      analyzed: 0,
      similaritiesCreated: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Run similarity computation for all shops
 */
export async function runSimilarityComputationForAllShops() {
  logger.log(`[SIMILARITY] Starting computation for all shops`);

  try {
    const shops = await prisma.settings.findMany({
      select: { storeHash: true }
    });

    logger.log(`[SIMILARITY] Found ${shops.length} shops to process`);

    const results = [];
    for (const { storeHash: shop } of shops) {
      const result = await runSimilarityComputation(shop);
      results.push(result);
    }

    const successCount = results.filter(r => !r.error).length;
    const totalSimilarities = results.reduce((sum, r) => sum + r.similaritiesCreated, 0);

    logger.log(`[SIMILARITY] Batch complete: ${successCount}/${shops.length} shops, ${totalSimilarities} similarities created`);

    return {
      success: true,
      totalShops: shops.length,
      successfulShops: successCount,
      totalSimilarities,
      results
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('[SIMILARITY] Batch computation failed:', {
      error: errorMessage,
      stack: errorStack
    });
    return {
      success: false,
      error: errorMessage
    };
  }
}
