import { getOrders, getOrderProducts } from "~/services/bigcommerce-api.server";
import { logger } from "~/utils/logger.server";
import { BUNDLE_TYPES, BUNDLE_STATUS, type BundleType, type BundleStatus } from "~/constants/bundle";

export interface BundleSummary {
  id: string;
  productIds: string[];
  productTitles: string[];
  name: string;
  averageDiscountPercent: number;
  orderCount: number;
  totalQuantity: number;
  revenue: number;
  regularRevenue: number;
  status: BundleStatus;
  type: BundleType;
}

export interface BundleOpportunity {
  id: string;
  productTitles: string[];
  frequency: number; // 0-1 ratio
  potentialRevenue: number; // Average revenue per order containing the pair
  confidence: "High" | "Medium" | "Low";
}

interface BundleInsightsOptions {
  storeHash: string;
  orderLimit?: number;
  minPairOrders?: number;
}

interface LineItemAggregate {
  productId: string;
  title: string;
  quantity: number;
  discountedAmount: number;
  originalAmount: number;
}

interface BundleAggregate {
  productIds: string[];
  productTitles: string[];
  orderCount: number;
  totalQuantity: number;
  revenue: number;
  regularRevenue: number;
}

export async function getBundleInsights({
  storeHash,
  orderLimit = 40,
  minPairOrders = 2,
}: BundleInsightsOptions) {
  try {
    // Fetch recent orders from BigCommerce REST API
    const orders = await getOrders(storeHash, {
      limit: orderLimit,
      sort: "date_created:desc",
    });

    const pairMap = new Map<string, BundleAggregate>();
    let totalOrdersConsidered = 0;

    // Process each order and its line items
    for (const order of orders) {
      let orderProducts;
      try {
        orderProducts = await getOrderProducts(storeHash, order.id);
      } catch (err) {
        logger.warn(`Failed to fetch products for order ${order.id}:`, err);
        continue;
      }

      const parsedItems: LineItemAggregate[] = orderProducts
        .filter(item => item.product_id > 0) // Skip non-product line items
        .map(item => ({
          productId: String(item.product_id),
          title: item.name || 'Unknown Product',
          quantity: item.quantity,
          discountedAmount: parseFloat(item.total_inc_tax || '0'),
          originalAmount: parseFloat(item.base_total || item.total_inc_tax || '0'),
        }));

      // Deduplicate by product
      const uniqueByProduct = new Map<string, LineItemAggregate>();
      for (const item of parsedItems) {
        const existing = uniqueByProduct.get(item.productId);
        if (existing) {
          existing.quantity += item.quantity;
          existing.discountedAmount += item.discountedAmount;
          existing.originalAmount += item.originalAmount;
        } else {
          uniqueByProduct.set(item.productId, { ...item });
        }
      }

      const items = Array.from(uniqueByProduct.values());
      if (items.length < 2) {
        continue;
      }

      totalOrdersConsidered += 1;

      const pairs = generatePairs(items);
      for (const pair of pairs) {
        const sorted = [...pair].sort((a, b) =>
          a.productId.localeCompare(b.productId)
        );
        const key = sorted.map((item) => item.productId).join("__");
        const titles = sorted.map((item) => item.title);

        const aggregate = pairMap.get(key) ?? {
          productIds: sorted.map((item) => item.productId),
          productTitles: titles,
          orderCount: 0,
          totalQuantity: 0,
          revenue: 0,
          regularRevenue: 0,
        };

        aggregate.orderCount += 1;
        aggregate.totalQuantity += sorted.reduce(
          (sum, item) => sum + item.quantity,
          0
        );
        aggregate.revenue += sorted.reduce(
          (sum, item) => sum + item.discountedAmount,
          0
        );
        aggregate.regularRevenue += sorted.reduce(
          (sum, item) => sum + item.originalAmount,
          0
        );

        pairMap.set(key, aggregate);
      }
    }

    const aggregates = Array.from(pairMap.values()).filter(
      (bundle) => bundle.orderCount >= minPairOrders
    );

    aggregates.sort((a, b) => b.orderCount - a.orderCount);

    const bundles: BundleSummary[] = aggregates.map((aggregate, index) => {
      const discountPercent = calculateDiscountPercent(
        aggregate.regularRevenue,
        aggregate.revenue
      );

      return {
        id: `bundle-${index}`,
        productIds: aggregate.productIds,
        productTitles: aggregate.productTitles,
        name: aggregate.productTitles.join(" + "),
        averageDiscountPercent: discountPercent,
        orderCount: aggregate.orderCount,
        totalQuantity: aggregate.totalQuantity,
        revenue: roundToCurrency(aggregate.revenue),
        regularRevenue: roundToCurrency(aggregate.regularRevenue),
        status: aggregate.orderCount >= 3 ? BUNDLE_STATUS.ACTIVE : BUNDLE_STATUS.DRAFT,
        type: BUNDLE_TYPES.ML,
      } satisfies BundleSummary;
    });

    const opportunities: BundleOpportunity[] = Array.from(pairMap.values())
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10)
      .map((aggregate, index) => ({
        id: `op-${index}`,
        productTitles: aggregate.productTitles,
        frequency:
          totalOrdersConsidered > 0
            ? aggregate.orderCount / totalOrdersConsidered
            : 0,
        potentialRevenue:
          aggregate.orderCount > 0
            ? roundToCurrency(aggregate.revenue / aggregate.orderCount)
            : 0,
        confidence: classifyConfidence(aggregate.orderCount),
      }));

    return { bundles, opportunities, totalOrdersConsidered };
  } catch (error) {
    logger.error("Bundle insights error", error);
    return { bundles: [], opportunities: [], totalOrdersConsidered: 0 };
  }
}

function generatePairs(items: LineItemAggregate[]) {
  const pairs: LineItemAggregate[][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

function calculateDiscountPercent(regular: number, actual: number) {
  if (!regular || regular <= 0) return 0;
  const discount = regular - actual;
  if (discount <= 0) return 0;
  return Math.min(100, (discount / regular) * 100);
}

function roundToCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function classifyConfidence(orderCount: number): "High" | "Medium" | "Low" {
  if (orderCount >= 5) return "High";
  if (orderCount >= 3) return "Medium";
  return "Low";
}
