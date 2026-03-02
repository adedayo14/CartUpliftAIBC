/**
 * ============================================================================
 * WEIGHT LEARNING JOB (Logistic Regression)
 * ============================================================================
 *
 * PURPOSE:
 * Learns optimal similarity weights from actual click/purchase feedback data.
 * Replaces hardcoded WEIGHTS = {coPurchase: 0.4, category: 0.2, price: 0.1, coView: 0.3}
 * with per-store learned weights via logistic regression.
 *
 * RUNS: Daily at 2:15 AM (after daily-learning, before profile updates)
 *
 * ALGORITHM:
 * 1. Collect recommendation impression events (ml_recommendation_served)
 * 2. For each recommended product, look up feature vector from MLProductSimilarity
 * 3. Label: 1 if clicked/purchased/carted within 30 min, 0 otherwise
 * 4. Train logistic regression with L2 regularization + early stopping
 * 5. Normalize raw weights to sum to 1.0
 * 6. Quality gate: only use if accuracy > 55% and >= 100 training examples
 */

import prisma from "~/db.server";
import { startHealthLog } from "~/services/health-logger.server";
import { logger } from "~/utils/logger.server";

// ── Types ──

interface TrainingExample {
  features: number[]; // [coPurchaseScore, categoryScore, priceScore, coViewScore]
  label: number;      // 0 or 1
}

interface LogisticRegressionResult {
  weights: number[];
  bias: number;
  accuracy: number;
  logLoss: number;
  iterations: number;
}

interface NormalizedWeights {
  coPurchase: number;
  category: number;
  price: number;
  coView: number;
}

interface WeightLearningResult {
  shop: string;
  trainingSize: number;
  isFallback: boolean;
  weights?: NormalizedWeights;
  accuracy?: number;
  error?: string;
}

// ── Logistic Regression (Pure TypeScript) ──

function sigmoid(z: number): number {
  const clipped = Math.max(-500, Math.min(500, z));
  return 1 / (1 + Math.exp(-clipped));
}

function trainLogisticRegression(
  data: TrainingExample[],
  learningRate: number = 0.1,
  maxIterations: number = 200,
  lambda: number = 0.01 // L2 regularization
): LogisticRegressionResult {
  const numFeatures = data[0].features.length; // 4
  let weights = new Array(numFeatures).fill(0);
  let bias = 0;

  // Shuffle and split 80/20 for train/validation
  const shuffled = [...data].sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const train = shuffled.slice(0, splitIdx);
  const val = shuffled.slice(splitIdx);

  let bestValLoss = Infinity;
  let bestWeights = [...weights];
  let bestBias = bias;
  const patience = 20;
  let patienceCounter = 0;
  let actualIterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    actualIterations = iter + 1;

    // Gradient computation (full batch — fine for <100K examples)
    const gradW = new Array(numFeatures).fill(0);
    let gradB = 0;

    for (const example of train) {
      const z = example.features.reduce((sum, f, i) => sum + f * weights[i], 0) + bias;
      const pred = sigmoid(z);
      const error = pred - example.label;

      for (let j = 0; j < numFeatures; j++) {
        gradW[j] += error * example.features[j] + lambda * weights[j];
      }
      gradB += error;
    }

    // Update weights
    const n = train.length;
    for (let j = 0; j < numFeatures; j++) {
      weights[j] -= learningRate * (gradW[j] / n);
    }
    bias -= learningRate * (gradB / n);

    // Early stopping on validation loss (check every 5 iterations)
    if (val.length > 0 && iter % 5 === 0) {
      let valLoss = 0;
      for (const ex of val) {
        const z = ex.features.reduce((s, f, i) => s + f * weights[i], 0) + bias;
        const p = sigmoid(z);
        valLoss -= ex.label * Math.log(p + 1e-10) + (1 - ex.label) * Math.log(1 - p + 1e-10);
      }
      valLoss /= val.length;

      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        bestWeights = [...weights];
        bestBias = bias;
        patienceCounter = 0;
      } else {
        patienceCounter++;
        if (patienceCounter >= patience) break;
      }
    }
  }

  // Compute accuracy on validation set
  let correct = 0;
  for (const ex of val) {
    const z = ex.features.reduce((s, f, i) => s + f * bestWeights[i], 0) + bestBias;
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === ex.label) correct++;
  }
  const accuracy = val.length > 0 ? correct / val.length : 0;

  return {
    weights: bestWeights,
    bias: bestBias,
    accuracy,
    logLoss: bestValLoss === Infinity ? 0 : bestValLoss,
    iterations: actualIterations,
  };
}

/**
 * Convert raw LR weights to normalized similarity weights (sum to 1.0)
 */
