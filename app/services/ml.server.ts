import { getProduct, getProducts, getOrders, getOrderProducts, type BCProduct, type BCVariant } from "~/services/bigcommerce-api.server";
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";

export type BundleProduct = {
  id: string;
  variant_id: string;
  title: string;
  price: number;
};

export type GeneratedBundle = {
  id: string;
  name: string;
  products: BundleProduct[];
  regular_total: number;
  bundle_price: number;
  savings_amount: number;
  discount_percent: number;
  status: "active" | "inactive";
  source: "ml" | "rules" | "manual";
};

// AOV-aware discount calculation for margin protection
const calculateOptimalDiscount = (products: BundleProduct[], shopAOV = 0, customerAOV = 0) => {
  const bundleValue = products.reduce((sum, p) => sum + p.price, 0);

  if (customerAOV > 0 && bundleValue > customerAOV * 1.5) {
    return 20; // Aggressive discount to push threshold
  }

  if (shopAOV > 0 && bundleValue > shopAOV) {
    return 12; // Smaller discount maintains margin on high-value bundles
  }

  if (bundleValue < 50) return 10;
  if (bundleValue < 100) return 15;
  if (bundleValue < 200) return 18;
  return 22;
};

export async function generateBundlesFromOrders(params: {
  storeHash: string;
  productId: string;
  limit: number;
  excludeProductId?: string;
  bundleTitle?: string;
  enableCoPurchase?: boolean;
  sessionId?: string;
  shopAOV?: number;
}): Promise<GeneratedBundle[]> {
  const { storeHash, productId, limit, bundleTitle = "Frequently Bought Together", enableCoPurchase, sessionId, shopAOV } = params;

  const manualBundles = await getManualBundlesSafely({ storeHash, productId, limit });
  if (manualBundles.length) return manualBundles;

  // Co-purchase analysis from order data
  if (enableCoPurchase) {
    const coBundles = await coPurchaseFallback({ storeHash, productId, limit, bundleTitle, sessionId, shopAOV });
    if (coBundles.length) return coBundles;
  }

  // Content-based fallback using product catalog
  return await contentBasedFallback({ storeHash, productId, limit, bundleTitle, shopAOV });
}

