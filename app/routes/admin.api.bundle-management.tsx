import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prisma from "../db.server";
import { BUNDLE_TYPES } from "~/constants/bundle";

// BigCommerce API response types
interface BCProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  inventory_level: number;
  is_visible: boolean;
  custom_url?: { url: string };
  images?: Array<{ url_standard: string; description: string }>;
  variants?: Array<{
    id: number;
    sku: string;
    price: number | null;
    inventory_level: number;
    option_values?: Array<{ label: string }>;
  }>;
}

interface BCCategory {
  id: number;
  name: string;
  custom_url?: { url: string };
  is_visible: boolean;
}

interface CategoryResponse {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

interface ProductResponse {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number;
  variants: Array<{
    id: string;
    title: string;
    price: number;
    inventoryQuantity: number;
  }>;
  price: string;
  image: string | undefined;
}

interface BundleActionBody {
  action?: string;
  shop?: string;
  name?: string;
  description?: string;
  type?: string;
  bundleType?: string;
  discountType?: string;
  discountValue?: string | number;
  categoryIds?: string;
  collectionIds?: string;
  productIds?: string;
  minProducts?: string | number;
  minBundlePrice?: string | number;
  assignmentType?: string;
  assignedProducts?: string;
  bundleStyle?: string;
  selectMinQty?: string | number;
  selectMaxQty?: string | number;
  tierConfig?: string;
  allowDeselect?: string | boolean;
  hideIfNoML?: string | boolean;
  bundleId?: string;
  status?: string;
  [key: string]: unknown;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "repair-ai-bundles") {
      const aiBundles = await prisma.bundle.findMany({
        where: {
          storeHash,
          type: { in: ['ml', 'ai_suggested'] },
          status: 'active'
        },
        include: {
          products: true
        }
      });

      const { getBundleInsights } = await import('../models/bundleInsights.server');
      const insights = await getBundleInsights({
        storeHash,
        orderLimit: 40,
        minPairOrders: 2
      });

      let repairedCount = 0;
      const results = [];

      for (const bundle of aiBundles) {
        if (bundle.products && bundle.products.length > 0) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'already-has-products', productsCount: bundle.products.length });
          continue;
        }

        const matchingInsight = insights.bundles[0];

        if (!matchingInsight || matchingInsight.productIds.length === 0) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'no-insights-available', availableInsights: insights.bundles.length });
          continue;
        }

        try {
          // Fetch product details from BigCommerce
          const productIdList = matchingInsight.productIds.join(',');
          const productsResponse = await bigcommerceApi(storeHash, `/catalog/products?id:in=${productIdList}&include=images`);
          const productsData = productsResponse.ok ? await productsResponse.json() : { data: [] };
          const products: BCProduct[] = productsData.data || [];

          await prisma.bundle.update({
            where: { id: bundle.id },
            data: {
              productIds: JSON.stringify(matchingInsight.productIds)
            }
          });

          const bundleProducts = matchingInsight.productIds.map((productId: string, index: number) => {
            const productNode = products.find((p: BCProduct) => String(p.id) === String(productId));
            return {
              bundleId: bundle.id,
              productId: String(productId),
              productTitle: productNode?.name || matchingInsight.productTitles[index] || `Product ${productId}`,
              position: index,
              required: index === 0
            };
          });

          await prisma.bundleProduct.createMany({
            data: bundleProducts
          });

          repairedCount++;
          results.push({
            bundleId: bundle.id,
            name: bundle.name,
            status: 'repaired',
            productsAdded: bundleProducts.length,
            mlBundleUsed: matchingInsight.name,
            products: bundleProducts.map(p => ({ id: p.productId, title: p.productTitle }))
          });
        } catch (error) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'error', error: String(error) });
        }
      }

      return json({
        success: true,
        message: `Repaired ${repairedCount} AI bundles`,
        repairedCount,
        totalMLBundlesAvailable: insights.bundles.length,
        results
      });
    }

    if (action === "bundles") {
      const bundles = await prisma.bundle.findMany({
        where: { storeHash },
        include: {
          bundles: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return json({ success: true, bundles });
    }

    if (action === "categories") {
      try {
        const categoriesResponse = await bigcommerceApi(storeHash, "/catalog/categories?limit=100&is_visible=true");

        if (!categoriesResponse.ok) {
          console.error('[Bundle Management] Categories API error:', categoriesResponse.status);
          return json({ success: false, error: 'Failed to fetch categories', categories: [] }, { status: 500 });
        }

        const categoriesData = await categoriesResponse.json();
        const categories: BCCategory[] = categoriesData.data || [];

        return json({
          success: true,
          categories: categories.map((cat): CategoryResponse => ({
            id: String(cat.id),
            title: cat.name,
            handle: cat.custom_url?.url?.replace(/^\/|\/$/g, '') || String(cat.id),
            productsCount: 0
          }))
        });
      } catch (error) {
        console.error('[Bundle Management] Categories fetch error:', error);
        return json({ success: false, error: 'Failed to fetch categories', categories: [] }, { status: 500 });
      }
    }

    if (action === "products") {
      const categoryId = url.searchParams.get("categoryId");
      const query = url.searchParams.get("query") || "";

      try {
        let apiPath = "/catalog/products?include=variants,images&is_visible=true&limit=100";
        if (categoryId) {
          apiPath += `&categories:in=${categoryId}`;
        }
        if (query) {
          apiPath += `&keyword=${encodeURIComponent(query)}`;
        }

        const productsResponse = await bigcommerceApi(storeHash, apiPath);

        if (!productsResponse.ok) {
          console.error('[Bundle Management] Products API error:', productsResponse.status);
          return json({ success: false, error: 'Failed to fetch products', products: [] }, { status: 500 });
        }

        const productsData = await productsResponse.json();
        const products: BCProduct[] = productsData.data || [];

        return json({
          success: true,
          products: products.map((product): ProductResponse => ({
            id: String(product.id),
            title: product.name,
            handle: product.custom_url?.url?.replace(/^\/|\/$/g, '') || String(product.id),
            status: product.is_visible ? 'active' : 'draft',
            totalInventory: product.inventory_level || 0,
            variants: (product.variants || []).map((v) => ({
              id: String(v.id),
              title: v.option_values?.map(ov => ov.label).join(' / ') || 'Default',
              price: v.price ?? product.price,
              inventoryQuantity: v.inventory_level || 0
            })),
            price: String(product.price || '0.00'),
            image: product.images?.[0]?.url_standard
          }))
        });
      } catch (error) {
        console.error('[Bundle Management] Products fetch error:', error);
        return json({ success: false, error: 'Failed to fetch products', products: [] }, { status: 500 });
      }
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("[Bundle Management] Loader error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to load data";
    return json({
      success: false,
      error: errorMessage,
      products: action === "products" ? [] : undefined,
      categories: action === "categories" ? [] : undefined
    }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let actionType: string | null;
  let body: BundleActionBody = {};
  let shop: string | undefined;

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      body = await request.json() as BundleActionBody;
      actionType = body.action || null;
      shop = body.shop;
    } catch (e: unknown) {
      console.error('[Bundle API Action] JSON parse error:', e);
      return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    actionType = formData.get('action')?.toString() || null;
    shop = formData.get('shop')?.toString();
    formData.forEach((v, k) => { body[k] = v; });
  }

  try {
    const { storeHash } = await authenticateAdmin(request);
    if (!shop) {
      shop = storeHash;
    }
  } catch (authError: unknown) {
    const errorMessage = authError instanceof Error ? authError.message : 'Unknown error';
    console.error('[Bundle API Action] Authentication failed:', errorMessage);
    return json({ success: false, error: 'Authentication failed' }, { status: 401 });
  }

  try {
    if (actionType === 'create-bundle') {
      const name = (body.name as string) || '';
      const description = (body.description as string) || '';
      const rawType = (body.type as string) || (body.bundleType as string) || BUNDLE_TYPES.ML;
      const type = rawType === BUNDLE_TYPES.AI_SUGGESTED ? BUNDLE_TYPES.ML : rawType;
      const discountType = (body.discountType as string) || 'percentage';
      const parsedDiscountValue = parseFloat(String(body.discountValue));
      const discountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0;
      const collectionIds = (body.categoryIds as string) || (body.collectionIds as string) || '[]';
      const productIds = (body.productIds as string) || '[]';
      const minProducts = body.minProducts ? parseInt(String(body.minProducts)) : null;
      const minBundlePrice = body.minBundlePrice ? parseFloat(String(body.minBundlePrice)) : null;
      const assignmentType = (body.assignmentType as string) || 'specific';

      const assignedProducts = (body.assignedProducts as string) || '[]';
      const bundleStyle = (body.bundleStyle as string) || 'grid';
      const selectMinQty = body.selectMinQty ? parseInt(String(body.selectMinQty)) : null;
      const selectMaxQty = body.selectMaxQty ? parseInt(String(body.selectMaxQty)) : null;
      const tierConfig = (body.tierConfig as string) || '[]';
      const allowDeselect = body.allowDeselect !== undefined ? String(body.allowDeselect) === 'true' : true;
      const hideIfNoML = body.hideIfNoML !== undefined ? String(body.hideIfNoML) === 'true' : false;

      if (!name || !type || discountValue < 0) {
        return json({ success: false, error: "Invalid bundle data" }, { status: 400 });
      }

      const bundle = await prisma.bundle.create({
        data: {
          storeHash: shop,
          name,
          description,
          type,
          discountType,
          discountValue,
          collectionIds,
          productIds,
          minProducts,
          minBundlePrice,
          assignmentType,
          assignedProducts,
          bundleStyle,
          selectMinQty,
          selectMaxQty,
          tierConfig,
          allowDeselect,
          hideIfNoML,
          status: 'active'
        }
      });

      if (productIds) {
        try {
          const productIdArray = JSON.parse(productIds) as string[];
          if (Array.isArray(productIdArray) && productIdArray.length > 0) {
            const bundleProducts = productIdArray.map((productId: string, index: number) => ({
              bundleId: bundle.id,
              productId,
              position: index,
              required: index === 0
            }));

            await prisma.bundleProduct.createMany({
              data: bundleProducts
            });
          }
        } catch (e: unknown) {
          console.warn("Failed to parse product IDs:", e);
        }
      }

      // For AI/ML bundles without products, try to fetch from ML insights
      if ((type === 'ml' || type === 'ai_suggested') && (!productIds || productIds === '[]')) {
        try {
          const { getBundleInsights } = await import('../models/bundleInsights.server');
          const insights = await getBundleInsights({
            storeHash: shop!,
            orderLimit: 40,
            minPairOrders: 2
          });

          const matchingInsight = insights.bundles.find(b =>
            b.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(b.name.toLowerCase())
          );

          if (matchingInsight && matchingInsight.productIds.length > 0) {
            console.log(`Found ML insights for "${name}":`, matchingInsight.productIds);

            await prisma.bundle.update({
              where: { id: bundle.id },
              data: {
                productIds: JSON.stringify(matchingInsight.productIds)
              }
            });

            // Fetch product titles from BigCommerce
            const productIdList = matchingInsight.productIds.join(',');
            const productsResponse = await bigcommerceApi(shop!, `/catalog/products?id:in=${productIdList}`);
            const productsData = productsResponse.ok ? await productsResponse.json() : { data: [] };
            const products: BCProduct[] = productsData.data || [];

            const bundleProducts = matchingInsight.productIds.map((productId: string, index: number) => {
              const productNode = products.find((p: BCProduct) => String(p.id) === String(productId));
              return {
                bundleId: bundle.id,
                productId: String(productId),
                productTitle: productNode?.name || matchingInsight.productTitles[index] || `Product ${productId}`,
                position: index,
                required: index === 0
              };
            });

            await prisma.bundleProduct.createMany({
              data: bundleProducts
            });

            console.log(`Stored ${bundleProducts.length} products for AI bundle "${name}"`);
          }
        } catch (error) {
          console.warn(`Could not fetch ML insights for AI bundle "${name}":`, error);
        }
      }

      return json({ success: true, bundle });
    }

    if (actionType === 'update-bundle') {
      const bundleId = (body.bundleId as string);
      const name = (body.name as string);
      const description = (body.description as string);
      const status = (body.status as string);
      const discountType = (body.discountType as string) || 'percentage';
      const parsedDiscountValue = parseFloat(String(body.discountValue));
      const discountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0;
      const assignmentType = (body.assignmentType as string) || 'specific';
      const minProducts = body.minProducts ? parseInt(String(body.minProducts)) : null;
      const minBundlePrice = body.minBundlePrice ? parseFloat(String(body.minBundlePrice)) : null;
      const allowDeselect = body.allowDeselect !== undefined ? Boolean(body.allowDeselect) : true;
      const hideIfNoML = body.hideIfNoML !== undefined ? Boolean(body.hideIfNoML) : false;

      if (assignmentType === 'all') {
        const currentBundle = await prisma.bundle.findUnique({
          where: { id: bundleId },
          select: { type: true, assignmentType: true }
        });

        if (currentBundle && (currentBundle.assignmentType !== 'all' || status === 'active')) {
          const existingShowAllBundle = await prisma.bundle.findFirst({
            where: {
              storeHash: shop,
              type: currentBundle.type,
              assignmentType: 'all',
              status: 'active',
              id: { not: bundleId }
            },
            select: { id: true, name: true }
          });

          if (existingShowAllBundle) {
            const bundleTypeLabel = currentBundle.type === 'manual' ? 'Manual' : 'AI';
            return json({
              success: false,
              error: `Only one ${bundleTypeLabel} bundle can show on all products. "${existingShowAllBundle.name}" is already active. Please pause or delete it first, or change this bundle to show on specific products.`
            }, { status: 400 });
          }
        }
      }

      const bundle = await prisma.bundle.update({
        where: { id: bundleId, storeHash: shop },
        data: {
          name,
          description,
          status,
          discountType,
          discountValue,
          assignmentType,
          minProducts,
          minBundlePrice,
          allowDeselect,
          hideIfNoML,
        }
      });

      return json({ success: true, bundle });
    }

    if (actionType === 'delete-bundle') {
      const bundleId = (body.bundleId as string);

      await prisma.bundle.delete({
        where: { id: bundleId, storeHash: shop }
      });

      return json({ success: true, message: "Bundle deleted successfully" });
    }

    if (actionType === 'toggle-status') {
      const bundleId = (body.bundleId as string);
      const status = (body.status as string);

      const bundle = await prisma.bundle.update({
        where: { id: bundleId, storeHash: shop },
        data: { status }
      });

      return json({ success: true, bundle });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("[Bundle API Action] Error:", error);
    if (error instanceof Error) {
      console.error("[Bundle API Action] Error stack:", error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : "Failed to perform action";
    return json({ success: false, error: errorMessage }, { status: 500 });
  }
};