function normalizeToSimilarityWeights(rawWeights: number[]): NormalizedWeights {
  // Use absolute values — magnitude indicates feature importance
  const abs = rawWeights.map((w) => Math.abs(w));
  const sum = abs.reduce((a, b) => a + b, 0);

  if (sum === 0) {
    return { coPurchase: 0.4, category: 0.2, price: 0.1, coView: 0.3 };
  }

  return {
    coPurchase: abs[0] / sum,
    category: abs[1] / sum,
    price: abs[2] / sum,
    coView: abs[3] / sum,
  };
}

// ── Main Job ──

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const MIN_EXAMPLES = 50;
const MIN_EXAMPLES_FOR_USE = 100;
const MIN_ACCURACY = 0.55;

export async function runWeightLearning(shop: string): Promise<WeightLearningResult> {
  const healthLogger = await startHealthLog(shop, "weight_learning");

  healthLogger.log(`[WEIGHT LEARNING] Starting for shop: ${shop}`);

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ── Step 1: Collect recommendation impression events ──
    const impressionEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash: shop,
        event: "ml_recommendation_served",
        createdAt: { gte: thirtyDaysAgo },
        sessionId: { not: null },
      },
      select: {
        sessionId: true,
        productId: true, // anchor product
        metadata: true,
        createdAt: true,
      },
    });

    if (impressionEvents.length < MIN_EXAMPLES) {
      healthLogger.log(
        `[WEIGHT LEARNING] Only ${impressionEvents.length} impressions (need ${MIN_EXAMPLES}) — keeping fallback weights`
      );
      await prisma.mLLearnedWeights.upsert({
        where: { storeHash: shop },
        create: { storeHash: shop, isFallback: true, trainingSize: impressionEvents.length },
        update: { isFallback: true, trainingSize: impressionEvents.length, updatedAt: new Date() },
      });
      await healthLogger.success({ recordsProcessed: 0, metadata: { reason: "insufficient_impressions" } });
      return { shop, trainingSize: 0, isFallback: true };
    }

    // ── Step 2: Collect positive events (clicks, purchases, add_to_cart) for labeling ──
    const positiveEvents = await prisma.trackingEvent.findMany({
      where: {
        storeHash: shop,
        event: { in: ["click", "purchase", "add_to_cart"] },
        createdAt: { gte: thirtyDaysAgo },
        sessionId: { not: null },
      },
      select: {
        sessionId: true,
        productId: true,
        createdAt: true,
      },
    });

    // Build lookup: sessionId -> Map<productId, earliestPositiveTime>
    const positiveBySession = new Map<string, Map<string, Date>>();
    for (const e of positiveEvents) {
      if (!e.sessionId) continue;
      if (!positiveBySession.has(e.sessionId)) {
        positiveBySession.set(e.sessionId, new Map());
      }
      const sessionMap = positiveBySession.get(e.sessionId)!;
      // Keep the earliest positive event time
      if (!sessionMap.has(e.productId) || e.createdAt < sessionMap.get(e.productId)!) {
        sessionMap.set(e.productId, e.createdAt);
      }
    }

    // ── Step 3: Fetch all similarity scores for this shop ──
    const similarities = await prisma.mLProductSimilarity.findMany({
      where: { storeHash: shop },
      select: {
        productId1: true,
        productId2: true,
        coPurchaseScore: true,
        categoryScore: true,
        priceScore: true,
        coViewScore: true,
      },
    });

    // Build lookup: "productId1|productId2" -> feature vector
    const simLookup = new Map<string, number[]>();
    for (const s of similarities) {
      simLookup.set(`${s.productId1}|${s.productId2}`, [
        s.coPurchaseScore,
        s.categoryScore,
        s.priceScore,
        s.coViewScore,
      ]);
    }

    healthLogger.log(
      `[WEIGHT LEARNING] Data: ${impressionEvents.length} impressions, ${positiveEvents.length} positive events, ${similarities.length} similarity pairs`
    );

    // ── Step 4: Build training examples ──
    const examples: TrainingExample[] = [];

    for (const imp of impressionEvents) {
      if (!imp.sessionId) continue;

      // Parse metadata to get recommended product IDs
      let metadata: Record<string, unknown>;
      try {
        metadata = typeof imp.metadata === "string" ? JSON.parse(imp.metadata) : (imp.metadata as Record<string, unknown>) || {};
      } catch {
        continue;
      }

      const recIds: string[] = (metadata.recommendationIds as string[]) || [];
      const anchorId = imp.productId;

      for (const recId of recIds) {
        // Look up feature vector (try both directions)
        const features =
          simLookup.get(`${anchorId}|${recId}`) || simLookup.get(`${recId}|${anchorId}`);
        if (!features) continue; // No similarity data for this pair

        // Check if positive (clicked/purchased/carted within 30 min of impression)
        const sessionPositives = positiveBySession.get(imp.sessionId);
        let label = 0;
        if (sessionPositives?.has(recId)) {
          const posTime = sessionPositives.get(recId)!;
          const timeDiff = posTime.getTime() - imp.createdAt.getTime();
          if (timeDiff >= 0 && timeDiff <= THIRTY_MINUTES_MS) {
            label = 1;
          }
        }

        examples.push({ features, label });
      }
    }

    healthLogger.log(`[WEIGHT LEARNING] Built ${examples.length} training examples`);

    if (examples.length < MIN_EXAMPLES) {
      healthLogger.log(`[WEIGHT LEARNING] Not enough matched examples — keeping fallback weights`);
      await prisma.mLLearnedWeights.upsert({
        where: { storeHash: shop },
        create: { storeHash: shop, isFallback: true, trainingSize: examples.length },
        update: { isFallback: true, trainingSize: examples.length, updatedAt: new Date() },
      });
      await healthLogger.success({ recordsProcessed: examples.length, metadata: { reason: "insufficient_matched" } });
      return { shop, trainingSize: examples.length, isFallback: true };
    }

    // ── Step 5: Train logistic regression ──
    const result = trainLogisticRegression(examples, 0.1, 200, 0.01);
    const normalizedWeights = normalizeToSimilarityWeights(result.weights);

    healthLogger.log(
      `[WEIGHT LEARNING] Training complete: accuracy=${result.accuracy.toFixed(3)}, logLoss=${result.logLoss.toFixed(4)}, iterations=${result.iterations}`
    );
    healthLogger.log(
      `[WEIGHT LEARNING] Learned weights: coPurchase=${normalizedWeights.coPurchase.toFixed(3)}, category=${normalizedWeights.category.toFixed(3)}, price=${normalizedWeights.price.toFixed(3)}, coView=${normalizedWeights.coView.toFixed(3)}`
    );

    // ── Step 6: Quality gate ──
    const isFallback = result.accuracy < MIN_ACCURACY || examples.length < MIN_EXAMPLES_FOR_USE;

    if (isFallback) {
      healthLogger.log(
        `[WEIGHT LEARNING] Quality gate failed (accuracy=${result.accuracy.toFixed(3)}, examples=${examples.length}) — keeping fallback weights`
      );
    }

    // ── Step 7: Store ──
    await prisma.mLLearnedWeights.upsert({
      where: { storeHash: shop },
      create: {
        storeHash: shop,
        coPurchaseWeight: isFallback ? 0.4 : normalizedWeights.coPurchase,
        categoryWeight: isFallback ? 0.2 : normalizedWeights.category,
        priceWeight: isFallback ? 0.1 : normalizedWeights.price,
        coViewWeight: isFallback ? 0.3 : normalizedWeights.coView,
        trainingSize: examples.length,
        accuracy: result.accuracy,
        logLoss: result.logLoss,
        iterations: result.iterations,
        learningRate: 0.1,
        isFallback,
        trainedAt: new Date(),
      },
      update: {
        coPurchaseWeight: isFallback ? 0.4 : normalizedWeights.coPurchase,
        categoryWeight: isFallback ? 0.2 : normalizedWeights.category,
        priceWeight: isFallback ? 0.1 : normalizedWeights.price,
        coViewWeight: isFallback ? 0.3 : normalizedWeights.coView,
        trainingSize: examples.length,
        accuracy: result.accuracy,
        logLoss: result.logLoss,
        iterations: result.iterations,
        isFallback,
        trainedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await healthLogger.success({
      recordsProcessed: examples.length,
      metadata: {
        accuracy: result.accuracy,
        logLoss: result.logLoss,
        isFallback,
        weights: normalizedWeights,
      },
    });

    return {
      shop,
      trainingSize: examples.length,
      isFallback,
      weights: isFallback ? undefined : normalizedWeights,
      accuracy: result.accuracy,
    };
  } catch (error) {
    healthLogger.error(`[WEIGHT LEARNING] Error for ${shop}:`, error);
    await healthLogger.failure(error as Error);

    return {
      shop,
      trainingSize: 0,
      isFallback: true,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Run weight learning for all shops
 */
export async function runWeightLearningForAllShops() {
  logger.log(`[WEIGHT LEARNING] Starting batch for all shops`);

  try {
    const shops = await prisma.settings.findMany({
      select: { storeHash: true },
    });

    logger.log(`[WEIGHT LEARNING] Found ${shops.length} shops to process`);

    const results: WeightLearningResult[] = [];
    for (const { storeHash: shop } of shops) {
      const result = await runWeightLearning(shop);
      results.push(result);
    }

    const successCount = results.filter((r) => !r.error).length;
    const learnedCount = results.filter((r) => !r.isFallback).length;

    logger.log(
      `[WEIGHT LEARNING] Batch complete: ${successCount}/${shops.length} shops processed, ${learnedCount} with learned weights`
    );

    return {
      success: true,
      totalShops: shops.length,
      successfulShops: successCount,
      shopsWithLearnedWeights: learnedCount,
      results,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("[WEIGHT LEARNING] Batch failed:", { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}
