/**
 * Product-Specific Bundle API
 * Returns bundles assigned to a specific product (manual) or AI-generated bundles
 *
 * GET /api/bundles?product_id=123&context=product
 *
 * Manual bundles: Show merchant-set discounts from bundle.discountValue
 * AI bundles: Use settings.defaultBundleDiscount for consistency
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import prisma from "../db.server";
import { getBundleInsights } from "../models/bundleInsights.server";
import {
  validateProductId,
  sanitizeTextInput,
  validateCorsOrigin,
  getCorsHeaders
} from "../services/security.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { getProduct, type BCVariant } from "../services/bigcommerce-api.server";
import { getShopCurrency } from "../services/currency.server";

// Helper to create responses with no-cache headers + CORS
const noCacheJson = (data: any, options?: { status?: number; corsHeaders?: Record<string, string> }) => {
  return json(data, {
    status: options?.status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      ...(options?.corsHeaders || {})
    }
  });
};

interface BundleProduct {
  id: string;
  title: string;
  handle: string;
  price: number;
  comparePrice?: number;
  image?: string;
  variantId?: string;
  variants?: Array<{
    id: string;
    title: string;
    price: number;
    compare_at_price?: number;
    available: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
    option1?: string;
    option2?: string;
    option3?: string;
  }>;
  isAnchor?: boolean;
  isRemovable?: boolean;
  available?: boolean;
}

interface BundleResponse {
  id: string;
  name: string;
  description?: string;
  type: string;
  bundleStyle: string;
  discountType: string;
  discountValue: number;
  products: BundleProduct[];
  bundle_price?: number;
  regular_total?: number;
  discount_percent?: number;
  tierConfig?: Array<{ qty: number; discount: number }>;
  selectMinQty?: number;
  selectMaxQty?: number;
  allowDeselect?: boolean;
  hideIfNoML?: boolean;
  minProducts?: number;
  minBundlePrice?: number;
  source?: string;
  mainProductId?: string;
}

interface ProductDetails {
  title: string;
  handle: string;
  price: number;
  comparePrice?: number;
  image?: string;
  variantId?: string;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    compare_at_price?: number;
    available: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
    option1?: string;
    option2?: string;
    option3?: string;
  }>;
  available: boolean;
}

/**
 * Fetch product details from BigCommerce REST API
 */