async function coPurchaseFallback(params: {
  storeHash: string;
  productId: string;
  limit: number;
  bundleTitle?: string;
  sessionId?: string;
  shopAOV?: number;
}): Promise<GeneratedBundle[]> {
  const { storeHash, productId, limit, bundleTitle, sessionId, shopAOV = 0 } = params;
  try {
    // Fetch recent orders from BigCommerce
    const orders = await getOrders(storeHash, { limit: 100 });

    // Build co-occurrence counts by analyzing order line items
    const counts = new Map<string, number>();
    const productTitles = new Map<string, string>();

    for (const order of orders) {
      let orderProducts;
      try {
        orderProducts = await getOrderProducts(storeHash, order.id);
      } catch {
        continue;
      }

      const productSet = new Set<string>();
      let containsAnchor = false;

      for (const item of orderProducts) {
        const pid = String(item.product_id);
        if (pid === productId) {
          containsAnchor = true;
        } else if (item.product_id > 0) {
          productSet.add(pid);
          productTitles.set(pid, item.name || 'Product');
        }
      }

      if (containsAnchor) {
        for (const pid of productSet) {
          counts.set(pid, (counts.get(pid) || 0) + 1);
        }
      }
    }

    // Personalization boost for viewed products
    if (sessionId) {
      try {
        const profile = await prisma.mLUserProfile.findUnique({
          where: {
            storeHash_sessionId: { storeHash, sessionId }
          },
          select: { viewedProducts: true, cartedProducts: true }
        });

        if (profile?.viewedProducts && Array.isArray(profile.viewedProducts)) {
          for (const viewedId of profile.viewedProducts) {
            if (counts.has(viewedId)) {
              counts.set(viewedId, Math.round(counts.get(viewedId)! * 1.5));
            }
          }
        }

        if (profile?.cartedProducts && Array.isArray(profile.cartedProducts)) {
          for (const cartedId of profile.cartedProducts) {
            if (counts.has(cartedId)) {
              counts.set(cartedId, Math.round(counts.get(cartedId)! * 1.8));
            }
          }
        }
      } catch (profileError) {
        logger.warn("Could not fetch user profile for personalization", { error: profileError });
      }
    }

    // Dynamic threshold based on order volume
    const orderCount = orders.length;
    const minCoOccur = orderCount < 50 ? 2 : orderCount < 200 ? 3 : 5;

    const ranked = [...counts.entries()]
      .filter(([, c]) => c >= minCoOccur)
      .sort((a, b) => b[1] - a[1])
      .map(([pid]) => pid);

    if (!ranked.length) return [];

    // Fetch anchor product details
    const anchorProduct = await getProduct(storeHash, parseInt(productId), "variants");
    const anchorPrice = anchorProduct.calculated_price || anchorProduct.price;
    const anchorVid = anchorProduct.variants?.[0] ? String(anchorProduct.variants[0].id) : '';

    // Fetch candidate product details
    const take = Math.max(3, limit);
    const pickPids = ranked.slice(0, take * 2);

    const candidateProducts = await Promise.allSettled(
      pickPids.map(pid => getProduct(storeHash, parseInt(pid), "variants"))
    );

    const validCandidates: Array<{ pid: string; product: BCProduct }> = [];
    candidateProducts.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        validCandidates.push({ pid: pickPids[idx], product: result.value });
      }
    });

    // Price-aware filtering (0.5x - 2x anchor price)
    const priceFiltered = validCandidates.filter(({ product }) => {
      const price = product.calculated_price || product.price;
      return price >= anchorPrice * 0.5 && price <= anchorPrice * 2;
    });

    const nodes = priceFiltered.slice(0, take);

    // Create bundles
    const bundles: GeneratedBundle[] = [];

    if (nodes.length >= 1) {
      const recommendedProducts: BundleProduct[] = nodes.map(({ pid, product }) => ({
        id: pid,
        variant_id: product.variants?.[0] ? String(product.variants[0].id) : '',
        title: product.name || 'Recommended',
        price: product.calculated_price || product.price,
      }));

      const bundleSize = recommendedProducts.length >= 2 ? 3 : 2;
      const selectedRecs = recommendedProducts.slice(0, bundleSize - 1);

      const bundleProducts = [
        { id: productId, variant_id: anchorVid, title: anchorProduct.name || 'Product', price: anchorPrice },
        ...selectedRecs
      ];

      const regular_total = bundleProducts.reduce((sum, p) => sum + p.price, 0);
      const optimalDiscount = calculateOptimalDiscount(bundleProducts, shopAOV);
      const bundle_price = Math.max(0, regular_total * (1 - optimalDiscount / 100));
      const savings_amount = Math.max(0, regular_total - bundle_price);

      const productIds = bundleProducts.map(p => p.id).join('_');
      bundles.push({
        id: `CO_${bundleSize}P_${productId}_${productIds}`,
        name: bundleTitle || 'Frequently Bought Together',
        products: bundleProducts,
        regular_total,
        bundle_price,
        savings_amount,
        discount_percent: optimalDiscount,
        status: 'active',
        source: 'ml',
      });
    }
    return bundles;
  } catch (error: unknown) {
    logger.warn("Co-purchase fallback error", { error });
    return [];
  }
}

async function getManualBundlesSafely(params: { storeHash: string; productId: string; limit: number }): Promise<GeneratedBundle[]> {
  try {
    return await getManualBundles(params);
  } catch (error: unknown) {
    logger.warn("Manual bundles error", { source: "manual", error });
    return [];
  }
}

async function getManualBundles(params: { storeHash: string; productId: string; limit: number }): Promise<GeneratedBundle[]> {
  const { storeHash, productId, limit } = params;
  if (!prisma?.bundle?.findMany) return [];

  const bundles = await prisma.bundle.findMany({
    where: { storeHash, isActive: true, products: { some: { productId } } },
    include: { products: true },
    take: limit,
  });
  if (!bundles?.length) return [];

  const generated: GeneratedBundle[] = [];

  for (const b of bundles) {
    const productIds = (b.products || []).map(p => p.productId);
    if (!productIds.length) continue;

    // Fetch product details from BigCommerce
    const productResults = await Promise.allSettled(
      productIds.map(pid => getProduct(storeHash, parseInt(pid), "variants"))
    );

    const items: BundleProduct[] = [];
    let regular_total = 0;

    productResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const product = result.value;
        const price = product.calculated_price || product.price;
        const vid = product.variants?.[0] ? String(product.variants[0].id) : '';
        items.push({ id: productIds[idx], variant_id: vid, title: product.name || "Product", price });
        regular_total += price;
      }
    });

    if (items.length < 2) continue;

    const optimalDiscount = calculateOptimalDiscount(items);
    const bundle_price = Math.max(0, regular_total * (1 - optimalDiscount / 100));
    const savings_amount = Math.max(0, regular_total - bundle_price);

    generated.push({
      id: `MANUAL_${b.id}`,
      name: b.name || "Bundle",
      products: items,
      regular_total,
      bundle_price,
      savings_amount,
      discount_percent: optimalDiscount,
      status: "active",
      source: "manual",
    });
  }

  return generated;
}

