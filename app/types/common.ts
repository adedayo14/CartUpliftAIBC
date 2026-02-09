/**
 * Common Type Definitions
 * Shared types used across the application
 */

// HTTP Response types
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  ok: false;
  error: string;
  message?: string;
  statusCode?: number;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  message?: string;
}

// Shopify types
export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  price?: string;
  compareAtPrice?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
}

export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice?: string;
  availableForSale?: boolean;
  sku?: string;
  inventoryQuantity?: number;
}

export interface ShopifyImage {
  id?: string;
  url: string;
  altText?: string;
  width?: number;
  height?: number;
}

export interface ShopifyCart {
  items: ShopifyCartItem[];
  total: number;
  subtotal: number;
  currency: string;
}

export interface ShopifyCartItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  quantity: number;
  price: number;
  image?: string;
}

export interface ShopifyOrder {
  id: string;
  orderNumber: number;
  total: number;
  subtotal: number;
  currency: string;
  lineItems: ShopifyLineItem[];
  customer?: ShopifyCustomer;
}

export interface ShopifyLineItem {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  quantity: number;
  price: number;
}

export interface ShopifyCustomer {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

// Bundle types
export interface BundleConfig {
  id: string;
  name: string;
  type: "manual" | "category" | "ai_suggested";
  discountType: "percentage" | "fixed";
  discountValue: number;
  products: BundleProductConfig[];
  assignmentType?: "specific" | "all";
  assignedProducts?: string[];
}

export interface BundleProductConfig {
  productId: string;
  variantId?: string;
  position: number;
  required: boolean;
  isRemovable: boolean;
  isAnchor: boolean;
  productTitle?: string;
  productHandle?: string;
  productPrice?: number;
}

export interface TierConfig {
  minQty: number;
  maxQty?: number;
  discountType: "percentage" | "fixed";
  discountValue: number;
  label?: string;
}

// Recommendation types
export interface RecommendationProduct {
  productId: string;
  title: string;
  handle: string;
  price: number;
  compareAtPrice?: number;
  image?: string;
  score?: number;
  source?: "ml" | "manual" | "similar" | "trending";
}

export interface RecommendationRequest {
  shop: string;
  productId?: string;
  cartItems?: string[];
  customerId?: string;
  sessionId?: string;
  limit?: number;
}

export interface RecommendationResponse {
  products: RecommendationProduct[];
  source: "ml" | "manual" | "fallback";
  confidence?: number;
}

// Gift threshold types
export interface GiftThreshold {
  id: string;
  threshold: number;
  productId: string;
  productTitle?: string;
  productHandle?: string;
  productImage?: string;
  enabled: boolean;
}

// Form data types
export interface FormDataObject {
  [key: string]: string | number | boolean | undefined | null;
}

export interface NormalizedFormData {
  [key: string]: string | number | boolean;
}

// Error types
export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export interface ValidationError extends AppError {
  field?: string;
  value?: unknown;
}

// Event tracking types
export interface TrackingEvent {
  event: "impression" | "click" | "add_to_cart" | "purchase";
  productId: string;
  productTitle?: string;
  sessionId?: string;
  customerId?: string;
  source?: string;
  position?: number;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsEvent {
  eventType: "cart_view" | "cart_abandon" | "purchase" | "bundle_impression" | "bundle_click" | "bundle_conversion";
  sessionId?: string;
  customerId?: string;
  orderId?: string;
  orderValue?: number;
  bundleId?: string;
  productIds?: string[];
  metadata?: Record<string, unknown>;
}

// A/B Testing types
export interface ExperimentConfig {
  id: number;
  name: string;
  status: "running" | "completed" | "paused";
  startDate?: Date;
  endDate?: Date;
  variants: VariantConfig[];
  attribution: "session" | "24h" | "7d";
}

export interface VariantConfig {
  id: number;
  name: string;
  isControl: boolean;
  value: number;
  trafficPct: number;
  config: {
    discount_pct: number;
  };
}

// Extended experiment/variant types (handles schema fields that may not be in TS definitions)
export interface ExtendedExperiment {
  id: number;
  name: string;
  type?: string;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  attribution: string;
  createdAt: Date;
  updatedAt: Date;
  activeVariantId: number | null;
}

export interface ExtendedVariant {
  id: number;
  name: string;
  isControl: boolean;
  value?: number;
  discountPct?: number;
  valueFormat?: string;
  trafficPct: number | { toNumber(): number };
}

// Attribution window types
export type AttributionWindow = "session" | "24h" | "7d";
export type AttributionWindowDB = "session" | "hours24" | "days7";

// Value format types
export type ValueFormat = "percent" | "currency" | "number";

// Experiment types
export type ExperimentType = "discount" | "bundle" | "shipping" | "upsell";

// Shopify session extended type
export interface ExtendedShopifySession {
  shop: string;
  currency?: string;
  [key: string]: unknown;
}

// Form submission types for A/B testing
export interface ExperimentFormData {
  name: string;
  type: ExperimentType;
  status: "running" | "paused";
  startDate: string | null;
  endDate: string | null;
  attributionWindow: AttributionWindow;
}

export interface VariantFormData {
  name: string;
  isControl: boolean;
  trafficPct: number;
  value: number;
  valueFormat: ValueFormat;
  id?: number;
}

// Cache types
export interface CacheEntry<T> {
  ts: number;
  payload: T;
}

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// JSON types (for Prisma Json fields)
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
