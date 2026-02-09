import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { getShopCurrency } from "../services/currency.server";

// Type definitions
interface GraphQLVariantNode {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
}

interface GraphQLMetafieldNode {
  namespace: string;
  key: string;
  value: string;
}

interface GraphQLProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage?: {
    url: string;
    altText: string;
  };
  priceRangeV2: {
    minVariantPrice: {
      amount: string;
      currencyCode: string;
    };
  };
  metafields: {
    edges: Array<{
      node: GraphQLMetafieldNode;
    }>;
  };
  variants: {
    edges: Array<{
      node: GraphQLVariantNode;
    }>;
  };
}

interface GraphQLProductsResponse {
  data?: {
    products: {
      edges: Array<{
        node: GraphQLProductNode;
      }>;
      pageInfo: {
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      };
    };
  };
}

interface Variant {
  id: string;
  title: string;
  price: number;
  availableForSale: boolean;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  image: string | null;
  imageAlt: string;
  minPrice: number;
  currency: string;
  price: number;
  variants: Variant[];
  metafields: Record<string, Record<string, unknown>>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // SECURITY: Rate limiting - 100 requests per minute
    const rateLimitResult = await rateLimitRequest(request, shop, {
      maxRequests: 100,
      windowMs: 60 * 1000,
      burstMax: 40,
      burstWindowMs: 10 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }

    // Fetch shop currency
    const shopCurrency = await getShopCurrency(shop);

    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const limit = parseInt(url.searchParams.get('limit') || '50');

  const response = await admin.graphql(`
      query getProducts($first: Int!, $query: String) {
        products(first: $first, query: $query) {
          edges {
            node {
              id
              title
              handle
              status
              featuredImage { url altText }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
              metafields(first: 10) {
                edges {
                  node {
                    namespace
                    key
                    value
                  }
                }
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
          price
                    availableForSale
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage hasPreviousPage }
        }
      }
    `, {
      variables: {
        first: limit,
        query: query ? "title:*" + query + "* OR vendor:*" + query + "* OR tag:*" + query + "*" : '',
      },
    });

    const data = await response.json() as GraphQLProductsResponse;

    if (!data || !data.data) {
      console.error('Invalid GraphQL response:', data);
      return json({ products: [], error: 'Failed to fetch products' });
    }

    // Transform the data to a simpler format
    const products: Product[] = data.data.products.edges.map((edge: { node: GraphQLProductNode }) => {
      const product = edge.node;
      const variants: Variant[] = (product.variants?.edges || []).map((variantEdge: { node: GraphQLVariantNode }) => ({
        id: variantEdge.node.id,
        title: variantEdge.node.title,
        price: typeof variantEdge.node.price === 'number' ? variantEdge.node.price : parseFloat(variantEdge.node.price ?? '0') || 0,
        availableForSale: variantEdge.node.availableForSale,
      }));

      // Transform metafields to a more usable format
      const metafields: Record<string, Record<string, unknown>> = {};
      (product.metafields?.edges || []).forEach((metafield: { node: GraphQLMetafieldNode }) => {
        const { namespace, key, value } = metafield.node;
        if (!metafields[namespace]) metafields[namespace] = {};
        try {
          metafields[namespace][key] = JSON.parse(value);
        } catch {
          metafields[namespace][key] = value;
        }
      });

      const minVariant = variants.find((v: Variant) => typeof v.price === 'number') || variants[0];
      const minPriceAmount = product.priceRangeV2?.minVariantPrice?.amount;
      const currencyCode = product.priceRangeV2?.minVariantPrice?.currencyCode || shopCurrency.code;
      const minPrice = typeof minPriceAmount === 'number' ? minPriceAmount : parseFloat(minPriceAmount ?? '0') || (minVariant?.price ?? 0);
      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        image: product.featuredImage?.url || null,
        imageAlt: product.featuredImage?.altText || product.title,
        minPrice,
        currency: currencyCode,
        // Back-compat for UIs expecting `price`
        price: minPrice,
        variants,
        metafields,
      };
    });

    return json({
      products,
      hasNextPage: data.data.products.pageInfo.hasNextPage,
      currency: shopCurrency.code,
      currencyFormat: shopCurrency.format
    });

  } catch (error: unknown) {
    console.error('Error fetching products:', error);
    return json({ products: [], error: 'Failed to fetch products' });
  }
}
