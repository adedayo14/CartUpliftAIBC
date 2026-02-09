import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import type { Experiment, Variant } from "@prisma/client";
import { getSettings, saveSettings } from "../models/settings.server";
import { getShopCurrency } from "../services/currency.server";
import { getOrCreateSubscription } from "../services/billing.server";
import db from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import type { ExperimentModel, ExperimentWithVariants, VariantModel, EventModel } from "~/types/prisma";
import type { JsonValue, JsonObject } from "~/types/common";
import { validateCorsOrigin, getCorsHeaders, validateSessionId } from "../services/security.server";
// import { generateBundlesFromOrders } from "../services/ml.server";

// Type definitions for GraphQL responses
interface GraphQLProductNode {
  id: string;
  title: string;
  handle: string;
  vendor?: string;
  status?: string;
  media?: { edges: Array<{ node: { image?: { url: string } } }> };
  variants?: { edges: Array<{ node: GraphQLVariantNode }> };
}

interface GraphQLVariantNode {
  id: string;
  price: string;
  availableForSale: boolean;
  selectedOptions?: Array<{ name: string; value: string }>;
  product?: GraphQLProductNode;
}

interface GraphQLProductEdge {
  node: GraphQLProductNode;
}

interface GraphQLResponse {
  data?: {
    nodes?: Array<GraphQLProductNode | GraphQLVariantNode | null>;
    products?: {
      edges: GraphQLProductEdge[];
    };
    orders?: {
      edges: Array<{
        node: {
          id: string;
          lineItems?: {
            edges: Array<{
              node: {
                product?: { id: string };
                quantity?: number;
              };
            }>;
          };
        };
      }>;
    };
    shop?: {
      name: string;
      myshopifyDomain: string;
    };
  };
  errors?: Array<{ message: string }>;
}

interface ShopQueryResponse {
  data?: {
    shop: {
      name: string;
      myshopifyDomain: string;
    };
  };
  errors?: Array<{ message: string }>;
}

interface ProductWithMeta {
  id: string;
  title: string;
  handle: string;
  image?: string;
  price: number;
  inStock: boolean;
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
  shopQuery?: { ok: boolean; data?: boolean; error?: string };
  ordersProbe?: { status?: number; hasData?: boolean; errors?: Array<{ message: string }>; error?: string };
  productsProbe?: { status?: number; hasData?: boolean; errors?: Array<{ message: string }>; error?: string };
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
 * 🚨 PRE-PURCHASE ATTRIBUTION SNAPSHOT
 * 
 * This version has ML recommendations working but NO feedback loop:
 * - Recommendations are served ✅
 * - Impressions/clicks tracked ✅
 * - BUT: No purchase attribution ❌
 * - BUT: No learning from conversions ❌
 * - BUT: No auto-correction ❌
 * 
 * Next: Implement purchase attribution webhook + daily learning job
 */

// Lightweight in-memory cache for recommendations (per worker)
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

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname;

