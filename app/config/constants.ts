/**
 * ============================================================================
 * CARTUPLIFT - CENTRALIZED CONSTANTS
 * ============================================================================
 *
 * Single source of truth for all configurable values and magic numbers.
 *
 * DRY PRINCIPLE: Instead of scattering magic numbers throughout the codebase,
 * all thresholds, limits, weights, and configurable values are defined here.
 *
 * USAGE:
 * import { ML_THRESHOLDS, RECOMMENDATION_WEIGHTS } from "~/config/constants";
 *
 * BENEFITS:
 * - Easy to adjust thresholds without hunting through codebase
 * - Type-safe with TypeScript `as const`
 * - Self-documenting with inline comments
 * - A/B testing friendly (change values in one place)
 */

// ============================================================================
// ORDER LIMITS (Billing)
// ============================================================================

/**
 * Order limits per pricing tier
 * Used in billing.server.ts and subscription enforcement
 */
export const ORDER_LIMITS = {
  STARTER: 500,
  GROWTH: 2500,
  PRO: Infinity,
} as const;

/**
 * Grace buffer percentage for order limits
 * Provides 10% cushion before hard enforcement
 */
export const LIMIT_BUFFER_PERCENTAGE = 0.10; // 10% grace buffer

// ============================================================================
// ML & RECOMMENDATION THRESHOLDS
// ============================================================================

/**
 * Machine Learning configuration thresholds
 */
export const ML_THRESHOLDS = {
  /**
   * Minimum orders needed before ML can learn patterns
   * Below this, fall back to Shopify recommendations
   */
  MIN_ORDERS_FOR_LEARNING: 20,

  /**
   * Minimum orders for co-purchase analysis (scaled by order count)
   * - <50 orders: 2 co-occurrences needed
   * - <200 orders: 3 co-occurrences needed
   * - ≥200 orders: 5 co-occurrences needed
   */
  MIN_CO_OCCURRENCE_SMALL: 2,   // For shops with <50 orders
  MIN_CO_OCCURRENCE_MEDIUM: 3,  // For shops with <200 orders
  MIN_CO_OCCURRENCE_LARGE: 5,   // For shops with ≥200 orders

  /**
   * Minimum confidence score to show a recommendation
   * Prevents low-quality suggestions
   */
  MIN_CONFIDENCE_SCORE: 0.15,

  /**
   * Bundle performance threshold
   * Below this CTR, bundle gets auto-blacklisted
   */
  BLACKLIST_THRESHOLD: 0.05,

  /**
   * Minimum support (frequency) for similarity computation
   * Only consider product pairs appearing together at least this % of time
   */
  SUPPORT_THRESHOLD: 0.02, // 2%

  /**
   * Time decay half-life for order recency weighting (days)
   * Orders lose half their weight after this many days
   * ln(2) / half_life = decay rate
   */
  ORDER_DECAY_HALF_LIFE_DAYS: 45,

  /**
   * Historical data lookback window (days)
   * Only consider orders from last N days for ML learning
   */
  LOOKBACK_WINDOW_DAYS: 90,

  /**
   * Data retention limits (days)
   */
  DATA_RETENTION_OPTIONS: [7, 30, 60, 90] as const,
  DEFAULT_DATA_RETENTION_DAYS: 90,
} as const;

/**
 * Recommendation scoring weights
 * Used to balance different signals when ranking recommendations
 */
export const RECOMMENDATION_WEIGHTS = {
  /**
   * Click-Through Rate (CTR) weight in scoring
   * Higher = more emphasis on products users click
   */
  CTR: 0.35,

  /**
   * Conversion Rate (CVR) weight in scoring
   * Higher = more emphasis on products users buy
   */
  CVR: 0.40,

  /**
   * Recency weight in scoring
   * Higher = more emphasis on recent behavior
   */
  RECENCY: 0.25,

  /**
   * Baseline CTR for new products with no data
   * Used as fallback before we have click data
   */
  BASELINE_CTR: 0.05, // 5%

  /**
   * CTR multiplier range
   * Prevents extreme adjustments from outlier CTR values
   */
  CTR_MULTIPLIER_MIN: 0.85,
  CTR_MULTIPLIER_MAX: 1.25,
} as const;

/**
 * Similarity computation weights for different signals
 */
