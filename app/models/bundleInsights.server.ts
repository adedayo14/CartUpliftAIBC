import { unauthenticated } from "~/shopify.server";
import { logger } from "~/utils/logger.server";
import { BUNDLE_TYPES, BUNDLE_STATUS, type BundleType, type BundleStatus } from "~/constants/bundle";

interface GraphQLAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

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
  shop: string;
  admin?: GraphQLAdminClient;
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

const RECENT_ORDERS_QUERY = `#graphql
  query BundleInsightsOrders($first: Int!) {
    orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
      edges {
        node {
          id
          processedAt
          lineItems(first: 25) {
            edges {
              node {
                quantity
                originalTotalSet { shopMoney { amount } }
                discountedTotalSet { shopMoney { amount } }
                product {
                  id
                  title
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getBundleInsights({
  shop,
  admin,
  orderLimit = 40,
  minPairOrders = 2,
}: BundleInsightsOptions) {
  let adminClient = admin;

  if (!adminClient) {
    const { admin: unauthenticatedAdmin } = await unauthenticated.admin(shop);
    adminClient = unauthenticatedAdmin;
  }

  if (!adminClient) {
    return { bundles: [], opportunities: [], totalOrdersConsidered: 0 };
  }

  try {
    const response = await adminClient.graphql(RECENT_ORDERS_QUERY, {
      variables: { first: orderLimit },
    });

    if (!response.ok) {
      logger.warn("Bundle insights GraphQL error", await safeParseError(response));
      return { bundles: [], opportunities: [], totalOrdersConsidered: 0 };
    }

    const payload = await response.json();

    if (payload?.errors?.length) {
      logger.warn("Bundle insights GraphQL errors", payload.errors);
      return { bundles: [], opportunities: [], totalOrdersConsidered: 0 };
    }

    const orderEdges: unknown[] = payload?.data?.orders?.edges ?? [];

    const pairMap = new Map<string, BundleAggregate>();
    let totalOrdersConsidered = 0;

    for (const edge of orderEdges) {
      const lineItems: unknown[] = edge?.node?.lineItems?.edges ?? [];
      const parsedItems = lineItems
        .map<LineItemAggregate | null>((liEdge) => {
          const node = liEdge?.node;
          const productGid: string | undefined = node?.product?.id;
          const title: string | undefined = node?.product?.title ?? undefined;
          if (!productGid || !title) return null;

          const productId = productGid.replace("gid://shopify/Product/", "");
          const quantity = Number(node?.quantity ?? 0);
          const discountedAmount = Number(
            node?.discountedTotalSet?.shopMoney?.amount ?? 0
          );
          const originalAmount = Number(
            node?.originalTotalSet?.shopMoney?.amount ?? node?.discountedTotalSet?.shopMoney?.amount ?? 0
          );

          if (!productId || Number.isNaN(quantity) || quantity <= 0) return null;

          return {
            productId,
            title,
            quantity,
            discountedAmount: Number.isFinite(discountedAmount)
              ? discountedAmount
              : 0,
            originalAmount: Number.isFinite(originalAmount)
              ? originalAmount
              : 0,
          } satisfies LineItemAggregate;
        })
        .filter(Boolean) as LineItemAggregate[];

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

async function safeParseError(response: Response) {
  try {
    return await response.json();
  } catch (_) {
    return { status: response.status, statusText: response.statusText };
  }
}