async function fetchProductDetails(
  storeHash: string,
  productIds: string[]
): Promise<Record<string, ProductDetails>> {
  if (!productIds || productIds.length === 0) return {};

  const productMap: Record<string, ProductDetails> = {};

  // Fetch each product in parallel
  await Promise.allSettled(
    productIds.map(async (id) => {
      const numericId = parseInt(id, 10);
      if (isNaN(numericId)) return;

      try {
        const product = await getProduct(storeHash, numericId, "images,variants");
        const variants = (product.variants || []).map((v: BCVariant) => ({
          id: String(v.id),
          title: v.option_values.map(ov => ov.label).join(' / ') || 'Default',
          price: (v.calculated_price || v.price || product.price) * 100, // Convert to cents
          compare_at_price: v.retail_price ? v.retail_price * 100 : undefined,
          available: !v.purchasing_disabled && v.inventory_level !== 0,
          selectedOptions: v.option_values.map(ov => ({
            name: ov.option_display_name,
            value: ov.label,
          })),
          option1: v.option_values[0]?.label,
          option2: v.option_values[1]?.label,
          option3: v.option_values[2]?.label,
        }));

        const hasAvailableVariant = variants.length > 0
          ? variants.some((v) => v.available === true)
          : product.availability !== 'disabled';

        const thumbnail = product.images?.find(img => img.is_thumbnail);
        const firstImage = product.images?.[0];

        productMap[id] = {
          title: product.name,
          handle: product.custom_url?.url?.replace(/^\/|\/$/g, '') || String(product.id),
          price: (product.calculated_price || product.price) * 100, // Convert to cents
          comparePrice: product.retail_price ? product.retail_price * 100 : undefined,
          image: thumbnail?.url_standard || firstImage?.url_standard,
          variantId: product.variants?.[0] ? String(product.variants[0].id) : undefined,
          variants,
          available: hasAvailableVariant,
        };
      } catch (err) {
        console.warn(`[Bundles API] Failed to fetch product ${id}:`, err);
      }
    })
  );

  return productMap;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const rawProductId = url.searchParams.get('product_id');
  const rawContext = url.searchParams.get('context') || 'product';

  const productId = validateProductId(rawProductId);
  const context = sanitizeTextInput(rawContext, 50);

  console.log('[Bundles API] Request:', { productId, context, rawProductId });

  if (!productId) {
    console.warn('[Bundles API] Invalid product_id:', rawProductId);
    return noCacheJson({
      success: false,
      error: 'Invalid or missing product_id parameter',
      bundles: []
    }, { status: 400 });
  }

  try {
    const { storeHash } = await authenticateAdmin(request);

    // CORS validation
    const origin = request.headers.get('origin');
    const allowedOrigin = await validateCorsOrigin(origin, storeHash);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    // Rate limiting
    try {
      await rateLimitRequest(request, storeHash, { sustainedLimit: 100, burstLimit: 40 });
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.warn(`[Bundles API] Rate limit exceeded for store: ${storeHash}`);
        return error;
      }
      throw error;
    }

    // Get store currency
    const shopCurrency = await getShopCurrency(storeHash);
    const currencyCode = shopCurrency.code;

    // Get settings to check if bundles are enabled
    const settings = await prisma.settings.findUnique({
      where: { storeHash }
    });

    console.log('[Bundles API] Settings loaded:', {
      storeHash,
      settingsFound: !!settings,
      defaultBundleDiscount: settings?.defaultBundleDiscount,
      enableSmartBundles: settings?.enableSmartBundles
    });

    if (!settings?.enableSmartBundles) {
      return noCacheJson({
        success: true,
        bundles: [],
        currency: currencyCode,
        message: 'Product recommendations not enabled'
      }, { corsHeaders });
    }

    // Step 1: Check for manual bundles assigned to this product
    console.log('[Bundles API] Looking for bundles for product:', productId);

    const manualBundles = await prisma.bundle.findMany({
      where: {
        storeHash,
        status: 'active',
        OR: [
          { assignmentType: 'all' },
          {
            AND: [
              { assignmentType: 'specific' },
              { assignedProducts: { contains: `"${productId}"` } }
            ]
          }
        ]
      },
      include: {
        products: {
          orderBy: { position: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('[Bundles API] Found manual bundles:', manualBundles.length);

    if (manualBundles.length > 0) {
      const formattedBundles = await Promise.all(
        manualBundles.map(async (bundle) => {
          const productDetails = await fetchProductDetails(
            storeHash,
            bundle.products.map(bp => bp.productId)
          );

          const products: BundleProduct[] = bundle.products
            .map(bp => {
              const details = productDetails[bp.productId] || {};
              const isCurrentProduct = bp.isAnchor || bp.productId === productId || bp.productId === productId.toString() || bp.productId.toString() === productId;
              return {
                id: bp.productId,
                title: bp.productTitle || details.title || 'Unknown Product',
                handle: bp.productHandle || details.handle || '',
                price: bp.productPrice || details.price || 0,
                comparePrice: details.comparePrice,
                image: details.image,
                variantId: bp.variantId || details.variantId,
                variants: details.variants || [],
                isAnchor: isCurrentProduct,
                isRemovable: bp.isRemovable,
                available: details.available !== false
              };
            })
            .filter((product, index, self) => {
              const isDuplicate = self.findIndex(p => p.id === product.id) !== index;
              if (isDuplicate) return false;
              const hasAvailableVariant = product.variants && product.variants.length > 0
                ? product.variants.some((v) => v.available === true)
                : product.available !== false;
              if (!hasAvailableVariant) return false;
              return true;
            })
            .sort((a, b) => {
              if (a.isAnchor && !b.isAnchor) return -1;
              if (!a.isAnchor && b.isAnchor) return 1;
              return 0;
            });

          const regularTotal = products.reduce((sum, p) => sum + p.price, 0);
          const bundlePrice = bundle.discountType === 'percentage'
            ? regularTotal * (1 - bundle.discountValue / 100)
            : regularTotal - bundle.discountValue;

          const discountPercent = regularTotal > 0
            ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100)
            : 0;

          let tierConfig;
          try {
            tierConfig = bundle.tierConfig ? JSON.parse(bundle.tierConfig) : undefined;
          } catch (e) {
            console.warn('[Bundles API] Failed to parse tierConfig:', e);
          }

          return {
            id: bundle.id,
            name: bundle.name,
            description: bundle.description,
            type: bundle.type,
            bundleStyle: bundle.bundleStyle,
            discountType: bundle.discountType,
            discountValue: bundle.discountValue,
            products,
            bundle_price: bundlePrice,
            regular_total: regularTotal,
            discount_percent: discountPercent,
            tierConfig,
            selectMinQty: bundle.selectMinQty,
            selectMaxQty: bundle.selectMaxQty,
            allowDeselect: bundle.allowDeselect,
            hideIfNoML: bundle.hideIfNoML,
            minProducts: bundle.minProducts ?? undefined,
            minBundlePrice: bundle.minBundlePrice ? Math.round(bundle.minBundlePrice * 100) : undefined,
            source: bundle.type === 'ai_suggested' ? 'ai' : 'manual'
          } as BundleResponse;
        })
      );

      const validBundles = formattedBundles.filter(bundle => bundle.products.length >= 1);

      return noCacheJson({
        success: true,
        bundles: validBundles,
        source: 'manual',
        currency: currencyCode,
        settings: {
          defaultDiscount: settings.defaultBundleDiscount,
          autoApply: settings.autoApplyBundleDiscounts
        }
      }, { corsHeaders });
    }

    // Step 2: No manual bundles, try AI-generated bundles
    console.log('[Bundles API] No manual bundles, checking AI bundles...');

    const aiBundleConfigs = await prisma.bundle.findMany({
      where: {
        storeHash,
        type: 'ai_suggested',
        status: 'active'
      },
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        productIds: true
      }
    });

    const mlBundles = await getBundleInsights({
      storeHash,
      orderLimit: 40,
      minPairOrders: 2
    });

    if (mlBundles.bundles.length > 0) {
      const relevantBundles = mlBundles.bundles.filter(b =>
        b.productIds.includes(productId)
      );

      const formattedAIBundles = await Promise.all(
        relevantBundles.slice(0, 3).map(async (bundle) => {
          const productDetails = await fetchProductDetails(storeHash, bundle.productIds);

          const products: BundleProduct[] = bundle.productIds
            .map((pid, idx) => {
              const details = productDetails[pid] || {};
              const isCurrentProduct = pid === productId || pid === productId.toString() || pid.toString() === productId;
              return {
                id: pid,
                title: bundle.productTitles[idx] || details.title || 'Unknown Product',
                handle: details.handle || '',
                price: details.price || 0,
                comparePrice: details.comparePrice,
                image: details.image,
                variantId: details.variantId,
                variants: details.variants || [],
                isAnchor: isCurrentProduct,
                isRemovable: !isCurrentProduct,
                available: details.available !== false
              };
            })
            .filter((product, index, self) => {
              const isDuplicate = self.findIndex(p => p.id === product.id) !== index;
              if (isDuplicate) return false;
              const hasAvailableVariant = product.variants && product.variants.length > 0
                ? product.variants.some((v) => v.available === true)
                : product.available !== false;
              if (!hasAvailableVariant) return false;
              return true;
            })
            .sort((a, b) => {
              if (a.isAnchor && !b.isAnchor) return -1;
              if (!a.isAnchor && b.isAnchor) return 1;
              return 0;
            });

          let bundleDiscount = 0;
          let discountType = 'percentage';

          const bundleProductIds = bundle.productIds.map(id => id.toString()).sort();
          const matchingConfig = aiBundleConfigs.find(config => {
            try {
              const configProductIds = JSON.parse(config.productIds || '[]').map((id: unknown) => id.toString()).sort();
              return bundleProductIds.length === configProductIds.length &&
                     bundleProductIds.every((id, idx) => id === configProductIds[idx]);
            } catch (e) {
              return false;
            }
          });

          if (matchingConfig) {
            bundleDiscount = parseFloat(matchingConfig.discountValue?.toString() || '0');
            discountType = matchingConfig.discountType || 'percentage';
          }

          const regularTotal = products.reduce((sum, p) => sum + p.price, 0);
          const bundlePrice = discountType === 'percentage'
            ? regularTotal * (1 - bundleDiscount / 100)
            : regularTotal - bundleDiscount;

          const discountPercent = regularTotal > 0
            ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100)
            : 0;

          return {
            id: `ai-${bundle.id}`,
            name: `${bundle.name}`,
            description: `Frequently bought together`,
            type: 'ai_suggested',
            bundleStyle: 'grid',
            discountType: discountType,
            discountValue: bundleDiscount,
            products,
            bundle_price: bundlePrice,
            regular_total: regularTotal,
            discount_percent: discountPercent,
            allowDeselect: true,
            hideIfNoML: false,
            minProducts: undefined,
            minBundlePrice: undefined,
            source: 'ai'
          } as BundleResponse;
        })
      );

      const validAIBundles = formattedAIBundles.filter(bundle => bundle.products.length >= 2);

      if (validAIBundles.length === 0) {
        return noCacheJson({
          success: true,
          bundles: [],
          currency: currencyCode,
          source: 'none',
          message: 'No recommendations available for this product'
        }, { corsHeaders });
      }

      return noCacheJson({
        success: true,
        bundles: validAIBundles,
        source: 'ai',
        currency: currencyCode,
        confidence: mlBundles.bundles[0]?.status === 'active' ? 'high' : 'medium',
        settings: {
          defaultDiscount: settings.defaultBundleDiscount,
          autoApply: settings.autoApplyBundleDiscounts
        }
      }, { corsHeaders });
    }

    // Step 3: No bundles found
    return noCacheJson({
      success: true,
      bundles: [],
      currency: currencyCode,
      source: 'none',
      message: 'No recommendations available for this product'
    }, { corsHeaders });

  } catch (error: unknown) {
    console.error('[Bundles API] Error:', error);
    return noCacheJson({
      success: false,
      error: 'Failed to load recommendations',
      bundles: []
    }, { status: 500, corsHeaders });
  }
};

/**
 * OPTIONS handler for CORS preflight
 */
export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    const url = new URL(request.url);
    const storeHash = url.searchParams.get('storeHash');
    const origin = request.headers.get('origin') || '';
    const allowedOrigin = storeHash ? await validateCorsOrigin(origin, storeHash) : null;
    const corsHeaders = getCorsHeaders(allowedOrigin);

    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
};
