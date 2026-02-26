import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import type { Experiment, Variant } from "@prisma/client";
import { getSettings, saveSettings } from "../models/settings.server";
import { getShopCurrency } from "../services/currency.server";
import { getOrCreateSubscription } from "../services/billing.server";
import db from "../db.server";
import type { ExperimentModel, ExperimentWithVariants, VariantModel, EventModel } from "~/types/prisma";
import type { JsonValue, JsonObject } from "~/types/common";
import { validateCorsOrigin, getCorsHeaders, validateSessionId } from "../services/security.server";
import {
  getProducts,
  getProduct,
  getProductVariants,
  getProductImages,
  getOrders,
  getOrderProducts,
  getStoreInfo,
  type BCProduct,
  type BCVariant,
  type BCProductImage,
  type BCOrder,
  type BCOrderProduct,
} from "~/services/bigcommerce-api.server";

// ─── Type Definitions ────────────────────────────────────────────────────────

interface ProductWithMeta {
  id: string;
  title: string;
  handle: string;
  image?: string;
  price: number;
  inStock: boolean;
  variant_id?: string;
}

interface MLRecommendation {
  product_id: string;
  score?: number;
  source?: string;
}

interface MLRecommendationResponse {
  recommendations?: MLRecommendation[];
}

interface DiagnosticDetails {
  storeInfo?: { ok: boolean; data?: boolean; error?: string };
  ordersProbe?: { ok?: boolean; count?: number; error?: string };
  productsProbe?: { ok?: boolean; count?: number; error?: string };
}

interface RecommendationCachePayload {
  recommendations: unknown[];
  reason?: string;
}

interface ProductPerformance {
  productId: string;
  isBlacklisted: boolean;
  confidence: number;
}

interface RecommendationWithScore {
  id: string;
  title: string;
  handle: string;
  image?: string;
  price: number;
  score?: number;
}

/**
 * PRE-PURCHASE ATTRIBUTION SNAPSHOT
 *
 * This version has ML recommendations working but NO feedback loop:
 * - Recommendations are served
 * - Impressions/clicks tracked
 * - BUT: No purchase attribution
 * - BUT: No learning from conversions
 * - BUT: No auto-correction
 *
 * Next: Implement purchase attribution webhook + daily learning job
 */

// ─── BigCommerce Authentication Helper ───────────────────────────────────────

async function authenticateStorefront(request: Request): Promise<string> {
  const url = new URL(request.url);
  const storeHash = url.searchParams.get('store_hash') || url.searchParams.get('shop') || '';
  if (!storeHash) throw new Response("Missing store_hash", { status: 401 });
  // Verify store exists
  const settings = await db.settings.findUnique({ where: { storeHash } });
  if (!settings) throw new Response("Unknown store", { status: 401 });
  return storeHash;
}

// ─── Product Normalization Helper ────────────────────────────────────────────

function normalizeProduct(product: BCProduct): ProductWithMeta {
  const image = product.images?.[0]?.url_standard;
  const firstVariant = product.variants?.[0];
  const price = firstVariant?.calculated_price ?? product.price ?? product.calculated_price ?? 0;
  const inStock = product.availability !== 'disabled' && product.is_visible &&
    (firstVariant ? !firstVariant.purchasing_disabled : true);
  const handle = (product.custom_url?.url || '').replace(/^\/|\/$/g, '');
  return {
    id: String(product.id),
    title: product.name,
    handle,
    image,
    price,
    inStock,
    variant_id: firstVariant ? String(firstVariant.id) : undefined,
  };
}

// ─── Order Fetching Helper ───────────────────────────────────────────────────

async function fetchOrdersWithProducts(storeHash: string, limit: number = 200): Promise<Array<{
  id: number;
  date_created: string;
  items: Array<{ product_id: number; name: string; price: number }>;
}>> {
  const orders = await getOrders(storeHash, { limit: Math.min(limit, 250) });
  const results = [];
  for (const order of orders.slice(0, limit)) {
    try {
      const products = await getOrderProducts(storeHash, order.id);
      results.push({
        id: order.id,
        date_created: order.date_created,
        items: products.map(p => ({
          product_id: p.product_id,
          name: p.name,
          price: parseFloat(p.price_inc_tax) || 0,
        })),
      });
    } catch { /* skip failed order */ }
  }
  return results;
}

// ─── Normalize IDs to Products (BC version) ─────────────────────────────────

async function normalizeIdsToProducts(storeHash: string, ids: string[]): Promise<ProductWithMeta[]> {
  if (!ids.length) return [];
  const out: ProductWithMeta[] = [];
  for (const rawId of ids) {
    const numericId = parseInt(String(rawId), 10);
    if (isNaN(numericId)) continue;
    try {
      const product = await getProduct(storeHash, numericId, "images,variants");
      out.push(normalizeProduct(product));
    } catch {
      // skip failed product lookups
    }
  }
  return out;
}

// ─── BC Product Details for Bundles ──────────────────────────────────────────

interface BundleProductDetail {
  id: string;
  variant_id: string;
  variant_title?: string;
  options: Array<{ name: string; value: string }>;
  title: string;
  handle: string;
  price: number; // in cents
  comparePrice?: number;
  image?: string;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    compareAtPrice?: number;
    availableForSale: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
}

function getBCProductDetails(product: BCProduct): BundleProductDetail | null {
  const variants = product.variants || [];
  const firstAvailable = variants.find(v => !v.purchasing_disabled) || variants[0];
  if (!firstAvailable) return null;

  const opts = firstAvailable.option_values
    ? firstAvailable.option_values.map(o => ({ name: o.option_display_name, value: o.label }))
    : [];
  const priceInCents = Math.round((firstAvailable.calculated_price ?? product.price ?? 0) * 100);
  const handle = (product.custom_url?.url || '').replace(/^\/|\/$/g, '');

  const allVariants = variants.map(v => ({
    id: String(v.id),
    title: v.option_values?.map(o => o.label).join(' / ') || '',
    price: Math.round((v.calculated_price ?? v.price ?? product.price ?? 0) * 100),
    compareAtPrice: v.retail_price ? Math.round(v.retail_price * 100) : undefined,
    availableForSale: !v.purchasing_disabled,
    selectedOptions: v.option_values
      ? v.option_values.map(o => ({ name: o.option_display_name, value: o.label }))
      : [],
  }));

  return {
    id: String(product.id),
    variant_id: String(firstAvailable.id),
    variant_title: firstAvailable.option_values?.map(o => o.label).join(' / '),
    options: opts,
    title: product.name,
    handle,
    price: priceInCents,
    image: product.images?.[0]?.url_standard,
    variants: allVariants,
  };
}

