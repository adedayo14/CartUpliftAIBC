/**
 * Bundle Constants
 * Centralized constants for bundle types, styles, statuses, and other magic strings
 * @module constants/bundle
 */

// ============================================================================
// BUNDLE TYPES
// ============================================================================

/**
 * Bundle type constants
 * Defines the different ways bundles can be created or managed
 */
export const BUNDLE_TYPES = {
  /** Machine learning generated bundles */
  ML: 'ml',
  /** Manually created bundles by merchant */
  MANUAL: 'manual',
  /** Collection-based bundles */
  COLLECTION: 'collection',
  /** AI suggested bundles (legacy, prefer ML) */
  AI_SUGGESTED: 'ai_suggested',
} as const;

export type BundleType = typeof BUNDLE_TYPES[keyof typeof BUNDLE_TYPES];

// ============================================================================
// BUNDLE STYLES
// ============================================================================

/**
 * Bundle display style constants
 * Controls how bundles are rendered in the storefront
 */
export const BUNDLE_STYLES = {
  /** Grid layout (default) */
  GRID: 'grid',
  /** Clean compact layout */
  CLEAN: 'clean',
  /** Frequently bought together style */
  FBT: 'fbt',
  /** Tiered pricing display */
  TIER: 'tier',
} as const;

export type BundleStyle = typeof BUNDLE_STYLES[keyof typeof BUNDLE_STYLES];

// ============================================================================
// BUNDLE STATUS
// ============================================================================

/**
 * Bundle status constants
 * Lifecycle states for bundles
 */
export const BUNDLE_STATUS = {
  /** Bundle is live and active */
  ACTIVE: 'active',
  /** Bundle is temporarily paused */
  PAUSED: 'paused',
  /** Bundle is in draft mode */
  DRAFT: 'draft',
  /** Bundle is inactive/archived */
  INACTIVE: 'inactive',
} as const;

export type BundleStatus = typeof BUNDLE_STATUS[keyof typeof BUNDLE_STATUS];

// ============================================================================
// DISCOUNT TYPES
// ============================================================================

/**
 * Discount type constants
 * Methods for calculating bundle discounts
 */
export const DISCOUNT_TYPES = {
  /** Percentage-based discount (e.g., 10% off) */
  PERCENTAGE: 'percentage',
  /** Fixed amount discount (e.g., $5 off) */
  FIXED: 'fixed',
  /** Alternative name for fixed discount */
  AMOUNT: 'amount',
} as const;

export type DiscountType = typeof DISCOUNT_TYPES[keyof typeof DISCOUNT_TYPES];

// ============================================================================
// LAYOUT TYPES
// ============================================================================

/**
 * Recommendation layout constants
 * Controls the layout of product recommendations
 */
export const LAYOUT_TYPES = {
  /** Horizontal row layout */
  HORIZONTAL: 'horizontal',
  /** Vertical column layout */
  VERTICAL: 'vertical',
  /** Grid layout */
  GRID: 'grid',
} as const;

export type LayoutType = typeof LAYOUT_TYPES[keyof typeof LAYOUT_TYPES];

/**
 * Layout mapping for CSS flex direction
 * Maps user-friendly names to CSS values
 */
export const LAYOUT_MAP: Record<LayoutType, 'row' | 'column' | 'grid'> = {
  [LAYOUT_TYPES.HORIZONTAL]: 'row',
  [LAYOUT_TYPES.VERTICAL]: 'column',
  [LAYOUT_TYPES.GRID]: 'grid',
} as const;

// ============================================================================
// HTTP METHODS
// ============================================================================

/**
 * HTTP method constants
 * Standard HTTP request methods
 */
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  OPTIONS: 'OPTIONS',
} as const;

export type HttpMethod = typeof HTTP_METHODS[keyof typeof HTTP_METHODS];

// ============================================================================
// ML/AI RELATED CONSTANTS
// ============================================================================

/**
 * ML data retention job statuses
 */
export const JOB_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type JobStatus = typeof JOB_STATUS[keyof typeof JOB_STATUS];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a string is a valid bundle type
 */
export function isValidBundleType(type: string): type is BundleType {
  return Object.values(BUNDLE_TYPES).includes(type as BundleType);
}

/**
 * Check if a string is a valid bundle style
 */
export function isValidBundleStyle(style: string): style is BundleStyle {
  return Object.values(BUNDLE_STYLES).includes(style as BundleStyle);
}

/**
 * Check if a string is a valid bundle status
 */
export function isValidBundleStatus(status: string): status is BundleStatus {
  return Object.values(BUNDLE_STATUS).includes(status as BundleStatus);
}

/**
 * Check if a string is a valid discount type
 */
export function isValidDiscountType(type: string): type is DiscountType {
  return Object.values(DISCOUNT_TYPES).includes(type as DiscountType);
}
