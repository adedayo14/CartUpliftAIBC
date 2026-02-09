import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

interface ProductVariant {
  id: string;
  price: string;
}

interface ProductMedia {
  edges: Array<{
    node: {
      image?: {
        url: string;
        altText?: string;
      };
    };
  }>;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  media: ProductMedia;
}

interface LineItemNode {
  quantity: number;
  product: Product;
  variant: ProductVariant;
}

interface LineItemEdge {
  node: LineItemNode;
}

interface OrderNode {
  id: string;
  createdAt: string;
  totalPriceSet: {
    shopMoney: {
      amount: string;
    };
  };
  lineItems: {
    edges: LineItemEdge[];
  };
}

interface OrderEdge {
  node: OrderNode;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  
  if (!shop) {
    return json({ error: "Shop parameter is required" }, { status: 400 });
  }

  // In a real implementation, you would:
  // 1. Query your database for shop settings
  // 2. Determine upsell strategy (related products, bestsellers, AI recommendations, etc.)
  // 3. Fetch relevant products from Shopify
  // 4. Apply business logic for recommendations

  // Use real sales data to determine top-performing upsells
  // 1. Query actual order line items to find best-selling products
  // 2. Calculate which products are frequently bought together
  // 3. Prioritize by revenue and conversion performance

  try {
    // Fetch actual sales data from orders
    const salesDataResponse = await admin.graphql(`
      #graphql
      query getTopPerformingProducts($first: Int!) {
        orders(first: 250, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                }
              }
              lineItems(first: 10) {
                edges {
                  node {
                    quantity
                    product {
                      id
                      title
                      handle
                      media(first: 1) {
                        edges {
                          node {
                            ... on MediaImage {
                              image {
                                url
                                altText
                              }
                            }
                          }
                        }
                      }
                    }
                    variant {
                      id
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, {
      variables: {
        first: 250
      }
    });

    const salesData = await salesDataResponse.json();
    const orders = salesData.data?.orders?.edges || [];

    // Calculate product performance metrics
    const productMetrics: Record<string, {
      id: string;
      title: string;
      handle: string;
      image: string;
      price: number;
      variantId: string;
      totalRevenue: number;
      totalQuantity: number;
      orderCount: number;
      avgOrderValue: number;
    }> = {};

    // Analyze real sales data
    orders.forEach((order: OrderEdge) => {
      const orderNode = order.node;

      orderNode.lineItems.edges.forEach((lineItem: LineItemEdge) => {
        const item = lineItem.node;
        const product = item.product;
        const variant = item.variant;
        
        if (!product || !variant) return;
        
        const productId = product.id.replace('gid://shopify/Product/', '');
        const revenue = parseFloat(variant.price) * item.quantity;
        
        if (!productMetrics[productId]) {
          productMetrics[productId] = {
            id: productId,
            title: product.title,
            handle: product.handle,
            image: product.media.edges[0]?.node?.image?.url || 'https://via.placeholder.com/150',
            price: parseFloat(variant.price) * 100, // Convert to cents
            variantId: variant.id.replace('gid://shopify/ProductVariant/', ''),
            totalRevenue: 0,
            totalQuantity: 0,
            orderCount: 0,
            avgOrderValue: 0
          };
        }
        
        productMetrics[productId].totalRevenue += revenue;
        productMetrics[productId].totalQuantity += item.quantity;
        productMetrics[productId].orderCount += 1;
        productMetrics[productId].avgOrderValue = productMetrics[productId].totalRevenue / productMetrics[productId].orderCount;
      });
    });

    // Sort by performance (revenue * frequency)
    const topPerformers = Object.values(productMetrics)
      .filter(product => product.totalRevenue > 0)
      .sort((a, b) => (b.totalRevenue * b.orderCount) - (a.totalRevenue * a.orderCount))
      .slice(0, 6); // Get top 6 performers

    // Transform for frontend
    const upsells = topPerformers.map(product => ({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      variant_id: product.variantId,
      handle: product.handle,
      // Include performance metrics for better recommendations
      performance: {
        revenue: product.totalRevenue,
        quantity: product.totalQuantity,
        orders: product.orderCount,
        avgOrderValue: product.avgOrderValue
      }
    }));

    return json(upsells);
  } catch (error: unknown) {
    console.error('Error fetching products for upsells:', error);
    return json({ error: "Failed to fetch upsells" }, { status: 500 });
  }
};