// ─── Lightweight in-memory cache for recommendations (per worker) ────────────
// Keyed by shop + product/cart context + limit; TTL ~60s
const RECS_TTL_MS = 60 * 1000;
const recsCache = new Map<string, { ts: number; payload: RecommendationCachePayload }>();
function getRecsCache(key: string) {
  const v = recsCache.get(key);
  if (!v) return undefined;
  if (Date.now() - v.ts > RECS_TTL_MS) { recsCache.delete(key); return undefined; }
  return v.payload;
}
function setRecsCache(key: string, payload: RecommendationCachePayload) {
  recsCache.set(key, { ts: Date.now(), payload });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════════════════════════════════════════

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname;

  // GET /apps/proxy/api/billing-check - Public endpoint for storefront billing check
  if (path.includes('/api/billing-check')) {
    try {
      const storeHash = await authenticateStorefront(request);

      // Check billing limit
      const subscription = await getOrCreateSubscription(storeHash);

      if (subscription.isLimitReached) {
        return new Response("Payment Required", {
          status: 402,
          headers: { 'Cache-Control': 'no-store' }
        });
      }

      return new Response("OK", {
        status: 200,
        headers: { 'Cache-Control': 'no-store' }
      });
    } catch (error) {
      console.error('[Billing Check] Error:', error);
      return new Response("OK", { status: 200 }); // Fail open
    }
  }

  // GET /apps/proxy/api/ab-testing
  // action=get_active_experiments -> returns active experiments with variants (configData parsed)
  // action=get_variant&experiment_id=XX&user_id=YY -> returns assigned variant and its config
  if (path.includes('/api/ab-testing')) {
    let allowedOrigin: string | null = null;
    try {
      const storeHash = await authenticateStorefront(request);

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);
      const hdrs = { ...corsHeaders, 'Cache-Control': 'no-store' };

      const shopStr = storeHash;

      const action = url.searchParams.get('action') || 'get_active_experiments';

      // MurmurHash3 helper for deterministic assignment
      const murmurHashFloat = (key: string, seed = 0) => {
        let remainder = key.length & 3; // key.length % 4
        const bytes = key.length - remainder;
        let h1 = seed;
        const c1 = 0xcc9e2d51;
        const c2 = 0x1b873593;
        let i = 0;
        let k1 = 0;

        while (i < bytes) {
          k1 = (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
          ++i;

          k1 = Math.imul(k1, c1);
          k1 = (k1 << 15) | (k1 >>> 17);
          k1 = Math.imul(k1, c2);

          h1 ^= k1;
          h1 = (h1 << 13) | (h1 >>> 19);
          h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
        }

        k1 = 0;

        switch (remainder) {
          case 3:
            k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
          // falls through
          case 2:
            k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
          // falls through
          case 1:
            k1 ^= (key.charCodeAt(i) & 0xff);
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);
            h1 ^= k1;
        }

        h1 ^= key.length;
        h1 ^= h1 >>> 16;
        h1 = Math.imul(h1, 0x85ebca6b) | 0;
        h1 ^= h1 >>> 13;
        h1 = Math.imul(h1, 0xc2b2ae35) | 0;
        h1 ^= h1 >>> 16;

        return (h1 >>> 0) / 4294967296;
      };

      if (action === 'get_active_experiments') {
        // Active = status === 'running' and within date window (or no dates)
        const now = new Date();
        const experiments = (await db.experiment.findMany({
          where: {
            storeHashId: shopStr,
            status: 'running',
            OR: [
              { AND: [{ startDate: null }, { endDate: null }] },
              { AND: [{ startDate: { lte: now } }, { endDate: null }] },
              { AND: [{ startDate: null }, { endDate: { gte: now } }] },
              { AND: [{ startDate: { lte: now } }, { endDate: { gte: now } }] },
            ],
          },
          orderBy: { createdAt: "desc" },
          include: { variants: { orderBy: [{ isControl: "desc" }, { id: "asc" }] } },
        })) as ExperimentWithVariants[];

        const payload = experiments.map((experiment) => ({
          id: experiment.id,
          name: experiment.name,
          status: experiment.status,
          start_date: experiment.startDate,
          end_date: experiment.endDate,
          attribution: experiment.attribution,
          variants: experiment.variants.map((variant) => ({
            id: variant.id,
            name: variant.name,
            is_control: variant.isControl,
            traffic_percentage: Number(variant.trafficPct ?? 0),
            config: {
              discount_pct: Number(variant.value ?? 0),
            },
          })),
        }));

        return json({ ok: true, experiments: payload }, { headers: hdrs });
      }

      if (action === 'get_variant') {
        const experimentIdStr = url.searchParams.get('experiment_id');
        const userId = url.searchParams.get('user_id') || 'anonymous';
        const experimentId = experimentIdStr ? parseInt(experimentIdStr, 10) : NaN;
        if (!experimentIdStr || Number.isNaN(experimentId)) {
          return json({ ok: false, error: 'invalid_experiment_id' }, { status: 400, headers: hdrs });
        }

        const experiment = await db.experiment.findFirst({ where: { id: experimentId, storeHashId: shopStr } });
        if (!experiment) return json({ ok: false, error: 'not_found' }, { status: 404, headers: hdrs });
        const vars = (await db.variant.findMany({ where: { experimentId }, orderBy: { id: 'asc' } })) as VariantModel[];
        if (!vars.length) return json({ ok: false, error: 'no_variants' }, { status: 404, headers: hdrs });

        // If experiment is completed and has an activeVariantId, force that selection
        if (experiment.status === 'completed' && experiment.activeVariantId) {
          const selected = vars.find(v => v.id === experiment.activeVariantId) || vars[0];
          const config = { discount_pct: Number(selected?.value ?? 0) };
          return json({ ok: true, variant: selected?.name, config, variantId: selected?.id }, { headers: hdrs });
        }

        const weights = vars.map((variant) => Number(variant.trafficPct) || 0);
        let sum = weights.reduce((a: number, b: number) => a + b, 0);
        if (sum <= 0) {
          sum = vars.length;
          for (let i = 0; i < weights.length; i++) weights[i] = 1;
        }
        const normalized = weights.map((weight: number) => weight / sum);

        // Deterministic MurmurHash3-based hash mapped to [0,1)
        const hashStr = `${experimentId}:${userId}:${experiment.attribution}`;
        const r = murmurHashFloat(hashStr);

        // Pick variant by cumulative probability
        let cum = 0; let idx = 0;
        for (let i = 0; i < normalized.length; i++) { cum += normalized[i]; if (r <= cum) { idx = i; break; } }
        const selected = vars[idx];
        const config = { discount_pct: Number(selected?.value ?? 0) };

        // Persist assignment event (best-effort, idempotent) — skip for completed experiments
        try {
          if (selected?.id && experiment.status !== 'completed') {
            const unitKey = String(userId);
            const existing = await db.event.findFirst({
              where: {
                experimentId,
                unitId: unitKey,
                type: 'assignment',
              },
            });
            if (!existing) {
              await db.event.create({
                data: {
                  experimentId,
                  variantId: selected.id,
                  unitId: unitKey,
                  type: 'assignment',
                  metadata: {
                    source: 'app_proxy',
                    shop: shopStr,
                  } as JsonObject,
                },
              });
            }
          }
        } catch (error) {
          // best-effort
        }

        return json({
          ok: true,
          variant: selected?.name || `variant_${idx + 1}`,
          config,
          variantId: selected?.id,
        }, { headers: hdrs });
      }

      return json({ ok: false, error: 'unknown_action' }, { status: 400, headers: hdrs });
    } catch (e) {
      return json({ ok: false, error: 'server_error' }, { status: 500, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
    }
  }

  // GET /apps/proxy/api/diag
  // Diagnostics: verify store authentication, API reachability, and required scopes
  if (path.includes('/api/diag')) {
    try {
      const storeHash = await authenticateStorefront(request);

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);
      const hdrs = { ...corsHeaders, 'Cache-Control': 'no-store' };

      let adminOk = false; let hasReadOrders = false; let hasReadProducts = false; let details: DiagnosticDetails = {};

      // Check store info
      try {
        const storeInfo = await getStoreInfo(storeHash);
        adminOk = !!storeInfo;
        details.storeInfo = { ok: adminOk, data: !!storeInfo };
      } catch (_e) {
        details.storeInfo = { ok: false, error: String(_e) };
      }

      // Check orders access
      try {
        const orders = await getOrders(storeHash, { limit: 1 });
        hasReadOrders = true;
        details.ordersProbe = { ok: true, count: orders.length };
      } catch (_e) {
        details.ordersProbe = { ok: false, error: String(_e) };
      }

      // Check products access
      try {
        const { products: prods } = await getProducts(storeHash, { limit: 1 });
        hasReadProducts = true;
        details.productsProbe = { ok: true, count: prods.length };
      } catch (_e) {
        details.productsProbe = { ok: false, error: String(_e) };
      }

      return json({ ok: true, proxyAuth: true, shop: storeHash, adminOk, scopes: { read_orders: hasReadOrders, read_products: hasReadProducts }, details }, { headers: hdrs });
    } catch (_e) {
      return json({ ok: false, proxyAuth: false, reason: 'invalid_store' }, { status: 401 });
    }
  }

  // GET /apps/proxy/api/recommendations
  // Conservative AOV-focused recs with advanced settings: manual/hybrid, threshold-aware, OOS + price guardrails
  if (path.includes('/api/recommendations')) {
    let allowedOrigin: string | null = null;
    try {
      const storeHash = await authenticateStorefront(request);
      const shopStr = storeHash;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = await validateCorsOrigin(origin, shopStr);

      // Check subscription limits - ENFORCE ORDER LIMITS
      const subscription = await getOrCreateSubscription(shopStr);
      if (subscription.isLimitReached) {
        return json({
          recommendations: [],
          message: 'Order limit reached. Please upgrade your plan to continue.',
          limitReached: true
        }, {
          status: 403,
          headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' }
        });
      }

      // Fetch shop currency (cached)
      const shopCurrency = await getShopCurrency(shopStr);

      // Query params
      const productIdParam = url.searchParams.get('product_id');
      const productId = productIdParam ? String(productIdParam) : undefined; // single anchor
      const cartParam = url.searchParams.get('cart') || '';
      let limit = Math.min(12, Math.max(1, parseInt(url.searchParams.get('limit') || '6', 10)));
      const subtotalParam = url.searchParams.get('subtotal');
      const subtotal = subtotalParam !== null ? Number(subtotalParam) : undefined; // shop currency units

      // Defaults from settings; override when available
      let enableRecs = true;
      let hideAfterThreshold = false;
      let enableThresholdBasedSuggestions = false;
      let thresholdSuggestionMode = 'smart';
      let manualEnabled = false;
      let manualList: string[] = [];
      let freeShippingThreshold = 0;

      {
        const s = await getSettings(shopStr);
        enableRecs = Boolean(s.enableRecommendations);
        freeShippingThreshold = Number(s.freeShippingThreshold || 0);
        limit = Math.min(limit, Math.max(1, Math.min(12, Number(s.maxRecommendations || limit))));
        const settingsExtended = s as Record<string, unknown>;
        hideAfterThreshold = Boolean(settingsExtended.hideRecommendationsAfterThreshold);
        enableThresholdBasedSuggestions = Boolean(settingsExtended.enableThresholdBasedSuggestions);
        thresholdSuggestionMode = String(settingsExtended.thresholdSuggestionMode || 'smart');
        manualEnabled = Boolean(settingsExtended.enableManualRecommendations) || s.complementDetectionMode === 'manual' || s.complementDetectionMode === 'hybrid';
        manualList = (s.manualRecommendationProducts || '').split(',').map((v) => v.trim()).filter(Boolean);

        // ML Settings (will be accessed in ML logic below)
        var mlSettings = {
          enabled: Boolean(settingsExtended.enableMLRecommendations),
          personalizationMode: String(settingsExtended.mlPersonalizationMode || 'basic'),
          privacyLevel: String(settingsExtended.mlPrivacyLevel || 'basic'),
          advancedPersonalization: Boolean(settingsExtended.enableAdvancedPersonalization),
          behaviorTracking: Boolean(settingsExtended.enableBehaviorTracking),
          dataRetentionDays: parseInt(String(settingsExtended.mlDataRetentionDays || '90'), 10)
        };

        // Hide entirely once thresholds are met
        if (enableRecs) {
          const need = (typeof subtotal === 'number' && freeShippingThreshold > 0) ? (freeShippingThreshold - subtotal) : undefined;
          if (hideAfterThreshold && typeof need === 'number' && need <= 0) {
            return json({ recommendations: [], reason: 'threshold_met' }, {
              headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=60', 'X-Recs-Disabled': 'threshold_met' }
            });
          }
        }

        if (!enableRecs) {
          return json({ recommendations: [], reason: 'disabled' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=60', 'X-Recs-Disabled': '1' }
          });
        }

        // Cache key includes subtotal + threshold flag (affects filtering)
        const cacheKey = `shop:${shopStr}|pid:${productId || ''}|cart:${cartParam}|limit:${limit}|subtotal:${subtotal ?? ''}|thr:${enableThresholdBasedSuggestions ? '1' : '0'}`;
        const cached = getRecsCache(cacheKey);
        if (cached) {
          return json(cached, {
            headers: {
              'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
              'Cache-Control': 'public, max-age=30',
              'X-Recs-Cache': 'HIT'
            },
          });
        }

        // ---------- ML Settings Integration ----------
        const mlEnabled = mlSettings.enabled;
        const mlPersonalizationMode = mlSettings.personalizationMode;
        const mlPrivacyLevel = mlSettings.privacyLevel;
        const enableAdvancedPersonalization = mlSettings.advancedPersonalization;
        const enableBehaviorTracking = mlSettings.behaviorTracking;
        const mlDataRetentionDays = mlSettings.dataRetentionDays;

        // Manual selection pre-fill (deduped, price-threshold aware)
        const needAmount = (typeof subtotal === 'number' && freeShippingThreshold > 0) ? Math.max(0, freeShippingThreshold - subtotal) : 0;

        let manualResults: Array<{ id: string; title: string; handle: string; image?: string; price: number; variant_id?: string }> = [];
        if (manualEnabled && manualList.length) {
          const normalizedProducts = await normalizeIdsToProducts(shopStr, manualList);
          const seen = new Set<string>();
          for (const m of normalizedProducts) {
            if (!m.inStock) continue;
            if (enableThresholdBasedSuggestions && needAmount > 0 && m.price < needAmount) continue;
            if (seen.has(m.id)) continue;
            // Avoid recommending items already in context
            if (cartParam.split(',').includes(m.id) || (productId && m.id === productId)) continue;
            seen.add(m.id);
            manualResults.push({ id: m.id, title: m.title, handle: m.handle, image: m.image, price: m.price, variant_id: m.variant_id });
            if (manualResults.length >= limit) break;
          }
          if (manualEnabled && manualResults.length >= limit && (thresholdSuggestionMode === 'price' || (thresholdSuggestionMode === 'smart' && enableThresholdBasedSuggestions))) {
            // Early return when manual fully satisfies quota
            const payload = { recommendations: manualResults.slice(0, limit) };
            setRecsCache(cacheKey, payload);
            return json(payload, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=60' } });
          }
        }

        // ---------- AI/Stats-based generation (existing algorithm) ----------
        const HALF_LIFE_DAYS = 60;
        const PRICE_GAP_LO = 0.5;
        const PRICE_GAP_HI = 2.0;

        // Anchor set
        const anchors = new Set<string>();
        if (productId) anchors.add(productId);
        if (cartParam) {
          for (const id of cartParam.split(',').map(s => s.trim()).filter(Boolean)) anchors.add(id);
        }
        if (anchors.size === 0) {
          return json({ recommendations: [], reason: 'no_context' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
        }

        // Fetch recent orders with line items to compute decayed associations/popularity
        let ordersWithItems: Array<{
          id: number;
          date_created: string;
          items: Array<{ product_id: number; name: string; price: number }>;
        }> = [];
        try {
          ordersWithItems = await fetchOrdersWithProducts(shopStr, 200);
        } catch {
          return json({ recommendations: manualResults.slice(0, limit), reason: 'orders_fetch_error' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }

        // Build decayed stats
        const LN2_OVER_HL = Math.log(2) / HALF_LIFE_DAYS;
        type Assoc = { co: number; wco: number; rev: number; wrev: number; aov: number };
        type ProductInfo = { id: string; title: string };
        const assoc: Record<string, { product: ProductInfo; copurchases: Record<string, Assoc>; wAppear: number; price: number; handle: string; vendor?: string; image?: string }> = {};
        const wAppear: Record<string, number> = {};

        for (const order of ordersWithItems) {
          const createdAt = new Date(order.date_created);
          const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86400000);
          const w = Math.exp(-LN2_OVER_HL * ageDays);
          const items: Array<{ pid: string; title: string; price: number }> = [];
          for (const lineItem of order.items) {
            if (!lineItem.product_id) continue;
            const pid = String(lineItem.product_id);
            items.push({ pid, title: lineItem.name, price: lineItem.price });
          }
          if (items.length < 2) continue;

          // appearances (decayed)
          const seen = new Set<string>();
          for (const it of items) {
            if (!seen.has(it.pid)) {
              wAppear[it.pid] = (wAppear[it.pid] || 0) + w;
              seen.add(it.pid);
              if (!assoc[it.pid]) assoc[it.pid] = { product: { id: it.pid, title: it.title }, copurchases: {}, wAppear: 0, price: it.price, handle: '', vendor: '', image: undefined };
              assoc[it.pid].wAppear += w;
              assoc[it.pid].price = it.price; assoc[it.pid].product.title = it.title;
            }
          }

          // pairs
          for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (!assoc[a.pid]) assoc[a.pid] = { product: { id: a.pid, title: a.title }, copurchases: {}, wAppear: 0, price: a.price, handle: '', vendor: '', image: undefined };
            if (!assoc[b.pid]) assoc[b.pid] = { product: { id: b.pid, title: b.title }, copurchases: {}, wAppear: 0, price: b.price, handle: '', vendor: '', image: undefined };
            if (!assoc[a.pid].copurchases[b.pid]) assoc[a.pid].copurchases[b.pid] = { co: 0, wco: 0, rev: 0, wrev: 0, aov: 0 };
            if (!assoc[b.pid].copurchases[a.pid]) assoc[b.pid].copurchases[a.pid] = { co: 0, wco: 0, rev: 0, wrev: 0, aov: 0 };
            assoc[a.pid].copurchases[b.pid].co++; assoc[a.pid].copurchases[b.pid].wco += w;
            assoc[b.pid].copurchases[a.pid].co++; assoc[b.pid].copurchases[a.pid].wco += w;
          }
        }

        // Build candidate scores across anchors
        const anchorIds = Array.from(anchors);
        const candidate: Record<string, { score: number; lift: number; pop: number; handle?: string; vendor?: string }> = {};
        const totalW = Object.values(wAppear).reduce((a, b) => a + b, 0) || 1;
        const liftCap = 2.0; // cap to avoid niche explosions

        // compute median anchor price (from assoc if available)
        const anchorPrices = anchorIds.map(id => assoc[id]?.price).filter(v => typeof v === 'number' && !isNaN(v)) as number[];
        anchorPrices.sort((a, b) => a - b);
        const anchorMedian = anchorPrices.length ? anchorPrices[Math.floor(anchorPrices.length / 2)] : undefined;

        for (const a of anchorIds) {
          const aStats = assoc[a];
          const wA = aStats?.wAppear || 0;
          if (!aStats || wA <= 0) continue;
          for (const [b, ab] of Object.entries(aStats.copurchases)) {
            if (anchors.has(b)) continue; // don't recommend items already in context
            const wB = assoc[b]?.wAppear || 0;
            if (wB <= 0) continue;
            const confidence = ab.wco / Math.max(1e-6, wA);
            const probB = wB / totalW;
            const lift = probB > 0 ? confidence / probB : 0;
            const liftNorm = Math.min(liftCap, lift) / liftCap; // [0..1]
            const popNorm = Math.min(1, wB / (totalW * 0.05)); // normalize: top 5% mass ~1
            const sc = 0.6 * liftNorm + 0.4 * popNorm;
            if (!candidate[b] || sc > candidate[b].score) {
              candidate[b] = { score: sc, lift, pop: wB / totalW, handle: assoc[b]?.handle, vendor: assoc[b]?.vendor };
            }
          }
        }

        // OOS filter via BC API for small top set
        const topIds = Object.entries(candidate)
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 24)
          .map(([id]) => id);

        if (topIds.length === 0) {
          return json({ recommendations: manualResults.slice(0, limit) }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
        }

        // Fetch inventory/availability and price data for candidates
        const availability: Record<string, { inStock: boolean; price: number; title: string; handle: string; img?: string; vendor?: string; variant_id?: string }> = {};
        for (const id of topIds) {
          try {
            const numId = parseInt(id, 10);
            if (isNaN(numId)) continue;
            const prod = await getProduct(shopStr, numId, "images,variants");
            const normalized = normalizeProduct(prod);
            availability[id] = {
              inStock: normalized.inStock,
              price: normalized.price,
              title: normalized.title,
              handle: normalized.handle,
              img: normalized.image,
              vendor: prod.brand_id ? String(prod.brand_id) : undefined,
              variant_id: normalized.variant_id,
            };
          } catch {
            // skip products we can't fetch
          }
        }

        // Final ranking with guardrails (price-gap + diversity)
        const results: Array<{ id: string; title: string; handle: string; image?: string; price: number; variant_id?: string }> = [];
        const usedHandles = new Set<string>();
        const targetPrice = anchorMedian;
        // CTR-based re-ranking (best-effort)
        let ctrById: Record<string, number> = {};
        try {
          const tracking = db?.trackingEvent;
          if (tracking?.findMany) {
            const since = new Date(Date.now() - 14 * 86400000);
            const candIds = topIds;
            if (candIds.length) {
              const rows = await tracking.findMany({
                where: { storeHash: shopStr, createdAt: { gte: since }, productId: { in: candIds } },
                select: { productId: true, event: true },
              });
              const counts: Record<string, { imp: number; clk: number }> = {};
              for (const r of rows) {
                const pid = r.productId as string | null;
                if (!pid) continue;
                const c = counts[pid] || (counts[pid] = { imp: 0, clk: 0 });
                if (r.event === 'impression') c.imp++;
                else if (r.event === 'click') c.clk++;
              }
              const alpha = 1, beta = 20; // Laplace smoothing
              for (const pid of Object.keys(counts)) {
                const { imp, clk } = counts[pid];
                const ctr = (clk + alpha) / (imp + beta);
                ctrById[pid] = ctr;
              }
            }
          }
        } catch (_e) {
          // best-effort
        }

        const BASELINE_CTR = 0.05; // 5%
        const CTR_WEIGHT = 0.35;
        const scored = Object.entries(candidate).map(([bid, meta]) => {
          const ctr = ctrById[bid] ?? BASELINE_CTR;
          const mult = Math.max(0.85, Math.min(1.25, 1 + CTR_WEIGHT * (ctr - BASELINE_CTR)));
          return [bid, { ...meta, score: meta.score * mult }] as [string, typeof meta];
        }).sort((a, b) => b[1].score - a[1].score);

        for (const [bid, meta] of scored) {
          if (results.length >= Math.max(0, limit - manualResults.length)) break;
          const info = availability[bid];
          if (!info?.inStock) continue;
          if (enableThresholdBasedSuggestions && needAmount > 0 && info.price < needAmount) continue;
          if (typeof targetPrice === 'number' && targetPrice > 0) {
            const ratio = info.price / targetPrice;
            if (ratio < PRICE_GAP_LO || ratio > PRICE_GAP_HI) continue;
          }
          const h = (info.handle || meta.handle || '').split('-')[0];
          if (usedHandles.has(h)) continue; // diversity
          usedHandles.add(h);
          results.push({ id: bid, title: info.title || assoc[bid]?.product?.title || '', handle: info.handle || assoc[bid]?.handle || '', image: info.img || assoc[bid]?.image, price: info.price, variant_id: info.variant_id });
        }

        // Combine manual and algorithmic with de-duplication
        const combined: Array<{ id: string; title: string; handle: string; image?: string; price: number; variant_id?: string }> = [];
        const seenIds = new Set<string>();
        const pushUnique = (arr: typeof combined) => {
          for (const r of arr) {
            if (seenIds.has(r.id)) continue;
            seenIds.add(r.id);
            combined.push(r);
            if (combined.length >= limit) break;
          }
        };
        if (manualResults.length) pushUnique(manualResults);
        if (combined.length < limit) pushUnique(results);

        if (enableThresholdBasedSuggestions && needAmount > 0 && thresholdSuggestionMode === 'price') {
          combined.sort((a, b) => (a.price - needAmount) - (b.price - needAmount));
        }

        // ---------- A/B Testing Integration ----------
        let abTestVariant: string | null = null;
        let abTestConfig: Record<string, unknown> = {};

        // Check for active A/B experiments
        try {
          const userId = url.searchParams.get('session_id') || url.searchParams.get('customer_id') || 'anonymous';
          const abResponse = await fetch(`${url.origin}/apps/proxy/api/ab-testing?action=get_active_experiments&store_hash=${shopStr}`, {
            headers: {}
          });

          if (abResponse.ok) {
            const abData = await abResponse.json() as { experiments?: Array<{ id: number; test_type?: string }> };
            const activeExperiments = abData.experiments || [];

            // Find recommendation-related experiments
            const recommendationExperiment = activeExperiments.find((exp) =>
              exp.test_type === 'ml_algorithm' || exp.test_type === 'recommendation_copy'
            );

            if (recommendationExperiment) {
              // Get variant assignment
              const variantResponse = await fetch(`${url.origin}/apps/proxy/api/ab-testing?action=get_variant&experiment_id=${recommendationExperiment.id}&user_id=${userId}&store_hash=${shopStr}`, {
                headers: {}
              });

              if (variantResponse.ok) {
                const variantData = await variantResponse.json() as { variant?: string; config?: Record<string, unknown> };
                abTestVariant = variantData.variant || null;
                abTestConfig = variantData.config || {};
              }
            }
          }
        } catch (abError) {
          // best-effort
        }

        // ---------- ML Enhancement & Real Data Tracking ----------
        let finalRecommendations = combined;
        let dataMetrics = {
          orderCount: ordersWithItems.length,
          associationCount: Object.keys(assoc).length,
          mlEnhanced: false,
          dataQuality: 'basic',
          abTestVariant: abTestVariant,
          abTestConfig: abTestConfig
        };

        // Apply A/B test overrides to ML configuration
        let effectiveMlEnabled = mlEnabled;
        let effectivePersonalizationMode = mlPersonalizationMode;

        if (abTestVariant && abTestConfig) {
          if ('mlEnabled' in abTestConfig) {
            effectiveMlEnabled = abTestConfig.mlEnabled as boolean;
          }
          if (abTestConfig.personalizationMode) {
            effectivePersonalizationMode = abTestConfig.personalizationMode as string;
          }
        }

        // ---------- ENHANCED ML INTEGRATION ----------
        if (effectiveMlEnabled && ordersWithItems.length > 0) {
          try {
            const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sid') || 'anonymous';
            const customerId = url.searchParams.get('customer_id') || url.searchParams.get('cid') || undefined;

            // Determine if we have enough data for advanced ML
            const hasRichData = ordersWithItems.length >= 100;
            const hasGoodData = ordersWithItems.length >= 50;

            // Update data quality metric
            if (ordersWithItems.length >= 500) {
              dataMetrics.dataQuality = 'rich';
            } else if (ordersWithItems.length >= 200) {
              dataMetrics.dataQuality = 'good';
            } else if (ordersWithItems.length >= 50) {
              dataMetrics.dataQuality = 'growing';
            } else {
              dataMetrics.dataQuality = 'new_store';
            }

            // COLD START HANDLING - Enhanced recommendations for new stores
            if (ordersWithItems.length < 50) {
              try {
                // BigCommerce does not have a productRecommendations API equivalent.
                // Strategy: Get trending/best-selling products from catalog
                const coldStartRecs: Array<{ id: string; title: string; price: number; handle: string; image?: string }> = [];

                try {
                  const { products: trendingProducts } = await getProducts(shopStr, { limit: 10, include: "images,variants", is_visible: true });
                  for (const prod of trendingProducts) {
                    const prodId = String(prod.id);
                    // Don't add if already in cart
                    if (!anchors.has(prodId)) {
                      const normalized = normalizeProduct(prod);
                      if (normalized.inStock) {
                        coldStartRecs.push({
                          id: prodId,
                          title: normalized.title,
                          price: normalized.price,
                          handle: normalized.handle,
                          image: normalized.image,
                        });
                      }
                    }
                  }
                } catch {
                  // skip trending fetch failures
                }

                // Mix cold start recs with existing (70% cold start, 30% traditional)
                if (coldStartRecs.length > 0) {
                  const coldStartCount = Math.ceil(limit * 0.7);
                  const traditionalCount = Math.floor(limit * 0.3);

                  finalRecommendations = [
                    ...coldStartRecs.slice(0, coldStartCount),
                    ...combined.slice(0, traditionalCount)
                  ].slice(0, limit);

                  dataMetrics.mlEnhanced = true;
                }
              } catch (coldStartError) {
                // Fall through to normal ML processing
              }
            }

            // ML PERSONALIZATION MODE ROUTING
            let mlRecommendations: MLRecommendation[] = [];

            if (effectivePersonalizationMode === 'ai_first' && hasGoodData) {
              // Get ML user profile (respecting privacy)
              const userProfile = mlPrivacyLevel !== 'basic' ? {
                sessionId,
                customerId: mlPrivacyLevel === 'advanced' ? customerId : undefined,
                privacyLevel: mlPrivacyLevel
              } : null;

              // Combine multiple ML strategies
              const mlPromises = [];

              // 1. Content-based recommendations
              if (anchors.size > 0) {
                mlPromises.push(
                  fetch(`${url.origin}/api/ml/content-recommendations`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      product_ids: Array.from(anchors),
                      exclude_ids: cartParam ? cartParam.split(',') : [],
                      customer_preferences: userProfile,
                      privacy_level: mlPrivacyLevel
                    })
                  }).then(r => r.ok ? r.json() : null).catch(() => null)
                );
              }

              // 2. Collaborative filtering (if advanced personalization)
              if (mlPrivacyLevel === 'advanced' && customerId) {
                mlPromises.push(
                  fetch(`${url.origin}/api/ml/collaborative-data`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      privacy_level: mlPrivacyLevel,
                      include_user_similarities: true
                    })
                  }).then(r => r.ok ? r.json() : null).catch(() => null)
                );
              }

              const mlResults = await Promise.all(mlPromises);

              // Extract recommendations from ML responses
              mlResults.forEach(result => {
                if (result?.recommendations) {
                  mlRecommendations.push(...result.recommendations);
                }
              });

              if (mlRecommendations.length > 0) {
                // Merge ML recommendations with existing ones
                const mlProductIds = mlRecommendations.map((r) => r.product_id);
                const mlProducts = await normalizeIdsToProducts(shopStr, mlProductIds);

                // Prioritize ML recommendations
                const mlEnhanced = mlProducts.slice(0, Math.floor(limit * 0.7)); // 70% ML
                const traditional = combined.filter(c => !mlProductIds.includes(c.id)).slice(0, Math.ceil(limit * 0.3)); // 30% traditional

                finalRecommendations = [...mlEnhanced, ...traditional].slice(0, limit);
                dataMetrics.mlEnhanced = true;
              }

            } else if (effectivePersonalizationMode === 'popular') {
              // Get popular recommendations
              const popularResponse = await fetch(`${url.origin}/api/ml/popular-recommendations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  exclude_ids: cartParam ? cartParam.split(',').concat(Array.from(anchors)) : Array.from(anchors),
                  customer_preferences: mlPrivacyLevel !== 'basic' ? { sessionId, customerId, privacyLevel: mlPrivacyLevel } : null,
                  privacy_level: mlPrivacyLevel
                })
              }).then(r => r.ok ? r.json() as Promise<MLRecommendationResponse> : null).catch(() => null);

              if (popularResponse?.recommendations) {
                const popularIds = popularResponse.recommendations.map((r) => r.product_id);
                const popularProducts = await normalizeIdsToProducts(shopStr, popularIds);

                finalRecommendations = popularProducts.slice(0, limit);
                dataMetrics.mlEnhanced = true;
              }

            } else if (effectivePersonalizationMode === 'balanced') {
              // Balanced approach: 40% ML, 30% co-purchase, 30% popular
              if (hasGoodData) {
                const contentResponse = await fetch(`${url.origin}/api/ml/content-recommendations`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    product_ids: Array.from(anchors),
                    exclude_ids: cartParam ? cartParam.split(',') : [],
                    privacy_level: mlPrivacyLevel
                  })
                }).then(r => r.ok ? r.json() as Promise<MLRecommendationResponse> : null).catch(() => null);

                if (contentResponse?.recommendations) {
                  const mlIds = contentResponse.recommendations.slice(0, Math.floor(limit * 0.4)).map((r) => r.product_id);
                  const mlProducts = await normalizeIdsToProducts(shopStr, mlIds);

                  // Mix with traditional recommendations
                  const coPurchase = combined.slice(0, Math.ceil(limit * 0.6));

                  // Interleave for diversity
                  const balanced: ProductWithMeta[] = [];
                  const maxLen = Math.max(mlProducts.length, coPurchase.length);
                  for (let i = 0; i < maxLen && balanced.length < limit; i++) {
                    if (i < mlProducts.length) balanced.push(mlProducts[i]);
                    if (balanced.length < limit && i < coPurchase.length) balanced.push(coPurchase[i]);
                  }

                  finalRecommendations = balanced.slice(0, limit);
                  dataMetrics.mlEnhanced = true;
                }
              }
            }

            // Fallback to basic inline ML if no advanced ML was applied
            if (!dataMetrics.mlEnhanced && hasGoodData) {
              // Enhanced scoring with real customer behavior
              const enhancedScoring = combined.map(rec => {
                const productAppearances = ordersWithItems.filter(order =>
                  order.items.some((li) => String(li.product_id) === rec.id)
                ).length;

                const popularityScore = productAppearances / Math.max(1, ordersWithItems.length);
                const enhancedScore = popularityScore * (effectivePersonalizationMode === 'advanced' ? 2.0 : 1.5);

                return { ...rec, mlScore: enhancedScore };
              });

              finalRecommendations = enhancedScoring
                .sort((a, b) => (b.mlScore || 0) - (a.mlScore || 0))
                .slice(0, limit);

              dataMetrics.mlEnhanced = true;
            }

            // Track ML recommendation event (if privacy allows)
            if (enableBehaviorTracking && mlPrivacyLevel !== 'basic') {
              try {
                if (db?.trackingEvent?.create) {
                  await db.trackingEvent.create({
                    data: {
                      storeHash: shopStr,
                      event: 'ml_recommendation_served',
                      productId: Array.from(anchors)[0] || '',
                      sessionId: sessionId,
                      customerId: mlPrivacyLevel === 'advanced' ? customerId : null,
                      source: 'cart_drawer',
                      metadata: JSON.stringify({
                        anchors: Array.from(anchors),
                        recommendationCount: finalRecommendations.length,
                        recommendationIds: finalRecommendations.map(r => r.id),
                        dataQuality: dataMetrics.dataQuality,
                        mlMode: effectivePersonalizationMode,
                        orderDataPoints: ordersWithItems.length,
                        privacyLevel: mlPrivacyLevel
                      }),
                      createdAt: new Date()
                    }
                  }).catch(() => { });
                }
              } catch (trackingError) {
                // best-effort
              }
            }

          } catch (mlError) {
            // Graceful degradation - keep original recommendations
          }
        }

        // APPLY DAILY LEARNING - Filter bad products, boost good ones
        try {
          const candidateIds = finalRecommendations.map(r => r.id);

          if (candidateIds.length > 0) {
            const performance = await db.mLProductPerformance?.findMany({
              where: {
                storeHash: shopStr,
                productId: { in: candidateIds }
              }
            }) || [] as ProductPerformance[];

            if (performance.length > 0) {
              // Filter out blacklisted products
              const blacklisted = performance.filter((p) => p.isBlacklisted).map((p) => p.productId);
              if (blacklisted.length > 0) {
                finalRecommendations = finalRecommendations.filter(rec => !blacklisted.includes(rec.id));
              }

              // Adjust scores based on confidence
              const scoredRecs = finalRecommendations as RecommendationWithScore[];
              for (const rec of scoredRecs) {
                const perf = performance.find((p) => p.productId === rec.id);
                if (perf) {
                  const originalScore = rec.score || 0.5;

                  if (perf.confidence > 0.7) {
                    // High confidence - boost by 30%
                    rec.score = originalScore * 1.3;
                  } else if (perf.confidence < 0.3) {
                    // Low confidence - penalize by 30%
                    rec.score = originalScore * 0.7;
                  }
                }
              }

              // Re-sort by adjusted scores
              scoredRecs.sort((a, b) => (b.score || 0) - (a.score || 0));

              // Track that learning was applied
              dataMetrics.mlEnhanced = true;
            }
          }
        } catch (perfError) {
          // best-effort
        }

        const payload = {
          recommendations: finalRecommendations,
          ml_data: mlEnabled ? {
            enhanced: dataMetrics.mlEnhanced,
            order_count: dataMetrics.orderCount,
            data_quality: dataMetrics.dataQuality,
            personalization_mode: mlPersonalizationMode,
            privacy_level: mlPrivacyLevel
          } : undefined
        };
        setRecsCache(cacheKey, payload);

        return json(payload, {
          headers: {
            'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
            'Cache-Control': 'public, max-age=60',
            'X-Recs-Cache': 'MISS',
            'X-ML-Enhanced': String(dataMetrics.mlEnhanced),
            'X-Data-Quality': dataMetrics.dataQuality
          },
        });
      }
    } catch (error) {
      // ULTIMATE FALLBACK - Never return empty, always show something
      try {
        const storeHash = await authenticateStorefront(request);
        const emergencyLimit = parseInt(url.searchParams.get('limit') || '6', 10);

        // Last resort: Get products from catalog
        try {
          const { products: emergencyProducts } = await getProducts(storeHash, { limit: 10, include: "images,variants", is_visible: true });

          if (emergencyProducts.length > 0) {
            const emergencyRecs = emergencyProducts
              .slice(0, emergencyLimit)
              .map(prod => {
                const normalized = normalizeProduct(prod);
                return {
                  id: normalized.id,
                  title: normalized.title,
                  handle: normalized.handle,
                  price: normalized.price,
                  image: normalized.image,
                  variant_id: normalized.variant_id,
                };
              });

            return json({
              recommendations: emergencyRecs,
              fallback: 'emergency',
              reason: 'primary_system_failure'
            }, {
              status: 200,
              headers: {
                'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
                'Cache-Control': 'public, max-age=10',
                'X-Fallback-Level': 'emergency'
              }
            });
          }
        } catch {
          // fall through
        }
      } catch (fallbackError) {
        // fall through
      }

      // Absolute last resort: Empty list (but logged)
      return json({
        recommendations: [],
        fallback: 'none',
        reason: 'all_systems_down'
      }, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
          'Cache-Control': 'no-cache',
          'X-Fallback-Level': 'complete_failure'
        }
      });
    }
  }

  // GET /apps/proxy/api/products
  // Lightweight product search for theme/app proxy contexts
  if (path.includes('/api/products')) {
    let allowedOrigin: string | null = null;
    try {
      const storeHash = await authenticateStorefront(request);

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = await validateCorsOrigin(origin, storeHash);

      const shopStr = storeHash;
      const shopCurrency = await getShopCurrency(shopStr);

      const q = url.searchParams.get('query') || '';
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

      const { products: bcProducts, hasNextPage } = await getProducts(shopStr, {
        limit,
        keyword: q || undefined,
        include: "images,variants",
      });

      const products = bcProducts.map((prod) => {
        const variants = (prod.variants || []).map((v) => ({
          id: String(v.id),
          title: v.option_values?.map(o => o.label).join(' / ') || '',
          price: v.calculated_price ?? v.price ?? prod.price ?? 0,
          availableForSale: !v.purchasing_disabled,
        }));
        const minPrice = prod.price ?? variants[0]?.price ?? 0;
        const handle = (prod.custom_url?.url || '').replace(/^\/|\/$/g, '');
        return {
          id: String(prod.id),
          title: prod.name,
          handle,
          status: prod.is_visible ? 'ACTIVE' : 'DRAFT',
          image: prod.images?.[0]?.url_standard || null,
          imageAlt: prod.name,
          minPrice,
          currency: shopCurrency.code,
          price: minPrice,
          variants,
        };
      });

      return json({
        products,
        hasNextPage,
        currency: shopCurrency.code,
        currencyFormat: shopCurrency.format
      }, {
        headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' }
      });
    } catch (e) {
      return json({ products: [], error: 'unavailable' }, { status: 500, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
    }
  }

  // GET /apps/proxy/api/bundles
  // Returns simple, high-confidence bundles for PDP based on recent co-purchases.
  if (path.includes('/api/bundles')) {
    let allowedOrigin: string | null = null;
    try {
      const storeHash = await authenticateStorefront(request);

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = await validateCorsOrigin(origin, storeHash);

      const shopStr = storeHash;

      // Check subscription limits - ENFORCE ORDER LIMITS
      const subscription = await getOrCreateSubscription(shopStr);
      if (subscription.isLimitReached) {
        return json({
          bundles: [],
          message: 'Order limit reached. Please upgrade your plan to continue.',
          limitReached: true
        }, {
          status: 403,
          headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'limit_reached' }
        });
      }

      const context = url.searchParams.get('context') || 'product';
      const productIdParam = url.searchParams.get('product_id') || undefined;

      // Feature flag check
      let settings: Awaited<ReturnType<typeof getSettings>> | undefined = undefined;
      try {
        settings = await getSettings(shopStr);
      } catch (_e) {
        // proceed with defaults
      }

      // ML Settings for Bundles
      const bundleMLSettings = settings ? {
        enabled: Boolean(settings.enableMLRecommendations),
        smartBundlesEnabled: Boolean(settings.enableSmartBundles),
        personalizationMode: String(settings.mlPersonalizationMode || 'basic'),
        privacyLevel: String(settings.mlPrivacyLevel || 'basic'),
        behaviorTracking: Boolean(settings.enableBehaviorTracking)
      } : { enabled: false, smartBundlesEnabled: false, personalizationMode: 'basic', privacyLevel: 'basic', behaviorTracking: false };

      if (
        context === 'product' &&
        settings &&
        Object.prototype.hasOwnProperty.call(settings, 'bundlesOnProductPages') &&
        settings.bundlesOnProductPages === false
      ) {
        return json({ bundles: [], reason: 'disabled_page' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin, X-Bundles-Gated', 'X-Bundles-Gated': '1', 'X-Bundles-Reason': 'disabled_page', 'X-Bundles-Context': context } });
      }

      // Relaxed gating: only gate if settings are loaded AND bundlesOnProductPages is explicitly false.
      if (context === 'product' && settings?.bundlesOnProductPages === false) {
        return json({ bundles: [], reason: 'disabled_page' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin, X-Bundles-Gated', 'X-Bundles-Gated': '1', 'X-Bundles-Reason': 'disabled_page', 'X-Bundles-Context': context } });
      }

      if (context !== 'product' || !productIdParam) {
        return json({ bundles: [], reason: 'invalid_params' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'invalid_params', 'X-Bundles-Context': String(context) } });
      }

      // Resolve product id: accept numeric id
      let productId = String(productIdParam);

      // Guard: unresolved or invalid product id
      if (!productId || !/^[0-9]+$/.test(productId)) {
        return json({ bundles: [], reason: 'invalid_product' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'invalid_product', 'X-Bundles-Context': context } });
      }

      const numericProductId = parseInt(productId, 10);

      // Fetch real products from the store to use in bundles
      // Get the current product details
      let currentProduct: BCProduct | null = null;
      try {
        currentProduct = await getProduct(shopStr, numericProductId, "images,variants");
      } catch (_e) {
        // product not found
      }

      // Get other products from the store
      let otherProducts: BCProduct[] = [];
      try {
        const { products: prods } = await getProducts(shopStr, { limit: 50, include: "images,variants", is_visible: true });
        otherProducts = prods;
      } catch (_e) {
        // proceed without other products
      }

      // Create bundles using context-aware recommendations
      const bundles: unknown[] = [];

      // Load AI bundle configuration for discount settings
      type AiBundleSelect = {
        id: string;
        name: string;
        discountType: string;
        discountValue: number;
      };
      let aiBundleConfig: AiBundleSelect | null = null;
      try {
        aiBundleConfig = await db.bundle.findFirst({
          where: {
            storeHash: shopStr,
            type: 'ml',
            status: 'active'
          },
          select: {
            id: true,
            name: true,
            discountType: true,
            discountValue: true
          },
          orderBy: {
            updatedAt: 'desc'
          }
        });
        console.log('[Proxy /api/bundles v2.0] AI Bundle Config:', aiBundleConfig ? `Found: ${aiBundleConfig.name} (${aiBundleConfig.discountValue}%)` : 'Not found');
      } catch (e) {
        console.error('[Proxy /api/bundles] Error fetching AI bundle config:', e);
      }

      if (currentProduct) {
        const currentProd = getBCProductDetails(currentProduct);

        // Skip bundle creation if current product doesn't have valid variants
        if (!currentProd) {
          return json({ bundles: [], reason: 'no_variants' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }

        // Compute related products from recent orders (focused on this anchor)
        let ordersWithItems: Array<{
          id: number;
          date_created: string;
          items: Array<{ product_id: number; name: string; price: number }>;
        }> = [];
        try {
          ordersWithItems = await fetchOrdersWithProducts(shopStr, 200);
        } catch {
          ordersWithItems = [];
        }

        let relatedIds: string[] = [];
        let debugInfo: { method: string; anchor: string; orderCount: number; assocCount: number } = { method: 'none', anchor: String(productId), orderCount: 0, assocCount: 0 };
        try {
          debugInfo.orderCount = ordersWithItems.length;
          // Decay setup similar to recommendations endpoint
          const HALF_LIFE_DAYS = 60;
          const LN2_OVER_HL = Math.log(2) / HALF_LIFE_DAYS;
          const wAppear: Record<string, number> = {};

          interface AssociationData {
            copurchases: Record<string, { wco: number }>;
            wAppear: number;
          }
          const assoc: Record<string, AssociationData> = {};
          for (const order of ordersWithItems) {
            const createdAt = new Date(order.date_created);
            const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86400000);
            const w = Math.exp(-LN2_OVER_HL * ageDays);
            const items: Array<{ pid: string }> = [];
            for (const lineItem of order.items) {
              if (!lineItem.product_id) continue;
              const pid = String(lineItem.product_id);
              items.push({ pid });
            }
            if (items.length < 2) continue;
            const seen = new Set<string>();
            for (const it of items) { if (!seen.has(it.pid)) { wAppear[it.pid] = (wAppear[it.pid] || 0) + w; seen.add(it.pid); } }
            for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
              const a = items[i].pid, b = items[j].pid;
              assoc[a] = assoc[a] || { copurchases: {}, wAppear: 0 };
              assoc[b] = assoc[b] || { copurchases: {}, wAppear: 0 };
              assoc[a].copurchases[b] = assoc[a].copurchases[b] || { wco: 0 };
              assoc[b].copurchases[a] = assoc[b].copurchases[a] || { wco: 0 };
              assoc[a].copurchases[b].wco += w;
              assoc[b].copurchases[a].wco += w;
              assoc[a].wAppear += w;
              assoc[b].wAppear += w;
            }
          }
          debugInfo.assocCount = Object.keys(assoc).length;
          const anchor = String(productId);
          const cand: Record<string, number> = {};
          const aStats = assoc[anchor];
          const totalW = Object.values(wAppear).reduce((a, b) => a + b, 0) || 1;
          if (aStats) {
            for (const [b, ab] of Object.entries(aStats.copurchases)) {
              if (b === anchor) continue;
              const wB = wAppear[b] || 0; if (wB <= 0) continue;
              const confidence = ab.wco / Math.max(1e-6, aStats.wAppear || 1);
              const probB = wB / totalW;
              const lift = probB > 0 ? confidence / probB : 0;
              const liftCap = 2.0; const liftNorm = Math.min(liftCap, lift) / liftCap;
              const popNorm = Math.min(1, wB / (totalW * 0.05));
              cand[b] = Math.max(cand[b] || 0, 0.6 * liftNorm + 0.4 * popNorm);
            }
            debugInfo.method = 'orders';
          }
          relatedIds = Object.entries(cand).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
        } catch {
          relatedIds = [];
        }

        // Fallback: category-based or catalog-based when orders are insufficient
        if (relatedIds.length === 0 && otherProducts.length > 0) {
          const curCategories = currentProduct.categories || [];
          const byCategory = curCategories.length > 0
            ? otherProducts.filter((p) => p.categories?.some(c => curCategories.includes(c)))
            : [];
          const candidates = (byCategory.length ? byCategory : otherProducts)
            .filter((p) => String(p.id) !== String(productId));
          // Shuffle and take up to 4
          const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
          relatedIds = shuffled.map((p) => String(p.id)).slice(0, 4);
          debugInfo.method = byCategory.length ? 'category' : 'catalog';
        }

        // Fetch details for related products
        let relatedProducts: BCProduct[] = [];
        if (relatedIds.length) {
          for (const rid of relatedIds) {
            try {
              const numId = parseInt(rid, 10);
              if (isNaN(numId)) continue;
              const prod = await getProduct(shopStr, numId, "images,variants");
              relatedProducts.push(prod);
            } catch {
              // skip
            }
          }
        }

        // Choose top 2 complements, exclude subscription/selling-plan only products heuristically
        let filteredRelated = relatedProducts.filter((p) => {
          const t = (p?.name || '').toLowerCase();
          const h = (p?.custom_url?.url || '').toLowerCase();
          if (t.includes('selling plan') || h.includes('selling-plan') || t.includes('subscription')) return false;
          const variants = p?.variants || [];
          // keep if any variant is purchasable
          return variants.length === 0 || variants.some((v) => !v.purchasing_disabled);
        });
        // If filtering removed everything, relax to any product with at least one variant
        if (filteredRelated.length === 0) {
          filteredRelated = relatedProducts.filter((p) => (p?.variants || []).length > 0);
        }
        // ensure unique products by id
        const uniq: BCProduct[] = [];
        const used = new Set<string>([String(currentProduct.id)]);
        for (const rp of filteredRelated) {
          const id = String(rp.id);
          if (used.has(id)) continue; used.add(id); uniq.push(rp);
          if (uniq.length >= 2) break;
        }
        let complementProducts: BCProduct[] = uniq;
        // Second-tier fallback: build complements from other active products
        if (complementProducts.length === 0 && otherProducts.length) {
          const candidates = otherProducts.filter((p) => String(p.id) !== String(currentProduct!.id));
          const mapped = candidates.map(getBCProductDetails).filter((p): p is NonNullable<typeof p> => p !== null && typeof p.price === 'number' && p.price >= 0);
          // For this fallback, we need the raw products, but already filtered
          complementProducts = candidates.filter(p => {
            const detail = getBCProductDetails(p);
            return detail !== null && typeof detail.price === 'number' && detail.price >= 0;
          }).slice(0, 2);
        }
        const bundleProducts = [currentProd, ...complementProducts.map(getBCProductDetails)].filter((p): p is NonNullable<typeof p> => p !== null);
        if (bundleProducts.length >= 2) {
          const regularTotal = bundleProducts.reduce((sum, p) => sum + ((p && typeof p.price === 'number') ? p.price : 0), 0);

          // Get discount from AI bundle config ONLY - default to 0%
          let discountPercent = 0;
          let discountType = 'percentage';

          // Check if aiBundleConfig exists and has discountValue defined (including 0)
          if (aiBundleConfig && (aiBundleConfig.discountValue !== undefined && aiBundleConfig.discountValue !== null)) {
            discountPercent = parseFloat(aiBundleConfig.discountValue.toString());
            discountType = aiBundleConfig.discountType || 'percentage';
          }

          // Since prices are now in cents, keep calculation in cents
          const bundlePrice = Math.round(regularTotal * (1 - discountPercent / 100));

          // Generate a descriptive name for the dynamic bundle
          const bundleName = `Frequently Bought Together${bundleProducts.length > 0 ? ': ' + bundleProducts.slice(0, 2).map(p => p.title).join(' + ') + (bundleProducts.length > 2 ? '...' : '') : ''}`;

          bundles.push({
            id: `bundle_dynamic_${productId}`,
            name: bundleName,
            description: 'AI-recommended products often purchased together',
            products: bundleProducts,
            regular_total: regularTotal,
            bundle_price: bundlePrice,
            discount_percent: discountPercent,
            discountType: discountType,
            discountValue: discountPercent,
            savings_amount: regularTotal - bundlePrice,
            discount_code: discountPercent >= 15 ? 'BUNDLE_MATCH_15' : 'BUNDLE_MATCH_10',
            status: 'active',
            source: 'orders_based',
            debug: debugInfo
          });
        }
      }

      // BEFORE returning ML bundles, check for MANUAL bundles from database
      try {
        // Check for both manual AND ML bundle configurations
        const manualBundles = await db.bundle.findMany({
          where: {
            storeHash: shopStr,
            status: 'active',
            type: 'manual',
            OR: [
              { assignmentType: 'all' },
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });

        const aiBundles = await db.bundle.findMany({
          where: {
            storeHash: shopStr,
            status: 'active',
            type: 'ml',
            OR: [
              { assignmentType: 'all' },
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });

        const collectionBundles = await db.bundle.findMany({
          where: {
            storeHash: shopStr,
            status: 'active',
            type: 'collection',
            OR: [
              { assignmentType: 'all' },
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });

        // Priority 1: Return manual bundles if they exist
        if (manualBundles.length > 0) {
          const formattedManualBundles = await Promise.all(manualBundles.map(async (bundle) => {
            // Parse productIds from JSON string
            let bundleProductIds: string[] = [];
            try {
              bundleProductIds = JSON.parse(bundle.productIds || '[]');
            } catch (e) {
              // skip
            }

            // Fetch product details for bundle from BC
            const bundleProductDetails = await Promise.all(bundleProductIds.map(async (pid) => {
              try {
                const numId = parseInt(pid, 10);
                if (isNaN(numId)) return null;
                const prod = await getProduct(shopStr, numId, "images,variants");
                return getBCProductDetails(prod);
              } catch (e) {
                return null;
              }
            }));

            const validProducts = bundleProductDetails.filter((p): p is NonNullable<typeof p> => p !== null);

            if (validProducts.length === 0) {
              return null;
            }

            // ADD CURRENT PRODUCT to the bundle (like ML bundles do)
            let currentProductFormatted: BundleProductDetail | null = null;
            if (currentProduct) {
              currentProductFormatted = getBCProductDetails(currentProduct);
            }

            // Prepend current product to the bundle (it should appear first as "This item")
            const allBundleProducts = currentProductFormatted
              ? [currentProductFormatted, ...validProducts]
              : validProducts;

            const regularTotal = allBundleProducts.reduce((sum, p) => sum + (p.price || 0), 0);
            const bundlePrice = bundle.discountType === 'percentage'
              ? regularTotal * (1 - bundle.discountValue / 100)
              : regularTotal - (bundle.discountValue * 100); // Convert discount value to cents for fixed amounts
            const discountPercent = regularTotal > 0 ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100) : 0;

            return {
              id: bundle.id,
              name: bundle.name,
              description: bundle.description || '',
              type: bundle.type,
              bundleStyle: bundle.bundleStyle || 'fbt',
              discountType: bundle.discountType,
              discountValue: bundle.discountValue,
              products: allBundleProducts,
              regular_total: regularTotal,
              bundle_price: bundlePrice,
              discount_percent: discountPercent,
              savings_amount: regularTotal - bundlePrice,
              selectMinQty: bundle.selectMinQty || 2,
              selectMaxQty: bundle.selectMaxQty || allBundleProducts.length,
              status: 'active',
              source: 'manual'
            };
          }));

          const validManualBundles = formattedManualBundles.filter(b => b !== null);

          if (validManualBundles.length > 0) {
            let currencyCode = 'USD';
            try {
              const storeInfo = await getStoreInfo(shopStr);
              currencyCode = storeInfo.currency || 'USD';
            } catch (_err) {
              // fall through
            }

            return json({ success: true, bundles: validManualBundles, currency: currencyCode }, {
              headers: {
                'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
                'Cache-Control': 'public, max-age=30',
                'X-Bundles-Source': 'manual',
                'X-Bundles-Count': String(validManualBundles.length),
                'X-Bundles-Currency': currencyCode
              }
            });
          }
        }

        // Priority 2: Process collection-based bundles
        // BigCommerce does not have a GraphQL collection API; we use categories instead.
        // Collection bundles in the DB may reference category IDs.
        if (collectionBundles.length > 0) {
          const formattedCollectionBundles = await Promise.all(collectionBundles.map(async (bundle) => {
            // Parse collectionIds (which map to BC category IDs) from JSON string
            let collectionIds: string[] = [];
            try {
              collectionIds = JSON.parse(bundle.collectionIds || '[]');
            } catch (e) {
              // skip
            }

            if (collectionIds.length === 0) {
              return null;
            }

            // Fetch products from the category
            const categoryId = parseInt(collectionIds[0], 10);
            let collectionProducts: BCProduct[] = [];
            try {
              const { products: catProducts } = await getProducts(shopStr, {
                limit: 50,
                include: "images,variants",
                is_visible: true,
              });
              // Filter by category membership
              collectionProducts = catProducts.filter(p => p.categories?.includes(categoryId));
            } catch (e) {
              return null;
            }

            if (collectionProducts.length === 0) {
              return null;
            }

            // Exclude current product
            const collectionProductIds = collectionProducts
              .map(p => String(p.id))
              .filter(id => id !== productId);

            if (collectionProductIds.length === 0) {
              return null;
            }

            // Simple selection: take up to 2 products
            const selectedProductIds = collectionProductIds.slice(0, 2);

            // Fetch full details for selected products
            const validProducts: BundleProductDetail[] = [];
            for (const pid of selectedProductIds) {
              try {
                const numId = parseInt(pid, 10);
                if (isNaN(numId)) continue;
                const prod = await getProduct(shopStr, numId, "images,variants");
                const detail = getBCProductDetails(prod);
                if (detail) validProducts.push(detail);
              } catch (e) {
                // skip
              }
            }

            if (validProducts.length === 0) {
              return null;
            }

            // Add current product to the bundle
            let currentProductFormatted: BundleProductDetail | null = null;
            if (currentProduct) {
              currentProductFormatted = getBCProductDetails(currentProduct);
            }

            const allBundleProducts = currentProductFormatted
              ? [currentProductFormatted, ...validProducts]
              : validProducts;

            const regularTotal = allBundleProducts.reduce((sum, p) => sum + (p.price || 0), 0);
            const bundlePrice = bundle.discountType === 'percentage'
              ? regularTotal * (1 - bundle.discountValue / 100)
              : regularTotal - (bundle.discountValue * 100);
            const discountPercent = regularTotal > 0 ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100) : 0;

            return {
              id: bundle.id,
              name: bundle.name,
              description: bundle.description || '',
              type: bundle.type,
              bundleStyle: bundle.bundleStyle || 'fbt',
              discountType: bundle.discountType,
              discountValue: bundle.discountValue,
              products: allBundleProducts,
              regular_total: regularTotal,
              bundle_price: bundlePrice,
              discount_percent: discountPercent,
              savings_amount: regularTotal - bundlePrice,
              selectMinQty: bundle.selectMinQty || 2,
              selectMaxQty: bundle.selectMaxQty || allBundleProducts.length,
              status: 'active',
              source: 'collection'
            };
          }));

          const validCollectionBundles = formattedCollectionBundles.filter(b => b !== null);

          if (validCollectionBundles.length > 0) {
            let currencyCode = 'USD';
            try {
              const storeInfo = await getStoreInfo(shopStr);
              currencyCode = storeInfo.currency || 'USD';
            } catch (_err) {
              // fall through
            }

            return json({ success: true, bundles: validCollectionBundles, currency: currencyCode }, {
              headers: {
                'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
                'Cache-Control': 'public, max-age=30',
                'X-Bundles-Source': 'collection',
                'X-Bundles-Count': String(validCollectionBundles.length),
                'X-Bundles-Currency': currencyCode
              }
            });
          }
        }

        // Priority 3: Generate ML bundles ONLY if AI bundle config exists
        if (aiBundles.length > 0 && bundles.length > 0) {
          let currencyCode = 'USD';
          try {
            const storeInfo = await getStoreInfo(shopStr);
            currencyCode = storeInfo.currency || 'USD';
          } catch (_err) {
            // fall through
          }

          return json({ success: true, bundles, currency: currencyCode }, {
            headers: {
              'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
              'Cache-Control': 'public, max-age=30',
              'X-Bundles-Source': 'ai_configured',
              'X-Bundles-Count': String(bundles.length),
              'X-Bundles-Currency': currencyCode
            }
          });
        }

        // No bundles configured at all
        return json({ success: true, bundles: [], reason: 'no_bundles_configured' }, {
          headers: {
            'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin',
            'Cache-Control': 'public, max-age=30',
            'X-Bundles-Source': 'none',
            'X-Bundles-Reason': 'no_bundles_configured'
          }
        });

      } catch (manualErr) {
        return json({ success: true, bundles: [], reason: 'db_error' }, {
          headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' }
        });
      }
    } catch (err: unknown) {
      console.error('[Proxy /api/bundles] Error:', err);
      return json({ bundles: [], reason: 'unavailable' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
    }
  }

  // Handle /apps/proxy/api/settings
  if (path.includes('/api/settings')) {
    try {
      const storeHash = await authenticateStorefront(request);

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      // CRITICAL: Enforce order limit - block ALL functionality if limit reached
      const subscription = await getOrCreateSubscription(storeHash);
      if (subscription.isLimitReached) {
        return json({
          error: 'Order limit reached. Please upgrade your plan to continue using Cart Uplift.',
          limitReached: true,
          orderCount: subscription.orderCount,
          orderLimit: subscription.orderLimit,
          planTier: subscription.planTier,
          hardLimit: subscription.hardLimit,
          upgradeUrl: '/manage'
        }, {
          status: 402, // 402 Payment Required
          headers: corsHeaders,
        });
      }

      const settings = await getSettings(storeHash);
      // Normalize layout to theme values
      const layoutMap: Record<string, string> = {
        horizontal: 'row',
        row: 'row',
        carousel: 'row',
        vertical: 'column',
        column: 'column',
        list: 'column',
        grid: 'grid'
      };
      const settingsExtended = settings as typeof settings & { enableTitleCaps?: boolean };
      const normalized = {
        source: 'db',
        ...settings,
        enableRecommendationTitleCaps: settings.enableRecommendationTitleCaps ?? settingsExtended.enableTitleCaps ?? false,
        recommendationLayout: layoutMap[settings.recommendationLayout] || settings.recommendationLayout,
      };

      return json(normalized, {
        headers: {
          ...corsHeaders,
        },
      });
    } catch (error) {
      // Unauthorized or invalid signature
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Default response for other proxy requests
  return json({ message: "Cart Uplift App Proxy" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION
// ═══════════════════════════════════════════════════════════════════════════════

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get("origin") || "";
    const storeHash = url.searchParams.get("store_hash") || url.searchParams.get("shop") || undefined;
    const allowedOrigin = storeHash ? await validateCorsOrigin(origin, storeHash) : null;
    const corsHeaders = getCorsHeaders(allowedOrigin);

    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    // Heartbeat from theme embed to mark installed/enabled
    if (path.includes('/api/embed-heartbeat')) {
      let storeHash: string;
      try {
        storeHash = await authenticateStorefront(request);
      } catch (_e) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      const now = new Date().toISOString();
      await saveSettings(storeHash, { themeEmbedEnabled: true, themeEmbedLastSeen: now });
      return json({ success: true }, {
        headers: corsHeaders,
      });
    }

    // Validate discount codes from the storefront (cart modal)
    if (path.includes('/api/discount')) {
      let storeHash: string | undefined;
      try {
        storeHash = await authenticateStorefront(request);
      } catch (_e) {
        // fall through
      }

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = storeHash ? await validateCorsOrigin(origin, storeHash) : null;
      const corsHeaders = getCorsHeaders(allowedOrigin);

      const contentType = request.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await request.json()
        : Object.fromEntries(await request.formData());

      const payloadData = payload as Record<string, unknown>;
      const discountCode = String(payloadData.discountCode || '').trim();

      if (!discountCode) {
        return json({ success: false, error: 'Discount code is required' }, {
          status: 400,
          headers: corsHeaders,
        });
      }

      // If we can't determine the store, fail closed (do not accept unknown codes)
      if (!storeHash) {
        return json({ success: false, error: 'Unable to validate discount code' }, {
          status: 401,
          headers: corsHeaders,
        });
      }

      // CRITICAL: Enforce order limit - block discount validation if limit reached
      const subscription = await getOrCreateSubscription(storeHash);
      if (subscription.isLimitReached) {
        return json({
          success: false,
          error: 'Order limit reached. Please upgrade your plan to continue.',
          limitReached: true
        }, {
          status: 402,
          headers: corsHeaders,
        });
      }

      // BigCommerce does not have a storefront discount code validation API equivalent.
      // Return a stub response that tells the frontend the code will be applied at checkout.
      return json({
        success: true,
        discount: {
          code: discountCode,
          summary: `Discount code ${discountCode} will be applied at checkout`,
          status: 'PENDING',
          kind: undefined,
          percent: undefined,
          amountCents: undefined,
        }
      }, {
        headers: corsHeaders,
      });
    }

    // Handle /api/track-recommendations FIRST (before /api/track to avoid false match)
    if (path.includes('/api/track-recommendations')) {
      let storeHash: string;
      try {
        storeHash = await authenticateStorefront(request);
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      try {
        const body = await request.json();
        const { sessionId, customerId, anchorProducts, recommendedProducts } = body;

        // Allow empty anchorProducts (when cart is empty) but require recommendedProducts
        if (!Array.isArray(anchorProducts) || !Array.isArray(recommendedProducts) || recommendedProducts.length === 0) {
          return json({ error: "Missing required fields", details: { anchorProducts: typeof anchorProducts, recommendedProducts: typeof recommendedProducts } }, { status: 400 });
        }

        try {
          const result = await db.trackingEvent.create({
            data: {
              storeHash,
              event: 'ml_recommendation_served',
              productId: anchorProducts[0] || 'empty_cart',
              sessionId: sessionId,
              customerId: customerId || null,
              source: 'cart_drawer',
              metadata: JSON.stringify({
                anchors: anchorProducts,
                recommendationCount: recommendedProducts.length,
                recommendationIds: recommendedProducts,
                clientGenerated: true,
                timestamp: new Date().toISOString()
              }) as JsonValue,
              createdAt: new Date()
            }
          });
          return json({ success: true }, {
            headers: corsHeaders,
          });
        } catch (dbErr) {
          return json({ success: true, degraded: true, reason: 'db_unreachable' }, {
            status: 202,
            headers: { ...corsHeaders, "X-Tracking-Degraded": 'db_unreachable' }
          });
        }
      } catch (parseErr) {
        return json({ error: "Failed to save event" }, { status: 500 });
      }
    }

    // Handle /api/bundle-analytics - bundle view/click tracking
    if (path.includes('/api/bundle-analytics')) {
      let storeHash: string;
      try {
        storeHash = await authenticateStorefront(request);
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      try {
        const body = await request.json();
        const { bundleId, bundleName, bundleType, event, products } = body;
        const rawSessionId = body.sessionId as string | null | undefined;
        const sessionId = validateSessionId(rawSessionId) || null;

        if (!event || !['view', 'click'].includes(event)) {
          return json({ error: "Invalid event type" }, { status: 400 });
        }

        try {
          await db.trackingEvent.create({
            data: {
              storeHash,
              event,
              productId: bundleId || 'unknown_bundle',
              productTitle: bundleName || null,
              source: 'bundle',
              sessionId,
              metadata: JSON.stringify({
                bundleType,
                products,
                context: 'bundle',
                timestamp: new Date().toISOString()
              }) as JsonValue,
              createdAt: new Date()
            }
          });
          return json({ success: true }, {
            headers: corsHeaders,
          });
        } catch (dbErr) {
          return json({ success: true, degraded: true, reason: 'db_unreachable' }, {
            status: 202,
            headers: { ...corsHeaders, "X-Tracking-Degraded": 'db_unreachable' }
          });
        }
      } catch (parseErr) {
        return json({ error: "Failed to save bundle event" }, { status: 500 });
      }
    }

    // Handle /api/track (frontend calls this) and /api/cart-tracking (legacy)
    // NOTE: This must come AFTER /api/track-recommendations to avoid false matching
    if ((path.includes('/api/track') && !path.includes('/api/track-recommendations')) || path.includes('/api/cart-tracking')) {
      let storeHash: string;
      try {
        storeHash = await authenticateStorefront(request);
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, storeHash);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      try {
        const contentType = request.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await request.json()
          : Object.fromEntries(await request.formData());

        const trackingData = data as Record<string, unknown>;
        const event = String(trackingData.event || trackingData.eventType || '').trim();
        const productId = trackingData.productId ? String(trackingData.productId) : undefined;
        const productTitle = trackingData.productTitle ? String(trackingData.productTitle) : undefined;
        const source = trackingData.source ? String(trackingData.source) : undefined;
        const position = trackingData.position != null ? Number(trackingData.position) : undefined;
        const sessionId = trackingData.sessionId ? String(trackingData.sessionId) : undefined;
        const orderId = trackingData.orderId ? String(trackingData.orderId) : undefined;
        const revenueRaw = trackingData.revenue ?? trackingData.revenueCents ?? trackingData.revenue_cents;
        const revenueCents = revenueRaw != null ? (typeof revenueRaw === 'number' ? revenueRaw : Number(revenueRaw)) : undefined;

        if (!event) {
          return json({ success: false, error: 'Missing event type' }, { status: 400 });
        }
        if (!['impression', 'click', 'add_to_cart', 'purchase', 'ml_recommendation_served'].includes(event)) {
          return json({ success: true, ignored: true, reason: 'unknown_event' });
        }

        const finalProductId = productId || 'cart_event';

        try {
          const result = await db.trackingEvent.create({
            data: {
              storeHash,
              event,
              productId: finalProductId,
              productTitle: productTitle ?? null,
              sessionId: sessionId ?? null,
              revenueCents: typeof revenueCents === 'number' && !isNaN(revenueCents) ? revenueCents : null,
              orderId: orderId ?? null,
              source: source ?? null,
              position: typeof position === 'number' && isFinite(position) ? position : null,
            }
          });
          return json({ success: true }, {
            headers: corsHeaders,
          });
        } catch (dbErr) {
          return json({ success: true, degraded: true, reason: 'db_unreachable' }, {
            status: 202,
            headers: { ...corsHeaders, "X-Tracking-Degraded": 'db_unreachable' },
          });
        }
      } catch (e) {
        return json({ success: false }, { status: 500, headers: getCorsHeaders(null) });
      }
    }

    if (path.includes('/api/settings')) {
      // Do not allow saving settings via public proxy
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}