export const SIMILARITY_WEIGHTS = {
  /**
   * Co-purchase signal weight (bought together)
   * Highest weight - strongest signal of product affinity
   */
  CO_PURCHASE: 0.50,

  /**
   * Category/tag similarity weight
   * Medium weight - same category often go together
   */
  CATEGORY: 0.25,

  /**
   * Price similarity weight
   * Lower weight - people buy items at various price points
   */
  PRICE: 0.15,

  /**
   * Co-view behavior weight (viewed together)
   * Lowest weight - intent signal but not as strong as purchase
   */
  CO_VIEW: 0.10,
} as const;

// ============================================================================
// PRICE & DISCOUNT CONFIGURATION
// ============================================================================

/**
 * Price-based filtering ranges
 */
export const PRICE_CONFIG = {
  /**
   * Price gap acceptable range for recommendations
   * Only suggest products within 0.5x to 2.0x the anchor product price
   */
  PRICE_GAP_LOW: 0.5,   // Minimum acceptable price ratio (50% of anchor)
  PRICE_GAP_HIGH: 2.0,  // Maximum acceptable price ratio (200% of anchor)

  /**
   * Price similarity scoring
   * Used to calculate similarity between products based on price
   */
  PRICE_SIMILARITY_THRESHOLD: 0.7, // Consider similar if within 70% price match
} as const;

/**
 * Bundle discount calculation tiers
 * Based on bundle value, applied in calculateOptimalDiscount()
 */
export const DISCOUNT_TIERS = {
  /**
   * Small bundles (<$50): Conservative discount
   */
  SMALL_BUNDLE_THRESHOLD: 50,
  SMALL_BUNDLE_DISCOUNT: 10, // 10%

  /**
   * Medium bundles ($50-$100): Standard discount
   */
  MEDIUM_BUNDLE_THRESHOLD: 100,
  MEDIUM_BUNDLE_DISCOUNT: 15, // 15%

  /**
   * Large bundles ($100-$200): Attractive discount
   */
  LARGE_BUNDLE_THRESHOLD: 200,
  LARGE_BUNDLE_DISCOUNT: 18, // 18%

  /**
   * Premium bundles (>$200): Maximum discount
   */
  PREMIUM_BUNDLE_DISCOUNT: 22, // 22%

  /**
   * Aggressive discount (customer AOV threshold)
   * When bundle value > customer AOV * multiplier
   */
  AGGRESSIVE_AOV_MULTIPLIER: 1.5,
  AGGRESSIVE_DISCOUNT: 20, // 20%

  /**
   * Conservative discount (above shop AOV)
   * Protect margin on high-value bundles
   */
  CONSERVATIVE_DISCOUNT: 12, // 12%
} as const;

// ============================================================================
// CACHE & PERFORMANCE CONFIGURATION
// ============================================================================

/**
 * Cache Time-To-Live (TTL) in milliseconds
 */
