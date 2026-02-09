/**
 * Product-Specific Bundle API
 * Returns bundles assigned to a specific product (manual) or AI-generated bundles
 * 
 * GET /api/bundles?product_id=123&context=product
 * 
 * Manual bundles: Show merchant-set discounts from bundle.discountValue
 * AI bundles: Use settings.defaultBundleDiscount for consistency
 * 
 * Version: v1.6.0-unified-discount-2025-11-13
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getBundleInsights } from "../models/bundleInsights.server";
import {
  validateProductId,
  sanitizeTextInput,
  validateCorsOrigin,
  getCorsHeaders
} from "../services/security.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('[Bundles API v1.7.0] === NEW CODE LOADED - AI DISCOUNT FIX ===');

  const url = new URL(request.url);
  const rawProductId = url.searchParams.get('product_id');
  const rawContext = url.searchParams.get('context') || 'product';

  // Phase 3: Input validation
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
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    // Phase 3: CORS validation (per-shop allowlist)
    const origin = request.headers.get('origin');
    const allowedOrigin = await validateCorsOrigin(origin, shop, admin);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    // Phase 3: Rate limiting with burst support (100 rpm, 40 burst)
    try {
      await rateLimitRequest(request, shop, { sustainedLimit: 100, burstLimit: 40 });
    } catch (error) {
      if (error instanceof Response && error.status === 429) {
        console.warn(`[Bundles API] Rate limit exceeded for shop: ${shop}`);
        return error; // Return 429 response (no CORS needed for error)
      }
      throw error;
    }

    // Get shop currency
    let currencyCode = 'USD';
    try {
      const shopResponse = await admin.graphql(`
        #graphql
        query {
          shop {
            currencyCode
          }
        }
      `);
      const shopData = await shopResponse.json();
      currencyCode = shopData.data?.shop?.currencyCode || 'USD';
    } catch (_err) {
      console.warn('[Bundles API] Failed to fetch currency, defaulting to USD');
    }

    // Get settings to check if bundles are enabled
    const settings = await prisma.settings.findUnique({
      where: { shop }
    });

    console.log('[Bundles API] Settings loaded:', {
      shop,
      settingsFound: !!settings,
      defaultBundleDiscount: settings?.defaultBundleDiscount,
      enableSmartBundles: settings?.enableSmartBundles
    });

    if (!settings?.enableSmartBundles) {
      console.log('[Bundles API] Smart bundles disabled for shop');
      return noCacheJson({
        success: true,
        bundles: [],
        currency: currencyCode,
        message: 'Product recommendations not enabled'
      }, { corsHeaders });
    }

    // Step 1: Check for manual bundles assigned to this product
    console.log('[Bundles API] Looking for bundles for product:', productId);
    
    // First, get ALL bundles to see what's in the database
    const allBundles = await prisma.bundle.findMany({
      where: { shop },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        assignedProducts: true,
        productIds: true,
        bundleStyle: true
      }
    });
    
    console.log('[Bundles API] All bundles in database:', JSON.stringify(allBundles, null, 2));
    
    const manualBundles = await prisma.bundle.findMany({
      where: {
        shop,
        status: 'active',
        OR: [
          // Bundle assigned to ALL product pages
          { assignmentType: 'all' },
          // OR bundle specifically assigned to this product
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
      console.log('[Bundles API v1.3.0] Manual bundle RAW from DB:', JSON.stringify(manualBundles.map(b => ({
        id: b.id,
        name: b.name,
        description: b.description,
        type: b.type,
        status: b.status,
        assignmentType: b.assignmentType,
        bundleStyle: b.bundleStyle,
        discountType: b.discountType,
        discountValue: b.discountValue,
        assignedProducts: b.assignedProducts,
        productIds: b.productIds,
        productsCount: b.products?.length
      })), null, 2));
    }

    if (manualBundles.length > 0) {
      // Format manual bundles
      const formattedBundles = await Promise.all(
        manualBundles.map(async (bundle) => {
          // Fetch product details from Shopify
          const productDetails = await fetchProductDetails(
            admin,
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
                variants: details.variants || [], // Add variants array
                isAnchor: isCurrentProduct,
                isRemovable: bp.isRemovable,
                available: details.available !== false
              };
            })
            // Filter out duplicate products and out-of-stock items
            .filter((product, index, self) => {
              // Remove duplicates: only keep first occurrence of each product ID
              const isDuplicate = self.findIndex(p => p.id === product.id) !== index;
              if (isDuplicate) {
                console.log(`[Bundles API] Removing duplicate product from manual bundle: ${product.title} (${product.id})`);
                return false;
              }

              // Remove out-of-stock products (check if ANY variant is available)
              const hasAvailableVariant = product.variants && product.variants.length > 0
                ? product.variants.some((v) => v.available === true)
                : product.available !== false;
              
              if (!hasAvailableVariant) {
                console.log(`[Bundles API] Removing out-of-stock product from manual bundle: ${product.title} (${product.id})`);
                return false;
              }
              
              return true;
            })
            .sort((a, b) => {
              // Sort anchor product first - frontend expects it at index 0
              if (a.isAnchor && !b.isAnchor) return -1;
              if (!a.isAnchor && b.isAnchor) return 1;
              return 0;
            });

          // Calculate totals - use actual price, not comparePrice
          const regularTotal = products.reduce((sum, p) => sum + p.price, 0);
          const bundlePrice = bundle.discountType === 'percentage'
            ? regularTotal * (1 - bundle.discountValue / 100)
            : regularTotal - bundle.discountValue;

          const discountPercent = regularTotal > 0
            ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100)
            : 0;

          // Parse tier config if exists
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

      // Filter out bundles with no products after filtering (current product excluded + stock filtering)
      // We need at least 1 other product besides the current product to show a bundle
      const validBundles = formattedBundles.filter(bundle => {
        if (bundle.products.length < 1) {
          console.log(`[Bundles API] Skipping bundle "${bundle.name}" - no companion products available after filtering`);
          return false;
        }
        return true;
      });

      const response = {
        success: true,
        bundles: validBundles,
        source: 'manual',
        currency: currencyCode,
        settings: {
          defaultDiscount: settings.defaultBundleDiscount,
          autoApply: settings.autoApplyBundleDiscounts
        }
      };
      
      console.log('[Bundles API] Returning manual bundles:', {
        count: validBundles.length,
        currency: currencyCode,
        bundleNames: validBundles.map(b => b.name),
        firstBundleProducts: validBundles[0]?.products.map(p => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          hasVariants: p.variants && p.variants.length > 0,
          variantCount: p.variants?.length || 0
        }))
      });

      return noCacheJson(response, { corsHeaders });
    }

    // Step 2: No manual bundles, try AI-generated bundles
    console.log('[Bundles API] No manual bundles, checking AI bundles...');

    // Get ALL AI bundle configurations to match with ML-generated bundles
    const aiBundleConfigs = await prisma.bundle.findMany({
      where: {
        shop,
        type: 'ai_suggested',
        status: 'active'
      },
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        productIds: true // Need this to match bundles by product sets
      }
    });

    console.log('[Bundles API] AI Bundle Configs found:', aiBundleConfigs.length);

    const mlBundles = await getBundleInsights({
      shop,
      admin,
      orderLimit: 40,
      minPairOrders: 2
    });

    console.log('[Bundles API] AI bundles found:', mlBundles.bundles.length);

    if (mlBundles.bundles.length > 0) {
      // Find bundles that include the current product
      const relevantBundles = mlBundles.bundles.filter(b => 
        b.productIds.includes(productId)
      );

      console.log('[Bundles API] Relevant AI bundles:', relevantBundles.length);

      // Format AI bundles
      const formattedAIBundles = await Promise.all(
        relevantBundles.slice(0, 3).map(async (bundle) => {
          // Fetch product details
          const productDetails = await fetchProductDetails(admin, bundle.productIds);

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
                available: details.available !== false // Add availability flag
              };
            })
            // Filter out duplicate products and out-of-stock items
            .filter((product, index, self) => {
              // Remove duplicates: only keep first occurrence of each product ID
              const isDuplicate = self.findIndex(p => p.id === product.id) !== index;
              if (isDuplicate) {
                console.log(`[Bundles API] Removing duplicate product: ${product.title} (${product.id})`);
                return false;
              }
              
              // Remove out-of-stock products (check if ANY variant is available)
              const hasAvailableVariant = product.variants && product.variants.length > 0
                ? product.variants.some((v) => v.available === true)
                : product.available !== false;
              
              if (!hasAvailableVariant) {
                console.log(`[Bundles API] Removing out-of-stock product: ${product.title} (${product.id})`);
                return false;
              }
              
              return true;
            })
            .sort((a, b) => {
              // Sort anchor product first
              if (a.isAnchor && !b.isAnchor) return -1;
              if (!a.isAnchor && b.isAnchor) return 1;
              return 0;
            });

          // Format AI bundles for the response
          // Match this ML bundle to a user-created AI bundle config by comparing product sets
          let bundleDiscount = 0;
          let discountType = 'percentage';

          // Try to find a matching AI bundle config
          const bundleProductIds = bundle.productIds.map(id => id.toString()).sort();
          const matchingConfig = aiBundleConfigs.find(config => {
            try {
              const configProductIds = JSON.parse(config.productIds || '[]').map((id: unknown) => id.toString()).sort();
              // Check if product sets match (same products, order doesn't matter)
              return bundleProductIds.length === configProductIds.length &&
                     bundleProductIds.every((id, idx) => id === configProductIds[idx]);
            } catch (e) {
              return false;
            }
          });

          if (matchingConfig) {
            // Use the discount from the matching AI bundle config
            bundleDiscount = parseFloat(matchingConfig.discountValue?.toString() || '0');
            discountType = matchingConfig.discountType || 'percentage';
            console.log('[Bundles API] Found matching AI bundle config:', {
              configId: matchingConfig.id,
              configName: matchingConfig.name,
              discountValue: bundleDiscount,
              discountType
            });
          } else {
            // No matching config found - default to 0%
            bundleDiscount = 0;
            console.log('[Bundles API] No matching AI bundle config - using 0% discount');
          }

          // Calculate totals from actual product prices
          const regularTotal = products.reduce((sum, p) => sum + p.price, 0);
          const bundlePrice = discountType === 'percentage'
            ? regularTotal * (1 - bundleDiscount / 100)
            : regularTotal - bundleDiscount;

          const discountPercent = regularTotal > 0
            ? Math.round(((regularTotal - bundlePrice) / regularTotal) * 100)
            : 0;

          console.log('[Bundles API] AI Bundle discount calculation:', {
            bundleId: bundle.id,
            bundleName: bundle.name,
            settingsDefaultDiscount: settings.defaultBundleDiscount,
            bundleDiscount,
            regularTotal,
            bundlePrice,
            discountPercent
          });

          return {
            id: `ai-${bundle.id}`,
            name: `${bundle.name}`,
            description: `Frequently bought together`,
            type: 'ai_suggested',
            bundleStyle: 'grid', // Default to grid for AI bundles
            discountType: discountType,
            discountValue: bundleDiscount,
            products,
            bundle_price: bundlePrice,
            regular_total: regularTotal,
            discount_percent: discountPercent, // Calculate the same way as manual bundles
            allowDeselect: true,
            hideIfNoML: false,
            minProducts: undefined,
            minBundlePrice: undefined,
            source: 'ai'
          } as BundleResponse;
        })
      );

      // Filter out bundles with less than 2 products after stock filtering
      const validAIBundles = formattedAIBundles.filter(bundle => {
        if (bundle.products.length < 2) {
          console.log(`[Bundles API] Skipping AI bundle "${bundle.name}" - only ${bundle.products.length} product(s) available`);
          return false;
        }
        return true;
      });

      // DEBUG: Log what we're about to return
      console.log('[Bundles API] RETURNING AI BUNDLES:', JSON.stringify(validAIBundles.map(b => ({
        id: b.id,
        name: b.name,
        discountType: b.discountType,
        discountValue: b.discountValue,
        discount_percent: b.discount_percent,
        bundle_price: b.bundle_price,
        regular_total: b.regular_total
      })), null, 2));

      // If no valid bundles after filtering, fall through to next step
      if (validAIBundles.length === 0) {
        console.log('[Bundles API] No valid AI bundles after stock filtering');
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
    console.log('[Bundles API] No bundles found for product:', productId);
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
    const shop = url.searchParams.get('shop');
    const origin = request.headers.get('origin') || '';
    const allowedOrigin = shop ? await validateCorsOrigin(origin, shop) : null;
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

// Additional GraphQL type definitions
interface GraphQLVariantNode {
  id: string;
  title: string;
  price: string;
  compareAtPrice?: string;
  availableForSale: boolean;
  selectedOptions: Array<{
    name: string;
    value: string;
  }>;
}

interface GraphQLProductDetailsNode {
  id: string;
  title: string;
  handle: string;
  priceRangeV2: {
    minVariantPrice: {
      amount: string;
    };
  };
  compareAtPriceRange?: {
    minVariantPrice: {
      amount: string;
    };
  };
  featuredImage?: {
    url: string;
  };
  variants: {
    edges: Array<{
      node: GraphQLVariantNode;
    }>;
  };
}

interface GraphQLProductDetailsResponse {
  data?: Record<string, GraphQLProductDetailsNode>;
  errors?: unknown[];
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
 * Fetch product details from Shopify GraphQL
 */