  // GET /apps/proxy/api/billing-check - Public endpoint for storefront billing check
  if (path.includes('/api/billing-check')) {
    try {
      const { session, admin } = await authenticate.public.appProxy(request);
      const shop = session?.shop as string;

      if (!shop) {
        return new Response("Unauthorized", { status: 401 });
      }

      // Check billing limit
      const subscription = await getOrCreateSubscription(shop, admin);

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
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = shop ? await validateCorsOrigin(origin, shop as string) : null;
      const corsHeaders = getCorsHeaders(allowedOrigin);
      const hdrs = { ...corsHeaders, 'Cache-Control': 'no-store' };

      if (!shop) return json({ ok: false, error: 'unauthorized' }, { status: 401, headers: hdrs });
      const shopStr = shop as string;

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
            shopId: shopStr,
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

        const experiment = await db.experiment.findFirst({ where: { id: experimentId, shopId: shopStr } });
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
        for (let i=0;i<normalized.length;i++) { cum += normalized[i]; if (r <= cum) { idx = i; break; } }
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
  // Diagnostics: verify App Proxy signature, Admin API reachability, and required scopes
  if (path.includes('/api/diag')) {
    try {
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = shop ? await validateCorsOrigin(origin, shop as string) : null;
      const corsHeaders = getCorsHeaders(allowedOrigin);
      const hdrs = { ...corsHeaders, 'Cache-Control': 'no-store' };

      if (!shop) return json({ ok: false, proxyAuth: false, reason: 'no_shop' }, { status: 401, headers: hdrs });

      let adminOk = false; let hasReadOrders = false; let hasReadProducts = false; let details: DiagnosticDetails = {};
      try {
        const { admin } = await unauthenticated.admin(shop as string);
        // Lightweight shop query
        const shopResp = await admin.graphql(`#graphql
          query { shop { name myshopifyDomain } }
        `);
        adminOk = shopResp.ok === true;
        const shopJson: ShopQueryResponse = adminOk ? await shopResp.json() : null;
        details.shopQuery = { ok: adminOk, data: !!shopJson?.data };
      } catch (_e) {
        details.shopQuery = { ok: false, error: String(_e) };
      }
      try {
        const { admin } = await unauthenticated.admin(shop as string);
        // Minimal orders query to infer read_orders
        const ordersResp = await admin.graphql(`#graphql
          query { orders(first: 1) { edges { node { id } } } }
        `);
        const j: GraphQLResponse = await ordersResp.json();
        hasReadOrders = !!j?.data || ordersResp.status !== 403; // 403 often indicates missing scope; presence of data implies scope
        details.ordersProbe = { status: ordersResp.status, hasData: !!j?.data, errors: j?.errors };
      } catch (_e) {
        details.ordersProbe = { error: String(_e) };
      }
      try {
        const { admin } = await unauthenticated.admin(shop as string);
        const productsResp = await admin.graphql(`#graphql
          query { products(first: 1) { edges { node { id } } } }
        `);
        const j: GraphQLResponse = await productsResp.json();
        hasReadProducts = !!j?.data || productsResp.status !== 403;
        details.productsProbe = { status: productsResp.status, hasData: !!j?.data, errors: j?.errors };
      } catch (_e) {
        details.productsProbe = { error: String(_e) };
      }

      return json({ ok: true, proxyAuth: true, shop, adminOk, scopes: { read_orders: hasReadOrders, read_products: hasReadProducts }, details }, { headers: hdrs });
    } catch (_e) {
      return json({ ok: false, proxyAuth: false, reason: 'invalid_signature' }, { status: 401, headers: hdrs });
    }
  }

  // GET /apps/proxy/api/recommendations
  // Conservative AOV-focused recs with advanced settings: manual/hybrid, threshold-aware, OOS + price guardrails
  if (path.includes('/api/recommendations')) {
    let allowedOrigin: string | null = null;
    try {
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;
      if (!shop) return json({ error: 'Unauthorized' }, { status: 401 });
      const shopStr = shop as string;

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
        manualList = (s.manualRecommendationProducts || '').split(',').map((v)=>v.trim()).filter(Boolean);

        // 🧠 ML Settings (will be accessed in ML logic below)
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
        const cacheKey = `shop:${shopStr}|pid:${productId||''}|cart:${cartParam}|limit:${limit}|subtotal:${subtotal ?? ''}|thr:${enableThresholdBasedSuggestions?'1':'0'}`;
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
    const { admin } = await unauthenticated.admin(shopStr);

  const normalizeIdsToProducts = async (ids: string[]): Promise<ProductWithMeta[]> => {
          if (!ids.length) return [];
          // Fetch nodes for all ids, support both Product and Variant IDs
          const nodeResp = await admin.graphql(`#graphql
            query N($ids: [ID!]!) { nodes(ids: $ids) {
              ... on Product { id title handle vendor status media(first:1){edges{node{... on MediaImage{image{url}}}}} variants(first:1){edges{node{id price availableForSale}}} }
              ... on ProductVariant { id price availableForSale product { id title handle vendor media(first:1){edges{node{... on MediaImage{image{url}}}}} } }
            } }
          `, { variables: { ids } });
          if (!nodeResp.ok) return [];
          const j: GraphQLResponse = await nodeResp.json();
          const arr: Array<GraphQLProductNode | GraphQLVariantNode | null> = j?.data?.nodes || [];
          const out: ProductWithMeta[] = [];
          for (const n of arr) {
            if (!n) continue;
            if ('title' in n && (n.id && String(n.id).includes('/Product/'))) {
              const v = n.variants?.edges?.[0]?.node;
              const price = parseFloat(v?.price || '0') || 0;
              const inStock = Boolean(v?.availableForSale) || (n.status === 'ACTIVE');
              out.push({ id: (n.id as string).replace('gid://shopify/Product/',''), title: n.title||'', handle: n.handle||'', image: n.media?.edges?.[0]?.node?.image?.url, price, inStock });
            } else if (n.__typename === 'ProductVariant' || (n.id && String(n.id).includes('/ProductVariant/'))) {
              const price = parseFloat(n.price || '0') || 0;
              const inStock = Boolean(n.availableForSale);
              const p = n.product;
              if (p?.id) out.push({ id: (p.id as string).replace('gid://shopify/Product/',''), title: p.title||'', handle: p.handle||'', image: p.media?.edges?.[0]?.node?.image?.url, price, inStock });
            }
          }
          return out;
        };

        let manualResults: Array<{ id:string; title:string; handle:string; image?:string; price:number }> = [];
        if (manualEnabled && manualList.length) {
          const normalized = await normalizeIdsToProducts(manualList);
          const seen = new Set<string>();
          for (const m of normalized) {
            if (!m.inStock) continue;
            if (enableThresholdBasedSuggestions && needAmount > 0 && m.price < needAmount) continue;
            if (seen.has(m.id)) continue;
            // Avoid recommending items already in context
            if (cartParam.split(',').includes(m.id) || (productId && m.id === productId)) continue;
            seen.add(m.id);
            manualResults.push({ id: m.id, title: m.title, handle: m.handle, image: m.image, price: m.price });
            if (manualResults.length >= limit) break;
          }
          if (manualEnabled && manualResults.length >= limit && (thresholdSuggestionMode === 'price' || (thresholdSuggestionMode === 'smart' && enableThresholdBasedSuggestions))) {
            // Early return when manual fully satisfies quota
            const payload = { recommendations: manualResults.slice(0, limit) };
            setRecsCache(cacheKey, payload);
            return json(payload, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=60' } });
          }
          // If mode is strictly manual, return immediately regardless of count
          // We infer strict manual when complementDetectionMode === 'manual' (included via manualEnabled above)
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

        // Fetch recent orders to compute decayed associations/popularity
        const ordersResp = await admin.graphql(`
          #graphql
          query getOrders($first: Int!) {
            orders(first: $first, sortKey: CREATED_AT, reverse: true) {
              edges { node {
                id
                createdAt
                lineItems(first: 30) { edges { node {
                  product { id title handle media(first: 1) { edges { node { ... on MediaImage { image { url } } } } } vendor }
                  variant { id price }
                } } }
              } }
            }
          }
        `, { variables: { first: 200 } });
        if (!ordersResp.ok) {
          return json({ recommendations: [], reason: `admin_http_${ordersResp.status}` }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }
        const ordersData: GraphQLResponse = await ordersResp.json();
        if (ordersData?.errors || !ordersData?.data) {
          return json({ recommendations: [], reason: 'admin_orders_error' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }
        const orderEdges = ordersData?.data?.orders?.edges || [];

        // Build decayed stats
        const LN2_OVER_HL = Math.log(2) / HALF_LIFE_DAYS;
        type Assoc = { co:number; wco:number; rev:number; wrev:number; aov:number };
        type ProductInfo = { id: string; title: string };
        const assoc: Record<string, { product: ProductInfo; copurchases: Record<string, Assoc>; wAppear:number; price:number; handle:string; vendor?:string; image?:string } > = {};
        const wAppear: Record<string, number> = {};

        const getPid = (gid?: string) => (gid||'').replace('gid://shopify/Product/','');

        for (const e of orderEdges) {
          const n = e.node;
          const createdAt = new Date(n.createdAt);
          const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86400000);
          const w = Math.exp(-LN2_OVER_HL * ageDays);
          const items: Array<{pid:string; title:string; handle:string; img?:string; price:number; vendor?:string}> = [];
          for (const ie of (n.lineItems?.edges||[])) {
            const p = ie.node.product; if (!p?.id) continue;
            const pid = getPid(p.id);
            const vprice = parseFloat(ie.node.variant?.price || '0') || 0;
            const img = p.media?.edges?.[0]?.node?.image?.url;
            items.push({ pid, title: p.title, handle: p.handle, img, price: vprice, vendor: p.vendor });
          }
          if (items.length < 2) continue;

          // appearances (decayed)
          const seen = new Set<string>();
          for (const it of items) {
            if (!seen.has(it.pid)) {
              wAppear[it.pid] = (wAppear[it.pid]||0)+w;
              seen.add(it.pid);
              if (!assoc[it.pid]) assoc[it.pid] = { product: { id: it.pid, title: it.title }, copurchases: {}, wAppear: 0, price: it.price, handle: it.handle, vendor: it.vendor, image: it.img };
              assoc[it.pid].wAppear += w;
              assoc[it.pid].price = it.price; assoc[it.pid].handle = it.handle; assoc[it.pid].image = it.img; assoc[it.pid].product.title = it.title; assoc[it.pid].vendor = it.vendor;
            }
          }

          // pairs
          for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++) {
            const a = items[i], b = items[j];
            if (!assoc[a.pid]) assoc[a.pid] = { product:{id:a.pid,title:a.title}, copurchases:{}, wAppear:0, price:a.price, handle:a.handle, vendor:a.vendor, image:a.img };
            if (!assoc[b.pid]) assoc[b.pid] = { product:{id:b.pid,title:b.title}, copurchases:{}, wAppear:0, price:b.price, handle:b.handle, vendor:b.vendor, image:b.img };
            if (!assoc[a.pid].copurchases[b.pid]) assoc[a.pid].copurchases[b.pid] = { co:0,wco:0,rev:0,wrev:0,aov:0 };
            if (!assoc[b.pid].copurchases[a.pid]) assoc[b.pid].copurchases[a.pid] = { co:0,wco:0,rev:0,wrev:0,aov:0 };
            assoc[a.pid].copurchases[b.pid].co++; assoc[a.pid].copurchases[b.pid].wco+=w;
            assoc[b.pid].copurchases[a.pid].co++; assoc[b.pid].copurchases[a.pid].wco+=w;
          }
        }

        // Build candidate scores across anchors
        const anchorIds = Array.from(anchors);
        const candidate: Record<string, { score:number; lift:number; pop:number; handle?:string; vendor?:string } > = {};
        const totalW = Object.values(wAppear).reduce((a,b)=>a+b,0) || 1;
        const liftCap = 2.0; // cap to avoid niche explosions

        // compute median anchor price (from assoc if available)
        const anchorPrices = anchorIds.map(id => assoc[id]?.price).filter(v => typeof v === 'number' && !isNaN(v)) as number[];
        anchorPrices.sort((a,b)=>a-b);
        const anchorMedian = anchorPrices.length ? anchorPrices[Math.floor(anchorPrices.length/2)] : undefined;

        for (const a of anchorIds) {
          const aStats = assoc[a];
          const wA = aStats?.wAppear || 0;
          if (!aStats || wA <= 0) continue;
          for (const [b, ab] of Object.entries(aStats.copurchases)) {
            if (anchors.has(b)) continue; // don’t recommend items already in context
            const wB = assoc[b]?.wAppear || 0;
            if (wB <= 0) continue;
            const confidence = ab.wco / Math.max(1e-6, wA);
            const probB = wB / totalW;
            const lift = probB > 0 ? confidence / probB : 0;
            const liftNorm = Math.min(liftCap, lift) / liftCap; // [0..1]
            const popNorm = Math.min(1, wB / (totalW * 0.05)); // normalize: top 5% mass ~1
            const sc = 0.6 * liftNorm + 0.4 * popNorm;
            if (!candidate[b] || sc > candidate[b].score) {
              candidate[b] = { score: sc, lift, pop: wB/totalW, handle: assoc[b]?.handle, vendor: assoc[b]?.vendor };
            }
          }
        }

        // OOS filter via Admin API for small top set
        const topIds = Object.entries(candidate)
          .sort((a,b)=>b[1].score - a[1].score)
          .slice(0, 24)
          .map(([id])=>id);

        if (topIds.length === 0) {
          return json({ recommendations: manualResults.slice(0, limit) }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
        }

        // Fetch inventory/availability and price data for candidates
        const prodGids = topIds.map(id => `gid://shopify/Product/${id}`);
        const invResp = await admin.graphql(`
          #graphql
          query inv($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product { id title handle vendor status totalInventory availableForSale variants(first: 10) { edges { node { id availableForSale price } } } media(first:1){edges{node{... on MediaImage { image { url } }}}} }
            }
          }
        `, { variables: { ids: prodGids } });
        if (!invResp.ok) {
          return json({ recommendations: manualResults.slice(0, limit), reason: `admin_http_${invResp.status}` }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }
        const invData: GraphQLResponse = await invResp.json();
        if (invData?.errors || !invData?.data) {
          return json({ recommendations: manualResults.slice(0, limit), reason: 'admin_inventory_error' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
        }
        const nodes: Array<GraphQLProductNode | GraphQLVariantNode | null> = invData?.data?.nodes || [];
        const availability: Record<string, { inStock:boolean; price:number; title:string; handle:string; img?:string; vendor?:string } > = {};
        for (const n of nodes) {
          if (!n?.id) continue;
          const id = (n.id as string).replace('gid://shopify/Product/','');
          const variants = ('variants' in n && n.variants) ? n.variants.edges || [] : [];
          const inStock = ('availableForSale' in n && Boolean(n.availableForSale)) || variants.some((v)=>v?.node?.availableForSale);
          const price = variants.length ? parseFloat(variants[0].node?.price||'0')||0 : (assoc[id]?.price||0);
          const title = ('title' in n) ? n.title : '';
          const handle = ('handle' in n) ? n.handle : '';
          const media = ('media' in n) ? n.media : undefined;
          const vendor = ('vendor' in n) ? n.vendor : undefined;
          availability[id] = { inStock, price, title, handle, img: media?.edges?.[0]?.node?.image?.url, vendor };
        }

        // Final ranking with guardrails (price-gap + diversity)
        const results: Array<{ id:string; title:string; handle:string; image?:string; price:number } > = [];
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
                where: { shop: shopStr, createdAt: { gte: since }, productId: { in: candIds } },
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

        }

        const BASELINE_CTR = 0.05; // 5%
        const CTR_WEIGHT = 0.35;
        const scored = Object.entries(candidate).map(([bid, meta]) => {
          const ctr = ctrById[bid] ?? BASELINE_CTR;
          const mult = Math.max(0.85, Math.min(1.25, 1 + CTR_WEIGHT * (ctr - BASELINE_CTR)));
          return [bid, { ...meta, score: meta.score * mult } ] as [string, typeof meta];
        }).sort((a,b)=>b[1].score - a[1].score);

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
          results.push({ id: bid, title: info.title || assoc[bid]?.product?.title || '', handle: info.handle || assoc[bid]?.handle || '', image: info.img || assoc[bid]?.image, price: info.price });
        }

        // Combine manual and algorithmic with de-duplication
        const combined: Array<{ id:string; title:string; handle:string; image?:string; price:number }> = [];
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
          combined.sort((a,b)=> (a.price - needAmount) - (b.price - needAmount));
        }

        // ---------- A/B Testing Integration ----------
        let abTestVariant: string | null = null;
        let abTestConfig: Record<string, unknown> = {};

        // Check for active A/B experiments
        try {
          const userId = url.searchParams.get('session_id') || url.searchParams.get('customer_id') || 'anonymous';
          const abResponse = await fetch(`${url.origin}/apps/proxy/api/ab-testing?action=get_active_experiments`, {
            headers: { 'X-Shopify-Shop-Domain': shopStr }
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
              const variantResponse = await fetch(`${url.origin}/apps/proxy/api/ab-testing?action=get_variant&experiment_id=${recommendationExperiment.id}&user_id=${userId}`, {
                headers: { 'X-Shopify-Shop-Domain': shopStr }
              });
              
              if (variantResponse.ok) {
                const variantData = await variantResponse.json() as { variant?: string; config?: Record<string, unknown> };
                abTestVariant = variantData.variant || null;
                abTestConfig = variantData.config || {};
              }
            }
          }
        } catch (abError) {

        }

        // ---------- ML Enhancement & Real Data Tracking ----------
        let finalRecommendations = combined;
        let dataMetrics = {
          orderCount: orderEdges.length,
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
            effectiveMlEnabled = abTestConfig.mlEnabled;
          }
          if (abTestConfig.personalizationMode) {
            effectivePersonalizationMode = abTestConfig.personalizationMode;
          }
        }

        // ---------- ENHANCED ML INTEGRATION ----------
        if (effectiveMlEnabled && orderEdges.length > 0) {
          try {
            const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sid') || 'anonymous';
            const customerId = url.searchParams.get('customer_id') || url.searchParams.get('cid') || undefined;
            
            // Determine if we have enough data for advanced ML
            const hasRichData = orderEdges.length >= 100;
            const hasGoodData = orderEdges.length >= 50;
            
            // Update data quality metric
            if (orderEdges.length >= 500) {
              dataMetrics.dataQuality = 'rich';
            } else if (orderEdges.length >= 200) {
              dataMetrics.dataQuality = 'good';
            } else if (orderEdges.length >= 50) {
              dataMetrics.dataQuality = 'growing';
            } else {
              dataMetrics.dataQuality = 'new_store';
            }
            
            // 🆕 COLD START HANDLING - Enhanced recommendations for new stores
            if (orderEdges.length < 50) {
              try {
                // Strategy 1: Use Shopify's recommendation API
                const shopifyRecsPromise = admin.graphql(`
                  query getRecommendations($productIds: [ID!]!) {
                    productRecommendations(productId: $productIds) {
                      id
                      title
                      handle
                      priceRangeV2 {
                        minVariantPrice {
                          amount
                          currencyCode
                        }
                      }
                      images(first: 1) {
                        edges {
                          node {
                            url
                          }
                        }
                      }
                    }
                  }
                `, {
                  variables: {
                    productIds: Array.from(anchors).slice(0, 1) // Use first anchor
                  }
                }).then(r => r.json()).catch(() => null);
                
                // Strategy 2: Get trending products (highest selling in catalog)
                const trendingPromise = admin.graphql(`
                  query getTrending {
                    products(first: 10, sortKey: BEST_SELLING) {
                      edges {
                        node {
                          id
                          title
                          handle
                          priceRangeV2 {
                            minVariantPrice {
                              amount
                              currencyCode
                            }
                          }
                          images(first: 1) {
                            edges {
                              node {
                                url
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                `).then(r => r.json()).catch(() => null);
                
                const [shopifyRecsData, trendingData] = await Promise.all([shopifyRecsPromise, trendingPromise]);
                
                const coldStartRecs: Array<{ id: string, title: string, price: number, handle: string, image?: string }> = [];
                
                // Add Shopify recommendations
                if (shopifyRecsData?.data?.productRecommendations) {
                  for (const prod of shopifyRecsData.data.productRecommendations) {
                    coldStartRecs.push({
                      id: prod.id.split('/').pop()!,
                      title: prod.title,
                      price: parseFloat(prod.priceRangeV2?.minVariantPrice?.amount || '0'),
                      handle: prod.handle,
                      image: prod.images?.edges?.[0]?.node?.url
                    });
                  }
                }

                // Add trending products
                if (trendingData?.data?.products?.edges) {
                  for (const edge of trendingData.data.products.edges) {
                    const prod = edge.node;
                    const prodId = prod.id.split('/').pop()!;
                    
                    // Don't add if already in list or in cart
                    if (!coldStartRecs.find(r => r.id === prodId) && !anchors.has(prodId)) {
                      coldStartRecs.push({
                        id: prodId,
                        title: prod.title,
                        price: parseFloat(prod.priceRangeV2?.minVariantPrice?.amount || '0'),
                        handle: prod.handle,
                        image: prod.images?.edges?.[0]?.node?.url
                      });
                    }
                  }
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
                const mlProducts = await normalizeIdsToProducts(mlProductIds);
                
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
                const popularProducts = await normalizeIdsToProducts(popularIds);
                
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
                  const mlProducts = await normalizeIdsToProducts(mlIds);
                  
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
                const productAppearances = orderEdges.filter(order =>
                  order.node?.lineItems?.edges?.some((li) =>
                    li.node?.product?.id?.includes(rec.id)
                  )
                ).length;
                
                const popularityScore = productAppearances / Math.max(1, orderEdges.length);
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
                      shop: shopStr,
                      event: 'ml_recommendation_served',
                      productId: Array.from(anchors)[0] || '',
                      sessionId: sessionId,
                      customerId: mlPrivacyLevel === 'advanced' ? customerId : null,
                      source: 'cart_drawer',
                      metadata: JSON.stringify({
                        anchors: Array.from(anchors),
                        recommendationCount: finalRecommendations.length,
                        recommendationIds: finalRecommendations.map(r => r.id), // 🎯 KEY: For purchase attribution
                        dataQuality: dataMetrics.dataQuality,
                        mlMode: effectivePersonalizationMode,
                        orderDataPoints: orderEdges.length,
                        privacyLevel: mlPrivacyLevel
                      }),
                      createdAt: new Date()
                    }
                  }).catch(() => {});
                }
              } catch (trackingError) {

              }
            }

          } catch (mlError) {

            // Graceful degradation - keep original recommendations
          }
        }

        // 🎯 APPLY DAILY LEARNING - Filter bad products, boost good ones
        try {
          const candidateIds = finalRecommendations.map(r => r.id);
          
          if (candidateIds.length > 0) {
            const performance = await db.mLProductPerformance?.findMany({
              where: {
                shop: shopStr,
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
      // 🛡️ ULTIMATE FALLBACK - Never return empty, always show something
      try {
        // Get admin for emergency query
        const { session } = await authenticate.public.appProxy(request);
        const shop = session?.shop;
        if (!shop) {
          return json({ recommendations: [], fallback: 'none', reason: 'no_shop_session' }, {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'no-cache' }
          });
        }
        
        const { admin: emergencyAdmin } = await unauthenticated.admin(shop as string);
        const emergencyLimit = parseInt(url.searchParams.get('limit') || '6', 10);
        
        // Last resort: Get random products from catalog
        const emergencyQuery = `
          query getEmergencyProducts {
            products(first: 10, query: "published_status:published") {
              edges {
                node {
                  id
                  title
                  handle
                  priceRangeV2 {
                    minVariantPrice {
                      amount
                    }
                  }
                  images(first: 1) {
                    edges {
                      node {
                        url
                      }
                    }
                  }
                }
              }
            }
          }
        `;
        
        const emergencyResponse = await emergencyAdmin.graphql(emergencyQuery);
        const emergencyData = await emergencyResponse.json();
        
        if (emergencyData?.data?.products?.edges) {
          const emergencyRecs = (emergencyData.data.products.edges as GraphQLProductEdge[])
            .slice(0, emergencyLimit)
            .map((edge) => ({
              id: edge.node.id.split('/').pop() || '',
              title: edge.node.title,
              handle: edge.node.handle,
              price: parseFloat((edge.node as unknown as { priceRangeV2?: { minVariantPrice?: { amount: string } } }).priceRangeV2?.minVariantPrice?.amount || '0'),
              image: (edge.node as unknown as { images?: { edges?: Array<{ node?: { url?: string } }> } }).images?.edges?.[0]?.node?.url
            }));

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
      } catch (fallbackError) {

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
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = shop ? await validateCorsOrigin(origin, shop as string) : null;

      if (!shop) return json({ products: [], error: 'Unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });

      const shopStr = shop as string;
      const shopCurrency = await getShopCurrency(shopStr);

      const q = url.searchParams.get('query') || '';
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

      const { admin } = await unauthenticated.admin(shopStr);
      const resp = await admin.graphql(`#graphql
        query getProducts($first: Int!, $query: String) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                handle
                status
                featuredMedia { preview { image { url altText } } }
                priceRangeV2 { minVariantPrice { amount currencyCode } }
                variants(first: 10) {
                  edges { node { id title price availableForSale } }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      `, { variables: { first: limit, query: q ? `title:*${q}* OR vendor:*${q}* OR tag:*${q}*` : '' } });

      if (!resp.ok) {
        const text = await resp.text();
        return json({ products: [], error: `HTTP ${resp.status}` }, { status: 502, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
      }
      const data: GraphQLResponse = await resp.json();
      if (!data?.data) {
        return json({ products: [], error: 'GraphQL error' }, { status: 502, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
      }

      const products = (data.data.products?.edges || []).map((edge) => {
        const n = edge.node;
        const variants = (n.variants?.edges || []).map((ve) => ({
          id: ve.node.id,
          title: ve.node.title,
          price: typeof ve.node.price === 'number' ? ve.node.price : parseFloat(ve.node.price ?? '0') || 0,
          availableForSale: ve.node.availableForSale,
        }));
        const minPriceAmount = n.priceRangeV2?.minVariantPrice?.amount;
        const currency = n.priceRangeV2?.minVariantPrice?.currencyCode || shopCurrency.code;
        const minPrice = typeof minPriceAmount === 'number' ? minPriceAmount : parseFloat(minPriceAmount ?? '0') || (variants[0]?.price ?? 0);
        return {
          id: n.id,
          title: n.title,
          handle: n.handle,
          status: n.status,
          image: n.featuredMedia?.preview?.image?.url || null,
          imageAlt: n.featuredMedia?.preview?.image?.altText || n.title,
          minPrice,
          currency,
          price: minPrice,
          variants,
        };
      });

      return json({ 
        products, 
        hasNextPage: Boolean(data.data.products.pageInfo?.hasNextPage),
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
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      allowedOrigin = shop ? await validateCorsOrigin(origin, shop as string) : null;

      if (!shop) {
        return json({ error: 'Unauthorized' }, { status: 401, headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'unauthorized' } });
      }
      const shopStr = shop as string;

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
  } catch(_e) {

      }
      
      // 🧠 ML Settings for Bundles
      const bundleMLSettings = settings ? {
        enabled: Boolean(settings.enableMLRecommendations),
        smartBundlesEnabled: Boolean(settings.enableSmartBundles), 
        personalizationMode: String(settings.mlPersonalizationMode || 'basic'),
        privacyLevel: String(settings.mlPrivacyLevel || 'basic'),
        behaviorTracking: Boolean(settings.enableBehaviorTracking)
      } : { enabled: false, smartBundlesEnabled: false, personalizationMode: 'basic', privacyLevel: 'basic', behaviorTracking: false };

      // Temporarily bypass the setting check for testing
      /*
      if (!settings?.enableSmartBundles) {
        return json({ bundles: [], reason: 'disabled' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin' } });
      }
      */
      if (
        context === 'product' &&
        settings &&
        Object.prototype.hasOwnProperty.call(settings, 'bundlesOnProductPages') &&
        settings.bundlesOnProductPages === false
      ) {
        return json({ bundles: [], reason: 'disabled_page' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin, X-Bundles-Gated', 'X-Bundles-Gated': '1', 'X-Bundles-Reason': 'disabled_page', 'X-Bundles-Context': context } });
      }

      // Relaxed gating: only gate if settings are loaded AND bundlesOnProductPages is explicitly false.
      // If settings fail to load, proceed with defaults.
      if (context === 'product' && settings?.bundlesOnProductPages === false) {
        return json({ bundles: [], reason: 'disabled_page' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin, X-Bundles-Gated', 'X-Bundles-Gated': '1', 'X-Bundles-Reason': 'disabled_page', 'X-Bundles-Context': context } });
      }

      if (context !== 'product' || !productIdParam) {
        return json({ bundles: [], reason: 'invalid_params' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'invalid_params', 'X-Bundles-Context': String(context) } });
      }

      // Resolve product id: accept numeric id; if not numeric, try as handle via Admin API
  let productId = String(productIdParam);
      if (!/^[0-9]+$/.test(productId)) {
        try {
          const { admin } = await unauthenticated.admin(shopStr);
          const byHandleResp = await admin.graphql(`#graphql
            query($handle: String!) { productByIdentifier(identifier: { handle: $handle }) { id } }
          `, { variables: { handle: productId } });
          if (byHandleResp.ok) {
            const data: { data?: { productByIdentifier?: { id: string } } } = await byHandleResp.json();
            const gid: string | undefined = data?.data?.productByIdentifier?.id;
            if (gid) productId = gid.replace('gid://shopify/Product/','');
          }
        } catch(_) { /* ignore */ }
      } else {
        // If numeric, it could be a Variant ID; try resolving to Product ID
        try {
          const { admin } = await unauthenticated.admin(shopStr);
          const nodeResp = await admin.graphql(`#graphql
            query($id: ID!) { node(id: $id) { __typename ... on ProductVariant { product { id } } ... on Product { id } } }
          `, { variables: { id: `gid://shopify/ProductVariant/${productId}` } });
          if (nodeResp.ok) {
            const data: { data?: { node?: { __typename?: string; product?: { id: string }; id?: string } } } = await nodeResp.json();
            const n = data?.data?.node;
            if (n?.__typename === 'ProductVariant' && n?.product?.id) {
              productId = String(n.product.id).replace('gid://shopify/Product/','');
            } else if (n?.__typename === 'Product' && n?.id) {
              productId = String(n.id).replace('gid://shopify/Product/','');
            }
          }
        } catch(_) { /* ignore; fall back to provided id */ }
      }

      // Guard: unresolved or invalid product id
      if (!productId || !/^[0-9]+$/.test(productId)) {
        return json({ bundles: [], reason: 'invalid_product' }, { headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'X-Bundles-Reason': 'invalid_product', 'X-Bundles-Context': context } });
      }

      // Fetch real products from the store to use in bundles
  const { admin } = await unauthenticated.admin(shopStr);
      
      // Get the current product details
  let currentProduct: GraphQLProductNode | null = null;
      try {
    const currentProductResp = await admin.graphql(`#graphql
          query($id: ID!) { 
            product(id: $id) { 
              id 
              title 
              handle
      variants(first: 250) { 
                edges { 
                  node { 
                    id 
                    title
                    price 
                    compareAtPrice
        availableForSale
                    selectedOptions { name value }
                  } 
                } 
              }
              media(first: 1) {
                edges {
                  node {
                    ... on MediaImage {
                      image {
                        url
                      }
                    }
                  }
                }
              }
            } 
          }
        `, { variables: { id: `gid://shopify/Product/${productId}` } });
        
        if (currentProductResp.ok) {
          const data = await currentProductResp.json();
          currentProduct = data?.data?.product;
        }
  } catch (_e) {

      }
      
      // Get other products from the store
      let otherProducts = [];
      try {
    const productsResp = await admin.graphql(`#graphql
          query {
            products(first: 50, query: "status:active") {
              edges {
                node {
                  id
                  title
                  handle
      variants(first: 250) {
                    edges {
                      node {
                        id
                        title
                        price
                        compareAtPrice
        availableForSale
                        selectedOptions { name value }
                      }
                    }
                  }
                  media(first: 1) {
                    edges {
                      node {
                        ... on MediaImage {
                          image {
                            url
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `);
        
        if (productsResp.ok) {
          const data: GraphQLResponse = await productsResp.json();
          otherProducts = data?.data?.products?.edges?.map((edge) => edge.node) || [];
        }
  } catch (_e) {

      }

      // Create bundles using context-aware recommendations
      const bundles: unknown[] = [];

      // Load AI bundle configuration for discount settings
      // Apply config discount to ALL AI-generated bundles (simplified approach)
      type AiBundleSelect = {
        id: string;
        name: string;
        discountType: string;
        discountValue: number;
      };
      let aiBundleConfig: AiBundleSelect | null = null;
      try {
        // Get AI bundle configuration - applies to all AI-generated bundles
        aiBundleConfig = await db.bundle.findFirst({
          where: {
            shop: shopStr,
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
        // Helper function to normalize product with first available variant
        const getProductDetails = (product: GraphQLProductNode) => {
          const variantEdges = Array.isArray(product?.variants?.edges) ? product.variants.edges : [];
          const firstAvailable = variantEdges.find((e)=>e?.node?.availableForSale)?.node || variantEdges[0]?.node;
          const firstVariant = firstAvailable;

          // Ensure we have a valid variant
          if (!firstVariant?.id) {
            return null;
          }

          const opts = Array.isArray(firstVariant?.selectedOptions)
            ? firstVariant.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
            : [];
          // Convert price to cents for consistency with manual bundles
          const priceInCents = Math.round(parseFloat(firstVariant?.price || '0') *    100);

          // Map all variants for frontend variant selector
          const allVariants = variantEdges.map((edge) => {
            const v = edge?.node;
            if (!v?.id) return null;
            return {
              id: String(v.id).replace('gid://shopify/ProductVariant/', ''),
              title: v.title,
              price: Math.round(parseFloat(v.price || '0') * 100),
              compareAtPrice: v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice) * 100) : undefined,
              availableForSale: v.availableForSale,
              selectedOptions: Array.isArray(v.selectedOptions)
                ? v.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
                : []
            };
          }).filter((v) => v !== null);
          
          return {
            id: String(product.id).replace('gid://shopify/Product/', ''),
            variant_id: String(firstVariant.id).replace('gid://shopify/ProductVariant/', ''),
            variant_title: firstVariant?.title,
            options: opts,
            title: product.title,
            handle: product.handle || String(product.id).replace('gid://shopify/Product/', ''),
            price: priceInCents,
            image: product.media?.edges?.[0]?.node?.image?.url || undefined,
            variants: allVariants
          };
        };

  const currentProd = getProductDetails(currentProduct);
        
        // Skip bundle creation if current product doesn't have valid variants
        if (!currentProd) {
          return json({ bundles: [], reason: 'no_variants' }, {
            headers: { 'Access-Control-Allow-Origin': allowedOrigin || '*', 'Vary': 'Origin', 'Cache-Control': 'public, max-age=30' }
          });
  }

        // Compute related products from recent orders (focused on this anchor)
  const { admin } = await unauthenticated.admin(shopStr);
        const ordersResp = await admin.graphql(`
          #graphql
          query getOrders($first: Int!) {
            orders(first: $first, sortKey: CREATED_AT, reverse: true) {
              edges { node {
                id
                createdAt
                lineItems(first: 30) { edges { node {
                  product { id title handle media(first: 1) { edges { node { ... on MediaImage { image { url } } } } } vendor }
                  variant { id price }
                } } }
              } }
            }
          }
        `, { variables: { first: 200 } });
        let relatedIds: string[] = [];
        let debugInfo: { method: string; anchor: string; orderCount: number; assocCount: number } = { method: 'none', anchor: String(productId), orderCount: 0, assocCount: 0 };
        try {
          const ok = ordersResp.ok;
          const ordersData: GraphQLResponse | null = ok ? await ordersResp.json() : null;
          const orderEdges = ordersData?.data?.orders?.edges || [];
          debugInfo.orderCount = orderEdges.length;
          const getPid = (gid?: string) => (gid||'').replace('gid://shopify/Product/','');
          // Decay setup similar to recommendations endpoint
          const HALF_LIFE_DAYS = 60;
          const LN2_OVER_HL = Math.log(2) / HALF_LIFE_DAYS;
          const wAppear: Record<string, number> = {};

          interface AssociationData {
            copurchases: Record<string, { wco: number }>;
            wAppear: number;
          }
          const assoc: Record<string, AssociationData> = {};
          for (const e of orderEdges) {
            const n = e.node;
            const createdAt = new Date(n.createdAt);
            const ageDays = Math.max(0, (Date.now() - createdAt.getTime()) / 86400000);
            const w = Math.exp(-LN2_OVER_HL * ageDays);
            const items: Array<{pid:string}> = [];
            for (const ie of (n.lineItems?.edges||[])) {
              const p = ie.node.product; if (!p?.id) continue;
              const pid = getPid(p.id);
              items.push({ pid });
            }
            if (items.length < 2) continue;
            const seen = new Set<string>();
            for (const it of items) { if (!seen.has(it.pid)) { wAppear[it.pid] = (wAppear[it.pid]||0)+w; seen.add(it.pid); } }
            for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++) {
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
          const totalW = Object.values(wAppear).reduce((a,b)=>a+b,0) || 1;
          if (aStats) {
            for (const [b, ab] of Object.entries(aStats.copurchases)) {
              if (b === anchor) continue;
              const wB = wAppear[b] || 0; if (wB <= 0) continue;
              const confidence = ab.wco / Math.max(1e-6, aStats.wAppear || 1);
              const probB = wB / totalW;
              const lift = probB > 0 ? confidence / probB : 0;
              // score blend
              const liftCap = 2.0; const liftNorm = Math.min(liftCap, lift) / liftCap;
              const popNorm = Math.min(1, wB / (totalW * 0.05));
              cand[b] = Math.max(cand[b]||0, 0.6*liftNorm + 0.4*popNorm);
            }
            debugInfo.method = 'orders';
          }
          relatedIds = Object.entries(cand).sort((a,b)=>b[1]-a[1]).slice(0, 4).map(([id])=>id);
        } catch {
          relatedIds = [];
        }

        // Fallback: vendor-based or catalog-based when orders are insufficient
        if (relatedIds.length === 0 && otherProducts.length > 0) {
          const curVendor = currentProduct?.vendor;
          const byVendor = curVendor ? otherProducts.filter((p)=>'vendor' in p && p.vendor === curVendor) : [];
          const candidates = (byVendor.length ? byVendor : otherProducts)
            .filter((p)=>String(p.id).replace('gid://shopify/Product/','') !== String(productId));
          // Shuffle and take up to 4
          const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
          relatedIds = shuffled.map((p)=>String(p.id).replace('gid://shopify/Product/','')).slice(0, 4);
          debugInfo.method = byVendor.length ? 'vendor' : 'catalog';
        }

        // Fetch details for related products
        let relatedProducts: GraphQLProductNode[] = [];
        if (relatedIds.length) {
          const prodGids = relatedIds.map(id => `gid://shopify/Product/${id}`);
          const nodesResp = await admin.graphql(`
            #graphql
            query rel($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title handle variants(first: 250) { edges { node { id title price compareAtPrice availableForSale selectedOptions { name value } } } } media(first:1){edges{node{... on MediaImage { image { url } }}}} } } }
          `, { variables: { ids: prodGids } });
          if (nodesResp.ok) {
            const nodesData: GraphQLResponse = await nodesResp.json();
            relatedProducts = (nodesData?.data?.nodes?.filter((n): n is GraphQLProductNode => !!n && 'title' in n) || []) as GraphQLProductNode[];
          }
        }

        // Choose top 2 complements, exclude subscription/selling-plan only products heuristically
        let filteredRelated = relatedProducts.filter((p)=>{
          const t = (p?.title||'').toLowerCase();
          const h = (p?.handle||'').toLowerCase();
          if (t.includes('selling plan') || h.includes('selling-plan') || t.includes('subscription')) return false;
          const vEdges = Array.isArray(p?.variants?.edges) ? p.variants.edges : [];
          // keep if any variant is available for sale
          return vEdges.some((e)=>e?.node?.availableForSale);
        });
        // If filtering removed everything, relax to any product with at least one variant
        if (filteredRelated.length === 0) {
          filteredRelated = relatedProducts.filter((p)=>Array.isArray(p?.variants?.edges) && p.variants.edges.length > 0);
        }
        // ensure unique products by id
        const uniq: GraphQLProductNode[] = [];
  const used = new Set<string>([String(currentProduct.id)]);
        for (const rp of filteredRelated) {
          const id = String(rp.id).replace('gid://shopify/Product/','');
          if (used.has(id)) continue; used.add(id); uniq.push(rp);
          if (uniq.length >= 2) break;
        }
        let complementProducts: (GraphQLProductNode | ReturnType<typeof getProductDetails>)[] = uniq;
        // Second-tier fallback: build complements from other active products
        if (complementProducts.length === 0 && otherProducts.length) {
          const candidates = otherProducts.filter((p)=>String(p.id).replace('gid://shopify/Product/','') !== String(currentProduct.id));
          const mapped = candidates.map(getProductDetails).filter((p): p is NonNullable<typeof p> => p !== null && typeof p.price === 'number' && p.price >= 0);
          complementProducts = mapped.slice(0, 2);
        }
        const bundleProducts = [ currentProd, ...complementProducts.map(getProductDetails) ].filter(p => p !== null);
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
          
          // Since prices are now in cents, keep calculation in cents (no toFixed needed)
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
            savings_amount: regularTotal - bundlePrice, // Keep in cents for consistency
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
            shop: shopStr,
            status: 'active',
            type: 'manual', // Only manual bundles
            OR: [
              { assignmentType: 'all' }, // Show on all product pages
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });
        
        const aiBundles = await db.bundle.findMany({
          where: {
            shop: shopStr,
            status: 'active',
            type: 'ml', // ML bundles (was 'ai', now 'ml' to match creation)
            OR: [
              { assignmentType: 'all' }, // Show on all product pages
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });
        
        const collectionBundles = await db.bundle.findMany({
          where: {
            shop: shopStr,
            status: 'active',
            type: 'collection', // Collection-based bundles
            OR: [
              { assignmentType: 'all' }, // Show on all product pages
              { assignedProducts: { contains: productId } },
              { productIds: { contains: productId } }
            ]
          }
        });

        // Priority 1: Return manual bundles if they exist
        if (manualBundles.length > 0) {
          const formattedManualBundles = await Promise.all(manualBundles.map(async (bundle) => {
            // Parse productIds from JSON string
            let productIds: string[] = [];
            try {
              productIds = JSON.parse(bundle.productIds || '[]');
            } catch (e) {

            }
            
            // Fetch product details for bundle
            const bundleProductDetails = await Promise.all(productIds.map(async (pid) => {
              try {
                const prodResp = await admin.graphql(`#graphql
                  query($id: ID!) { 
                    product(id: $id) { 
                      id title handle
                      variants(first: 250) { 
                        edges { 
                          node { 
                            id 
                            title 
                            price 
                            compareAtPrice 
                            availableForSale 
                            selectedOptions { name value }
                          } 
                        } 
                      }
                      media(first: 1) { edges { node { ... on MediaImage { image { url } } } } }
                    } 
                  }
                `, { variables: { id: `gid://shopify/Product/${pid}` } });
                
                if (prodResp.ok) {
                  const data: { data?: { product?: GraphQLProductNode } } = await prodResp.json();
                  const product = data?.data?.product;
                  const variantEdges = product?.variants?.edges || [];
                  const firstVariant = variantEdges[0]?.node;

                  if (product && firstVariant) {
                    const priceInCents = Math.round(parseFloat(firstVariant.price || '0') * 100);
                    const comparePriceInCents = firstVariant.compareAtPrice ? Math.round(parseFloat(firstVariant.compareAtPrice) * 100) : undefined;

                    const allVariants = variantEdges.map((edge) => {
                      const v = edge?.node;
                      if (!v?.id) return null;
                      return {
                        id: String(v.id).replace('gid://shopify/ProductVariant/', ''),
                        title: v.title,
                        price: Math.round(parseFloat(v.price || '0') * 100),
                        compareAtPrice: v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice) * 100) : undefined,
                        availableForSale: v.availableForSale,
                        selectedOptions: Array.isArray(v.selectedOptions)
                          ? v.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
                          : []
                      };
                    }).filter((v): v is NonNullable<typeof v> => v !== null);
                    
                    return {
                      id: pid,
                      variant_id: String(firstVariant.id).replace('gid://shopify/ProductVariant/', ''),
                      title: product.title,
                      handle: product.handle,
                      price: priceInCents,
                      comparePrice: comparePriceInCents,
                      image: product.media?.edges?.[0]?.node?.image?.url,
                      variants: allVariants
                    };
                  }
                }
              } catch (e) {

              }
              return null;
            }));
            
            const validProducts = bundleProductDetails.filter(p => p !== null);
            
            if (validProducts.length === 0) {
              return null;
            }
            
            // ADD CURRENT PRODUCT to the bundle (like ML bundles do)
            // Convert currentProduct to the same format as validProducts
            let currentProductFormatted = null;
            if (currentProduct) {
              const variantEdges = currentProduct?.variants?.edges || [];
              const firstVariant = variantEdges[0]?.node;
              
              if (firstVariant) {
                const priceInCents = Math.round(parseFloat(firstVariant.price || '0') * 100);
                const comparePriceInCents = firstVariant.compareAtPrice ? Math.round(parseFloat(firstVariant.compareAtPrice) * 100) : undefined;
                
                const allVariants = variantEdges.map((edge) => {
                  const v = edge?.node;
                  if (!v?.id) return null;
                  return {
                    id: String(v.id).replace('gid://shopify/ProductVariant/', ''),
                    title: v.title,
                    price: Math.round(parseFloat(v.price || '0') * 100),
                    compareAtPrice: v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice) * 100) : undefined,
                    availableForSale: v.availableForSale,
                    selectedOptions: Array.isArray(v.selectedOptions)
                      ? v.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
                      : []
                  };
                }).filter((v): v is NonNullable<typeof v> => v !== null);
                
                currentProductFormatted = {
                  id: productId,
                  variant_id: String(firstVariant.id).replace('gid://shopify/ProductVariant/', ''),
                  title: currentProduct.title,
                  handle: currentProduct.handle,
                  price: priceInCents,
                  comparePrice: comparePriceInCents,
                  image: currentProduct.media?.edges?.[0]?.node?.image?.url,
                  variants: allVariants
                };
              }
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
              products: allBundleProducts, // Use allBundleProducts instead of validProducts
              regular_total: regularTotal,
              bundle_price: bundlePrice,
              discount_percent: discountPercent,
              savings_amount: regularTotal - bundlePrice,
              selectMinQty: bundle.selectMinQty || 2,
              selectMaxQty: bundle.selectMaxQty || allBundleProducts.length, // Use allBundleProducts length
              status: 'active',
              source: 'manual'
            };
          }));
          
          const validManualBundles = formattedManualBundles.filter(b => b !== null);
          
          if (validManualBundles.length > 0) {
            let currencyCode = 'GBP';
            try {
              const shopResponse = await admin.graphql(`#graphql query { shop { currencyCode } }`);
              const shopData: { data?: { shop?: { currencyCode?: string } } } = await shopResponse.json();
              currencyCode = shopData.data?.shop?.currencyCode || 'GBP';
            } catch (_err) {

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
        
        // Priority 2: Process collection-based bundles (ML constrained to collection)
        if (collectionBundles.length > 0) {
          const formattedCollectionBundles = await Promise.all(collectionBundles.map(async (bundle) => {
            // Parse collectionIds from JSON string
            let collectionIds: string[] = [];
            try {
              collectionIds = JSON.parse(bundle.collectionIds || '[]');
            } catch (e) {

            }

            if (collectionIds.length === 0) {
              return null;
            }

            const collectionId = collectionIds[0]; // Use first (and only) collection
            
            // Fetch products from the collection
            let collectionProducts: GraphQLProductEdge[] = [];
            try {
              const collectionResp = await admin.graphql(`#graphql
                query($id: ID!) {
                  collection(id: $id) {
                    products(first: 50) {
                      edges {
                        node {
                          id
                          title
                          handle
                          variants(first: 1) {
                            edges {
                              node {
                                id
                                price
                                compareAtPrice
                                availableForSale
                              }
                            }
                          }
                          media(first: 1) {
                            edges {
                              node {
                                ... on MediaImage {
                                  image {
                                    url
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              `, { variables: { id: collectionId } });

              const collectionData: { data?: { collection?: { products?: { edges: GraphQLProductEdge[] } } } } = await collectionResp.json();
              collectionProducts = collectionData.data?.collection?.products?.edges || [];
            } catch (e) {

              return null;
            }

            if (collectionProducts.length === 0) {
              return null;
            }

            // Use ML to pick 2 best products from the collection
            // For now, use simple logic: exclude current product, take up to 2 random ones
            const collectionProductIds = collectionProducts
              .map((edge) => String(edge.node.id).replace('gid://shopify/Product/', ''))
              .filter((id) => id !== productId); // Exclude current product

            if (collectionProductIds.length === 0) {
              return null;
            }
            
            // Simple selection: take up to 2 products
            const selectedProductIds = collectionProductIds.slice(0, 2);
            
            // Fetch full details for selected products
            const validProducts = [];
            for (const pid of selectedProductIds) {
              try {
                const prodResp = await admin.graphql(`#graphql
                  query($id: ID!) { 
                    product(id: $id) { 
                      id title handle
                      variants(first: 250) { 
                        edges { 
                          node { 
                            id 
                            title 
                            price 
                            compareAtPrice 
                            availableForSale
                            selectedOptions { name value }
                          } 
                        } 
                      }
                      media(first: 1) { 
                        edges { 
                          node { 
                            ... on MediaImage { 
                              image { url } 
                            } 
                          } 
                        } 
                      }
                    }
                  }
                `, { variables: { id: `gid://shopify/Product/${pid}` } });

                const prodData: { data?: { product?: GraphQLProductNode } } = await prodResp.json();
                const product = prodData.data?.product;
                
                if (product) {
                  const variantEdges = product.variants?.edges || [];
                  const firstVariant = variantEdges[0]?.node;
                  
                  if (firstVariant) {
                    const allVariants = variantEdges.map((edge) => {
                      const v = edge?.node;
                      if (!v?.id) return null;
                      return {
                        id: String(v.id).replace('gid://shopify/ProductVariant/', ''),
                        title: v.title,
                        price: Math.round(parseFloat(v.price || '0') * 100),
                        compareAtPrice: v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice) * 100) : undefined,
                        availableForSale: v.availableForSale,
                        selectedOptions: Array.isArray(v.selectedOptions)
                          ? v.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
                          : []
                      };
                    }).filter((v): v is NonNullable<typeof v> => v !== null);
                    
                    validProducts.push({
                      id: pid,
                      variant_id: String(firstVariant.id).replace('gid://shopify/ProductVariant/', ''),
                      title: product.title,
                      handle: product.handle,
                      price: Math.round(parseFloat(firstVariant.price || '0') * 100),
                      comparePrice: firstVariant.compareAtPrice ? Math.round(parseFloat(firstVariant.compareAtPrice) * 100) : undefined,
                      image: product.media?.edges?.[0]?.node?.image?.url,
                      variants: allVariants
                    });
                  }
                }
              } catch (e) {

              }
            }

            if (validProducts.length === 0) {
              return null;
            }
            
            // Fetch current product details
            let currentProductFormatted: ReturnType<typeof getProductDetails> | null = null;
            try {
              const currentProdResp = await admin.graphql(`#graphql
                query($id: ID!) { 
                  product(id: $id) { 
                    id title handle
                    variants(first: 250) { 
                      edges { 
                        node { 
                          id 
                          title 
                          price 
                          compareAtPrice 
                          availableForSale
                          selectedOptions { name value }
                        } 
                      } 
                    }
                    media(first: 1) { 
                      edges { 
                        node { 
                          ... on MediaImage { 
                            image { url } 
                          } 
                        } 
                      } 
                    }
                  }
                }
              `, { variables: { id: `gid://shopify/Product/${productId}` } });
              
              const currentProdData: { data?: { product?: GraphQLProductNode } } = await currentProdResp.json();
              const currentProduct = currentProdData.data?.product;

              if (currentProduct) {
                const variantEdges = currentProduct.variants?.edges || [];
                const firstVariant = variantEdges[0]?.node;

                if (firstVariant) {
                  const allVariants = variantEdges.map((edge) => {
                    const v = edge?.node;
                    if (!v?.id) return null;
                    return {
                      id: String(v.id).replace('gid://shopify/ProductVariant/', ''),
                      title: v.title,
                      price: Math.round(parseFloat(v.price || '0') * 100),
                      compareAtPrice: v.compareAtPrice ? Math.round(parseFloat(v.compareAtPrice) * 100) : undefined,
                      availableForSale: v.availableForSale,
                      selectedOptions: Array.isArray(v.selectedOptions)
                        ? v.selectedOptions.map((o) => ({ name: o?.name, value: o?.value }))
                        : []
                    };
                  }).filter((v): v is NonNullable<typeof v> => v !== null);
                  
                  currentProductFormatted = {
                    id: productId,
                    variant_id: String(firstVariant.id).replace('gid://shopify/ProductVariant/', ''),
                    title: currentProduct.title,
                    handle: currentProduct.handle,
                    price: Math.round(parseFloat(firstVariant.price || '0') * 100),
                    comparePrice: firstVariant.compareAtPrice ? Math.round(parseFloat(firstVariant.compareAtPrice) * 100) : undefined,
                    image: currentProduct.media?.edges?.[0]?.node?.image?.url,
                    variants: allVariants
                  };
                }
              }
            } catch (e) {

            }

            // Prepend current product to the bundle
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
            let currencyCode = 'GBP';
            try {
              const shopResponse = await admin.graphql(`#graphql query { shop { currencyCode } }`);
              const shopData: { data?: { shop?: { currencyCode?: string } } } = await shopResponse.json();
              currencyCode = shopData.data?.shop?.currencyCode || 'GBP';
            } catch (_err) {

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
            const shopResponse = await admin.graphql(`#graphql query { shop { currencyCode } }`);
            const shopData: { data?: { shop?: { currencyCode?: string } } } = await shopResponse.json();
            currencyCode = shopData.data?.shop?.currencyCode || 'USD';
          } catch (_err) {

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
      // Require a valid App Proxy signature and derive the shop from the verified session
      const { session } = await authenticate.public.appProxy(request);
      const shop = session?.shop;

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = shop ? await validateCorsOrigin(origin, shop as string) : null;

      if (!shop) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      // CRITICAL: Enforce order limit - block ALL functionality if limit reached
      const subscription = await getOrCreateSubscription(shop as string);
      if (subscription.isLimitReached) {
        return json({
          error: 'Order limit reached. Please upgrade your plan to continue using Cart Uplift.',
          limitReached: true,
          orderCount: subscription.orderCount,
          orderLimit: subscription.orderLimit,
          planTier: subscription.planTier,
          hardLimit: subscription.hardLimit,
          upgradeUrl: 'https://apps.shopify.com/cart-uplift'
        }, {
          status: 402, // 402 Payment Required
          headers: corsHeaders,
        });
      }

  const settings = await getSettings(shop as string);
      // Normalize layout to theme values
      // Normalize legacy values while preserving new ones.
      // Legacy -> internal classes: horizontal/row/carousel => row, vertical/column/list => column, grid stays grid
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

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get("origin") || "";
    const shop = url.searchParams.get("shop") || undefined;
    const allowedOrigin = shop ? await validateCorsOrigin(origin, shop) : null;
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
      // Verify App Proxy signature and derive shop
      let shop: string | undefined;
      try {
        const { session } = await authenticate.public.appProxy(request);
        shop = session?.shop;
  } catch (_e) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      if (!shop) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, shop);
      const corsHeaders = getCorsHeaders(allowedOrigin);

      const now = new Date().toISOString();
      await saveSettings(shop, { themeEmbedEnabled: true, themeEmbedLastSeen: now });
      return json({ success: true }, {
        headers: corsHeaders,
      });
    }

    // Validate discount codes from the storefront (cart modal)
    if (path.includes('/api/discount')) {
      // Verify the app proxy signature and get the shop
      let shopDomain: string | undefined;
      try {
        const { session } = await authenticate.public.appProxy(request);
        shopDomain = session?.shop;
  } catch (_e) {

      }

      // SECURITY: Validate CORS origin
      const origin = request.headers.get("origin") || "";
      const allowedOrigin = shopDomain ? await validateCorsOrigin(origin, shopDomain) : null;
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

      // If we can't determine the shop, fail closed (do not accept unknown codes)
      if (!shopDomain) {
        return json({ success: false, error: 'Unable to validate discount code' }, {
          status: 401,
          headers: corsHeaders,
        });
      }

      // CRITICAL: Enforce order limit - block discount validation if limit reached
      const subscription = await getOrCreateSubscription(shopDomain);
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

      try {
        const { admin } = await unauthenticated.admin(shopDomain);
        // Use Admin GraphQL API to validate code existence and extract basic value (percent or fixed amount)
        const query = `#graphql
          query ValidateDiscountCode($code: String!) {
            codeDiscountNodeByCode(code: $code) {
              id
              codeDiscount {
                __typename
                ... on DiscountCodeBasic {
                  title
                  customerGets {
                    value {
                      __typename
                      ... on DiscountPercentage { percentage }
                      ... on DiscountAmount { amount { amount currencyCode } }
                    }
                  }
                }
                ... on DiscountCodeBxgy {
                  title
                }
                ... on DiscountCodeFreeShipping {
                  title
                }
              }
            }
          }
        `;
        const resp = await admin.graphql(query, { variables: { code: discountCode } });
        const data = await resp.json();
        const node = data?.data?.codeDiscountNodeByCode;

        if (!node) {
          return json({ success: false, error: 'Invalid discount code' }, {
            status: 404,
            headers: corsHeaders,
          });
        }

        // Default values
        let kind: 'percent' | 'amount' | undefined;
        let percent: number | undefined;
        let amountCents: number | undefined;

        const cd = node.codeDiscount;
    if (cd?.__typename === 'DiscountCodeBasic') {
          const value = cd?.customerGets?.value;
          if (value?.__typename === 'DiscountPercentage' && typeof value.percentage === 'number') {
            kind = 'percent';
            // Shopify typically returns the percent value directly (e.g., 10 for 10%, 0.5 for 0.5%).
            // We'll pass it through unchanged; client divides by 100.
            percent = value.percentage;
          } else if (value?.__typename === 'DiscountAmount' && value.amount?.amount) {
            kind = 'amount';
            // Convert MoneyV2 amount to minor units (cents)
            const amt = parseFloat(value.amount.amount);
            if (!isNaN(amt)) amountCents = Math.round(amt * 100);
          }
        }

        return json({
          success: true,
          discount: {
            code: discountCode,
            summary: `Discount code ${discountCode} will be applied at checkout`,
            status: 'VALID',
            kind,
            percent,
            amountCents,
          }
        }, {
          headers: corsHeaders,
        });
  } catch (_e) {
        return json({ success: false, error: 'Unable to validate discount code' }, {
          status: 500,
          headers: corsHeaders,
        });
      }
    }

    // Handle /api/track-recommendations FIRST (before /api/track to avoid false match)
    if (path.includes('/api/track-recommendations')) {
      let shop: string | undefined;
      try {
        const { session } = await authenticate.public.appProxy(request);
        shop = session?.shop;
        if (!shop) throw new Error('No shop');
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

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
              shop,
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
      let shop: string | undefined;
      try {
        const { session } = await authenticate.public.appProxy(request);
        shop = session?.shop;
        if (!shop) throw new Error('No shop');
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, shop);
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
              shop,
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
      let shop: string | undefined;
      try {
        const { session } = await authenticate.public.appProxy(request);
        shop = session?.shop;
        if (!shop) throw new Error('No shop');
      } catch (authErr) {
        return json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }

      const origin = request.headers.get("origin") || "";
      const allowedOrigin = await validateCorsOrigin(origin, shop);
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
              shop,
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
        return json({ success: false }, { status: 500, headers: corsHeaders });
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