export const CACHE_TTL = {
  /**
   * Recommendations cache (product page recommendations)
   * Short TTL to reflect inventory changes
   */
  RECOMMENDATIONS: 60 * 1000, // 1 minute

  /**
   * Product data cache (titles, prices, availability)
   * Medium TTL since product data changes less frequently
   */
  PRODUCT_DATA: 2 * 60 * 60 * 1000, // 2 hours

  /**
   * Analytics data cache (dashboard metrics)
   * Short TTL for near real-time insights
   */
  ANALYTICS: 5 * 60 * 1000, // 5 minutes

  /**
   * Shop currency cache
   * Long TTL since currency rarely changes
   */
  SHOP_CURRENCY: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Settings cache
   * Medium TTL - merchants don't change settings constantly
   */
  SETTINGS: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * Performance limits and constraints
 */
export const PERFORMANCE_LIMITS = {
  /**
   * Maximum recommendations to return
   * Prevents overwhelming the UI
   */
  MAX_RECOMMENDATIONS: 12,
  MIN_RECOMMENDATIONS: 1,
  DEFAULT_RECOMMENDATIONS: 6,

  /**
   * Maximum products in a bundle
   * UI and cognitive load constraints
   */
  MAX_BUNDLE_PRODUCTS: 4,
  MIN_BUNDLE_PRODUCTS: 2,

  /**
   * Order query limits for analysis
   * Prevents memory issues on large stores
   */
  MAX_ORDERS_PER_QUERY: 250,

  /**
   * Lift cap for niche product recommendations
   * Prevents rare products from dominating suggestions
   */
  LIFT_CAP: 2.0,
} as const;

// ============================================================================
// A/B TESTING & EXPERIMENTATION
// ============================================================================

/**
 * A/B test configuration
 */
export const AB_TEST_CONFIG = {
  /**
   * Minimum sample size before declaring winner
   * Statistical significance threshold
   */
  MIN_SAMPLE_SIZE: 100,

  /**
   * Confidence level for statistical tests
   */
  CONFIDENCE_LEVEL: 0.95, // 95% confidence

  /**
   * Default traffic split for new experiments
   */
  DEFAULT_TRAFFIC_SPLIT: 50, // 50/50 split
} as const;

// ============================================================================
// ANALYTICS & TRACKING
// ============================================================================

/**
 * Event tracking configuration
 */
export const TRACKING_CONFIG = {
  /**
   * Session timeout (milliseconds)
   * After this time, new session is created
   */
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes

  /**
   * Conversion attribution window (days)
   * How long to attribute purchases to recommendations
   */
  ATTRIBUTION_WINDOW_DAYS: 7,

  /**
   * Batch size for bulk operations
   * Used in ML jobs and analytics aggregation
   */
  BATCH_SIZE: 100,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate time decay weight for an order based on age
 * Uses exponential decay: weight = e^(-λ * age_days)
 * where λ = ln(2) / half_life
 *
 * @param ageDays - Age of order in days
 * @returns Decay weight between 0 and 1
 */
export function calculateTimeDecay(ageDays: number): number {
  const lambda = Math.log(2) / ML_THRESHOLDS.ORDER_DECAY_HALF_LIFE_DAYS;
  return Math.exp(-lambda * ageDays);
}

/**
 * Get minimum co-occurrence threshold based on total order count
 *
 * @param orderCount - Total orders for the shop
 * @returns Minimum times products must appear together
 */
export function getMinCoOccurrence(orderCount: number): number {
  if (orderCount < 50) return ML_THRESHOLDS.MIN_CO_OCCURRENCE_SMALL;
  if (orderCount < 200) return ML_THRESHOLDS.MIN_CO_OCCURRENCE_MEDIUM;
  return ML_THRESHOLDS.MIN_CO_OCCURRENCE_LARGE;
}

/**
 * Check if price ratio is within acceptable range
 *
 * @param price - Candidate product price
 * @param anchorPrice - Reference product price
 * @returns True if within acceptable range
 */
export function isPriceInRange(price: number, anchorPrice: number): boolean {
  if (anchorPrice === 0) return true;
  const ratio = price / anchorPrice;
  return ratio >= PRICE_CONFIG.PRICE_GAP_LOW && ratio <= PRICE_CONFIG.PRICE_GAP_HIGH;
}

/**
 * Calculate optimal bundle discount based on value and AOV
 * Implements the discount tier logic from ml.server.ts
 *
 * @param bundleValue - Total value of bundle
 * @param shopAOV - Shop average order value (optional)
 * @param customerAOV - Customer average order value (optional)
 * @returns Discount percentage (10-22%)
 */
export function calculateBundleDiscount(
  bundleValue: number,
  shopAOV: number = 0,
  customerAOV: number = 0
): number {
  // Strategy 1: Aggressive discount if bundle significantly exceeds customer AOV
  if (customerAOV > 0 && bundleValue > customerAOV * DISCOUNT_TIERS.AGGRESSIVE_AOV_MULTIPLIER) {
    return DISCOUNT_TIERS.AGGRESSIVE_DISCOUNT;
  }

  // Strategy 2: Conservative discount if already above shop AOV (margin protection)
  if (shopAOV > 0 && bundleValue > shopAOV) {
    return DISCOUNT_TIERS.CONSERVATIVE_DISCOUNT;
  }

  // Strategy 3: Tiered discounts based on bundle value
  if (bundleValue < DISCOUNT_TIERS.SMALL_BUNDLE_THRESHOLD) {
    return DISCOUNT_TIERS.SMALL_BUNDLE_DISCOUNT;
  }
  if (bundleValue < DISCOUNT_TIERS.MEDIUM_BUNDLE_THRESHOLD) {
    return DISCOUNT_TIERS.MEDIUM_BUNDLE_DISCOUNT;
  }
  if (bundleValue < DISCOUNT_TIERS.LARGE_BUNDLE_THRESHOLD) {
    return DISCOUNT_TIERS.LARGE_BUNDLE_DISCOUNT;
  }

  return DISCOUNT_TIERS.PREMIUM_BUNDLE_DISCOUNT;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Type-safe keys for order limits
 */
export type OrderLimitTier = keyof typeof ORDER_LIMITS;

/**
 * Type-safe keys for data retention options
 */
export type DataRetentionDays = typeof ML_THRESHOLDS.DATA_RETENTION_OPTIONS[number];