async function fetchProductDetails(
  admin: { graphql: (query: string) => Promise<Response> },
  productIds: string[]
): Promise<Record<string, ProductDetails>> {
  if (!productIds || productIds.length === 0) return {};

  try {
    // Build GraphQL query for multiple products
    const queries = productIds.map((id, idx) => {
      const gid = id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
      return `
        product${idx}: product(id: "${gid}") {
          id
          title
          handle
          priceRangeV2 {
            minVariantPrice {
              amount
            }
          }
          compareAtPriceRange {
            minVariantPrice {
              amount
            }
          }
          featuredImage {
            url(transform: {maxWidth: 400})
          }
          variants(first: 250) {
            edges {
              node {
                id
                title
                price
                compareAtPrice
                availableForSale
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      `;
    }).join('\n');

    const response = await admin.graphql(`
      #graphql
      query getProductDetails {
        ${queries}
      }
    `);

    const data = await response.json() as GraphQLProductDetailsResponse;

    if (data.errors) {
      console.error('[Bundles API] GraphQL errors:', data.errors);
      return {};
    }

    // Parse response into map
    const productMap: Record<string, ProductDetails> = {};

    productIds.forEach((id, idx) => {
      const product = data.data?.[`product${idx}`];
      if (product) {
        const cleanId = id.replace('gid://shopify/Product/', '');
        const price = parseFloat(product.priceRangeV2?.minVariantPrice?.amount || '0');
        const comparePrice = parseFloat(product.compareAtPriceRange?.minVariantPrice?.amount || '0');

        // Map variants data
        const variants = product.variants?.edges?.map((edge: { node: GraphQLVariantNode }) => {
          const variant = edge.node;
          return {
            id: variant.id?.replace('gid://shopify/ProductVariant/', ''),
            title: variant.title,
            price: parseFloat(variant.price) * 100, // Convert to cents
            compare_at_price: variant.compareAtPrice ? parseFloat(variant.compareAtPrice) * 100 : undefined,
            available: variant.availableForSale,
            selectedOptions: variant.selectedOptions,
            // Also map individual options for backward compatibility
            option1: variant.selectedOptions?.[0]?.value,
            option2: variant.selectedOptions?.[1]?.value,
            option3: variant.selectedOptions?.[2]?.value,
          };
        }) || [];

        // Check if product has at least one available variant
        const hasAvailableVariant = variants.length > 0
          ? variants.some((v) => v.available === true)
          : false;

        productMap[cleanId] = {
          title: product.title,
          handle: product.handle,
          price: price * 100, // Convert to cents
          comparePrice: comparePrice > 0 ? comparePrice * 100 : undefined,
          image: product.featuredImage?.url,
          variantId: product.variants?.edges[0]?.node?.id,
          variants: variants, // Add full variants array
          available: hasAvailableVariant // Add product-level availability
        };
      }
    });

    return productMap;
  } catch (error: unknown) {
    console.error('[Bundles API] Failed to fetch product details:', error);
    return {};
  }
}