async function contentBasedFallback(params: {
  storeHash: string;
  productId: string;
  limit: number;
  bundleTitle?: string;
  shopAOV?: number;
}): Promise<GeneratedBundle[]> {
  const { storeHash, productId, limit, bundleTitle, shopAOV = 0 } = params;

  try {
    // Fetch anchor product
    const anchorProduct = await getProduct(storeHash, parseInt(productId), "variants");
    const anchorPrice = anchorProduct.calculated_price || anchorProduct.price;
    const anchorVid = anchorProduct.variants?.[0] ? String(anchorProduct.variants[0].id) : '';
    const anchorTitle = anchorProduct.name || '';

    // Fetch catalog products for similarity matching
    const result = await getProducts(storeHash, {
      limit: 75,
      include: "variants",
      sort: "total_sold",
      direction: "desc",
      is_visible: true,
    });
    const catalogProducts = result.products;

    const tokenize = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const anchorTokens = new Set(tokenize(anchorTitle));

    const scored: Array<{ pid: string; vid: string; title: string; price: number; score: number }> = [];

    for (const product of catalogProducts) {
      const pid = String(product.id);
      if (pid === productId) continue;

      const title = product.name || "";
      const price = product.calculated_price || product.price;
      const vid = product.variants?.[0] ? String(product.variants[0].id) : '';

      const tokens = tokenize(title);
      const setB = new Set(tokens);
      const inter = [...anchorTokens].filter((t) => setB.has(t)).length;
      const union = new Set([...anchorTokens, ...setB]).size || 1;
      const jaccard = inter / union;

      // Brand boost (BigCommerce uses brand_id)
      const brandBoost = product.brand_id && product.brand_id === anchorProduct.brand_id ? 0.3 : 0;

      // Category boost
      const categoryBoost = product.categories?.some(c => anchorProduct.categories?.includes(c)) ? 0.2 : 0;

      // Price proximity boost
      const priceDelta = Math.abs(price - anchorPrice);
      const priceBoost = anchorPrice > 0 ? Math.max(0, 0.3 - Math.min(0.3, (priceDelta / Math.max(20, anchorPrice * 0.5)) * 0.3)) : 0;

      const baseline = 0.15;
      const score = Math.max(baseline, jaccard + brandBoost + categoryBoost + priceBoost);
      scored.push({ pid, vid, title, price, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const picks = scored.slice(0, Math.max(3, limit));
    if (!picks.length) return [];

    const bundles: GeneratedBundle[] = [];
    for (const rec of picks) {
      const bundleProducts = [
        { id: productId, variant_id: anchorVid, title: anchorTitle || "Product", price: anchorPrice },
        { id: rec.pid, variant_id: rec.vid, title: rec.title || "Recommended", price: rec.price },
      ];

      const regular_total = anchorPrice + rec.price;
      const optimalDiscount = calculateOptimalDiscount(bundleProducts, shopAOV);
      const bundle_price = Math.max(0, regular_total * (1 - optimalDiscount / 100));
      const savings_amount = Math.max(0, regular_total - bundle_price);

      bundles.push({
        id: `CB_${productId}_${rec.pid}`,
        name: bundleTitle || "Complete your setup",
        products: bundleProducts,
        regular_total,
        bundle_price,
        savings_amount,
        discount_percent: optimalDiscount,
        status: "active",
        source: "ml",
      });
    }
    return bundles;
  } catch (error: unknown) {
    logger.warn("Content-based fallback error", { error });
    return [];
  }
}
