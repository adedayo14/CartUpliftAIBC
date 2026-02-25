import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
import prisma from "../db.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

// Type definitions

interface ProductInfo {
  id: string;
  title: string;
  handle: string;
  image: string;
  price: number;
}

interface AssociationMetrics {
  product: ProductInfo;
  coOccurrence: number;
  weightedCoOccurrence: number;
  totalRevenue: number;
  weightedRevenue: number;
  avgOrderValue: number;
}

interface AssociationData {
  product: ProductInfo;
  associatedWith: Record<string, AssociationMetrics>;
  totalOrders: number;
  appearances: number;
  weightedAppearances: number;
}

interface BundleOpportunity {
  productA: ProductInfo;
  productB: ProductInfo;
  coOccurrence: number;
  associationStrength: number;
  totalBundleValue: number;
  suggestedDiscount: number;
  potentialRevenue: number;
  avgOrderValue: number;
  weightedCoOccurrence?: number;
  supportPct?: number;
  confidencePct?: number;
  lift?: number;
}

interface OrderRecord {
  orderId: string;
  orderValue: number;
  productIds: string[];
  createdAt: Date;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);

  const rateLimitResult = await rateLimitRequest(request, storeHash, {
    maxRequests: 10,
    windowMs: 60 * 1000,
    burstMax: 3,
    burstWindowMs: 10 * 1000,
  });

  if (!rateLimitResult.allowed) {
    return json(
      {
        error: "Rate limit exceeded. This endpoint is expensive - maximum 10 requests per minute.",
        retryAfter: rateLimitResult.retryAfter
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter || 60),
        },
      }
    );
  }

  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") || "advanced").toLowerCase();
  const includeDebug = url.searchParams.get("debug") === "1";

  try {
    // Query purchase events from our own database instead of calling BigCommerce orders API.
    // AnalyticsEvent rows with eventType "purchase" carry orderId, orderValue, and productIds (JSON array).
    const purchaseEvents = await prisma.analyticsEvent.findMany({
      where: {
        storeHash,
        eventType: "purchase",
        orderId: { not: null },
        productIds: { not: null },
      },
      orderBy: { timestamp: "desc" },
      take: 500,
      select: {
        orderId: true,
        orderValue: true,
        productIds: true,
        timestamp: true,
      },
    });

    // Deduplicate by orderId and parse productIds JSON
    const orderMap = new Map<string, OrderRecord>();
    for (const evt of purchaseEvents) {
      if (!evt.orderId || !evt.productIds) continue;
      if (orderMap.has(evt.orderId)) continue;

      let parsedIds: string[];
      try {
        const raw = JSON.parse(evt.productIds);
        parsedIds = Array.isArray(raw) ? raw.map(String) : [];
      } catch {
        continue;
      }

      if (parsedIds.length === 0) continue;

      orderMap.set(evt.orderId, {
        orderId: evt.orderId,
        orderValue: evt.orderValue ? Number(evt.orderValue) : 0,
        productIds: parsedIds,
        createdAt: evt.timestamp,
      });
    }

    const orders = Array.from(orderMap.values());

    // Collect all unique product IDs to fetch details from BigCommerce catalog
    const allProductIds = new Set<string>();
    for (const order of orders) {
      for (const pid of order.productIds) {
        allProductIds.add(pid);
      }
    }

    // Fetch product details from BigCommerce catalog API (batch)
    const productInfoMap = new Map<string, ProductInfo>();
    const productIdArray = Array.from(allProductIds);

    if (productIdArray.length > 0) {
      // BigCommerce allows up to 250 IDs per request; batch if needed
      const BATCH_SIZE = 250;
      for (let i = 0; i < productIdArray.length; i += BATCH_SIZE) {
        const batch = productIdArray.slice(i, i + BATCH_SIZE);
        const idsParam = batch.join(",");
        try {
          const catalogRes = await bigcommerceApi(
            storeHash,
            `/catalog/products?id:in=${idsParam}&include=images&limit=${BATCH_SIZE}`
          );
          if (catalogRes.ok) {
            const catalogData = await catalogRes.json();
            const products = catalogData.data || [];
            for (const p of products) {
              const primaryImage = (p.images || []).find((img: { is_thumbnail?: boolean }) => img.is_thumbnail) || (p.images || [])[0];
              productInfoMap.set(String(p.id), {
                id: String(p.id),
                title: p.name || "",
                handle: p.custom_url?.url?.replace(/\//g, "") || String(p.id),
                image: primaryImage?.url_standard || primaryImage?.url_thumbnail || "",
                price: parseFloat(p.price) || 0,
              });
            }
          }
        } catch {
          // Continue with whatever product info we have
        }
      }
    }

    // Fallback product info for IDs we couldn't fetch
    function getProductInfo(productId: string): ProductInfo {
      return productInfoMap.get(productId) || {
        id: productId,
        title: `Product ${productId}`,
        handle: productId,
        image: "",
        price: 0,
      };
    }

    // Build product association matrix
    const associations: Record<string, AssociationData> = {};
    const productAppearances: Record<string, number> = {};
    const productWeightedAppearances: Record<string, number> = {};

    // Time-decay settings: half-life in days
    const HALF_LIFE_DAYS = 90;
    const LN2_OVER_HL = Math.log(2) / HALF_LIFE_DAYS;

    // Analyze each order for product associations
    for (const order of orders) {
      const orderValue = order.orderValue;
      const productIds = order.productIds;
      const ageDays = Math.max(0, (Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      const decayWeight = Math.exp(-LN2_OVER_HL * ageDays);

      // Skip single-item orders for association analysis
      if (productIds.length < 2) continue;

      // Analyze all product pairs in this order
      for (let i = 0; i < productIds.length; i++) {
        for (let j = i + 1; j < productIds.length; j++) {
          const productAId = productIds[i];
          const productBId = productIds[j];

          // Initialize tracking for product A
          if (!associations[productAId]) {
            associations[productAId] = {
              product: getProductInfo(productAId),
              associatedWith: {},
              totalOrders: 0,
              appearances: 0,
              weightedAppearances: 0,
            };
          }

          // Initialize tracking for product B
          if (!associations[productBId]) {
            associations[productBId] = {
              product: getProductInfo(productBId),
              associatedWith: {},
              totalOrders: 0,
              appearances: 0,
              weightedAppearances: 0,
            };
          }

          // Track association A -> B
          if (!associations[productAId].associatedWith[productBId]) {
            associations[productAId].associatedWith[productBId] = {
              product: associations[productBId].product,
              coOccurrence: 0,
              weightedCoOccurrence: 0,
              totalRevenue: 0,
              weightedRevenue: 0,
              avgOrderValue: 0
            };
          }

          // Track association B -> A
          if (!associations[productBId].associatedWith[productAId]) {
            associations[productBId].associatedWith[productAId] = {
              product: associations[productAId].product,
              coOccurrence: 0,
              weightedCoOccurrence: 0,
              totalRevenue: 0,
              weightedRevenue: 0,
              avgOrderValue: 0
            };
          }

          // Update association metrics
          associations[productAId].associatedWith[productBId].coOccurrence++;
          associations[productAId].associatedWith[productBId].weightedCoOccurrence += decayWeight;
          associations[productAId].associatedWith[productBId].totalRevenue += orderValue;
          associations[productAId].associatedWith[productBId].weightedRevenue += orderValue * decayWeight;
          associations[productAId].associatedWith[productBId].avgOrderValue =
            associations[productAId].associatedWith[productBId].totalRevenue /
            associations[productAId].associatedWith[productBId].coOccurrence;

          associations[productBId].associatedWith[productAId].coOccurrence++;
          associations[productBId].associatedWith[productAId].weightedCoOccurrence += decayWeight;
          associations[productBId].associatedWith[productAId].totalRevenue += orderValue;
          associations[productBId].associatedWith[productAId].weightedRevenue += orderValue * decayWeight;
          associations[productBId].associatedWith[productAId].avgOrderValue =
            associations[productBId].associatedWith[productAId].totalRevenue /
            associations[productBId].associatedWith[productAId].coOccurrence;

          associations[productAId].totalOrders++;
          associations[productBId].totalOrders++;

          // Track appearances per order
          associations[productAId].appearances++;
          associations[productBId].appearances++;
          associations[productAId].weightedAppearances += decayWeight;
          associations[productBId].weightedAppearances += decayWeight;
          productAppearances[productAId] = (productAppearances[productAId] || 0) + 1;
          productAppearances[productBId] = (productAppearances[productBId] || 0) + 1;
          productWeightedAppearances[productAId] = (productWeightedAppearances[productAId] || 0) + decayWeight;
          productWeightedAppearances[productBId] = (productWeightedAppearances[productBId] || 0) + decayWeight;
        }
      }
    }

    // Find the best bundle opportunities
    const bundleOpportunities: BundleOpportunity[] = [];

    for (const [productId, data] of Object.entries(associations)) {
      // Only consider products that appear in multiple orders
      if (data.totalOrders < 3) continue;

      for (const [associatedId, assocData] of Object.entries(data.associatedWith)) {
        // BASIC MODE: original behavior using raw frequency
        if (mode === 'basic') {
          const associationStrength = assocData.coOccurrence / data.totalOrders;
          if (associationStrength >= 0.6 && assocData.coOccurrence >= 5) {
            const existingBundle = bundleOpportunities.find(bundle =>
              (bundle.productA.id === productId && bundle.productB.id === associatedId) ||
              (bundle.productA.id === associatedId && bundle.productB.id === productId)
            );

            if (!existingBundle) {
              const totalBundleValue = data.product.price + (associations[associatedId]?.product.price || 0);
              const suggestedDiscount = Math.min(Math.floor(associationStrength * 20), 15);

              bundleOpportunities.push({
                productA: data.product,
                productB: assocData.product,
                coOccurrence: assocData.coOccurrence,
                associationStrength: Math.round(associationStrength * 100),
                totalBundleValue,
                suggestedDiscount,
                potentialRevenue: assocData.totalRevenue,
                avgOrderValue: assocData.avgOrderValue
              });
            }
          }
          continue;
        }

        // ADVANCED MODE: use time-decayed confidence and lift
        const weightedA = data.weightedAppearances || productWeightedAppearances[productId] || 1;
        const weightedB = associations[associatedId]?.weightedAppearances || productWeightedAppearances[associatedId] || 1;

        const weightedCo = assocData.weightedCoOccurrence || 0;
        const support = weightedCo / Math.max(1, Object.values(productWeightedAppearances).reduce((a, b) => a + b, 0));
        const confidence = weightedCo / Math.max(1e-6, weightedA);
        const probB = weightedB / Math.max(1e-6, Object.values(productWeightedAppearances).reduce((a, b) => a + b, 0));
        const lift = probB > 0 ? confidence / probB : 0;

        // Thresholds tuned for decayed stats
        const passes = (confidence >= 0.3 && weightedCo >= 3) || (lift >= 1.2 && weightedCo >= 2.5);
        if (!passes) continue;

          const existingBundle = bundleOpportunities.find(bundle =>
            (bundle.productA.id === productId && bundle.productB.id === associatedId) ||
            (bundle.productA.id === associatedId && bundle.productB.id === productId)
          );

          if (!existingBundle) {
            const totalBundleValue = data.product.price + (associations[associatedId]?.product.price || 0);
            const suggestedDiscount = Math.min(Math.floor(Math.min(1, confidence) * 20), 15);

            bundleOpportunities.push({
              productA: data.product,
              productB: assocData.product,
              coOccurrence: assocData.coOccurrence,
              associationStrength: Math.round(Math.min(1, confidence) * 100),
              totalBundleValue,
              suggestedDiscount,
              potentialRevenue: assocData.weightedRevenue || assocData.totalRevenue,
              avgOrderValue: assocData.avgOrderValue,
              ...(includeDebug ? { weightedCoOccurrence: Number(weightedCo.toFixed(2)), supportPct: Number((support * 100).toFixed(2)), confidencePct: Number((confidence * 100).toFixed(2)), lift: Number(lift.toFixed(2)) } : {})
            });
          }
        }
      }

    // Sort by score
    bundleOpportunities.sort((a, b) => {
      if (mode === 'advanced') {
        const liftA = a.lift ?? a.associationStrength / 100;
        const liftB = b.lift ?? b.associationStrength / 100;
        const scoreA = liftA * (a.potentialRevenue || 0) * (1 + a.associationStrength / 100);
        const scoreB = liftB * (b.potentialRevenue || 0) * (1 + b.associationStrength / 100);
        return scoreB - scoreA;
      }
      const scoreA = a.associationStrength * (a.potentialRevenue || 0);
      const scoreB = b.associationStrength * (b.potentialRevenue || 0);
      return scoreB - scoreA;
    });

    return json({
      bundleOpportunities: bundleOpportunities.slice(0, 10),
      totalAssociations: Object.keys(associations).length,
      analyzedOrders: orders.length,
      mode
    });

  } catch (error: unknown) {
    console.error('Error analyzing product associations:', error);
    return json({ error: "Failed to analyze product associations" }, { status: 500 });
  }
};
