import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

/**
 * Admin API endpoint to fetch products for bundle creation
 * GET /admin/api/bundle-products?query=search
 */

// Type definitions
interface GraphQLVariantNode {
  id: string;
  title: string;
  price: string;
  inventoryQuantity: number;
}

interface GraphQLProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number;
  variants: {
    edges: Array<{
      node: GraphQLVariantNode;
    }>;
  };
  featuredImage?: {
    url: string;
    altText: string;
  };
}

interface GraphQLProductsResponse {
  data?: {
    products: {
      edges: Array<{
        node: GraphQLProductNode;
      }>;
    };
  };
  errors?: unknown[];
}

interface AdminClient {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
}

interface Product {
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
  image?: string;
}

interface TimeoutResponse {
  __timeout: true;
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('🔥 Bundle Products API: Request received');
  
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query") || "";
    const shopParam = url.searchParams.get("shop");

    let adminClient: AdminClient;
    let shopDomain: string | undefined;

    if (shopParam) {
      console.log('🔥 Using unauthenticated admin client for shop param:', shopParam);
      const { admin } = await unauthenticated.admin(shopParam);
      adminClient = admin;
      shopDomain = shopParam;
    } else {
      const { admin, session } = await authenticate.admin(request);
      const shop = session.shop;

// SECURITY: Rate limiting - 50 requests per minute (100-product query)
const rateLimitResult = await rateLimitRequest(request, shop, {
  maxRequests: 50,
  windowMs: 60 * 1000,
  burstMax: 25,
  burstWindowMs: 10 * 1000,
});

if (!rateLimitResult.allowed) {
  return json(
    { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
    { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
  );
}
adminClient = admin;
      shopDomain = session.shop;
      console.log('🔥 Authenticated admin session for shop:', shopDomain);
    }

    const graphqlQuery = `
      #graphql
      query getProducts($query: String!) {
        products(first: 100, query: $query) {
          edges {
            node {
              id
              title
              handle
              status
              totalInventory
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    inventoryQuantity
                  }
                }
              }
              featuredImage {
                url
                altText
              }
            }
          }
        }
      }
    `;

    // Race the GraphQL call against a timeout to prevent hanging UI
    const respPromise = (async () => {
      const resp = await adminClient.graphql(graphqlQuery, {
        variables: { query: query || "status:active" }
      });
      return resp;
    })();

    const timeoutMs = 12000; // 12s safety timeout
    const raced = await Promise.race([
      respPromise,
      new Promise<TimeoutResponse>((resolve) => setTimeout(() => resolve({ __timeout: true }), timeoutMs))
    ]);

    if ('__timeout' in raced && raced.__timeout) {
      console.error(`⏳ GraphQL products request timed out after ${timeoutMs}ms for shop ${shopDomain}`);
      return json({ 
        success: false, 
        error: `Timed out loading products after ${Math.round(timeoutMs/1000)}s. Please Retry.`,
        products: []
      }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
    }

    const response = raced as Response;
    if (!response.ok) {
      console.error('🔥 GraphQL request failed:', response.status);
      return json({ 
        success: false, 
        error: 'Failed to fetch products from Shopify',
        products: []
      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    const responseJson = await response.json() as GraphQLProductsResponse;

    if (responseJson.errors) {
      console.error('🔥 GraphQL errors:', responseJson.errors);
      return json({
        success: false,
        error: 'GraphQL query failed',
        products: []
      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    const productEdges = responseJson.data?.products?.edges || [];

    console.log(`🔥 Successfully fetched ${productEdges.length} products for ${shopDomain}`);

    const products: Product[] = productEdges.map((edge: { node: GraphQLProductNode }) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      status: edge.node.status,
      totalInventory: edge.node.totalInventory,
      variants: edge.node.variants.edges.map((v: { node: GraphQLVariantNode }) => ({
        id: v.node.id,
        title: v.node.title,
        price: parseFloat(v.node.price),
        inventoryQuantity: v.node.inventoryQuantity
      })),
      price: edge.node.variants.edges[0]?.node?.price || "0.00",
      image: edge.node.featuredImage?.url
    }));

    return json({
      success: true,
      products
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    console.error("🔥 Bundle products API error:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to load products",
      products: []
    }, { status: 500 });
  }
};
