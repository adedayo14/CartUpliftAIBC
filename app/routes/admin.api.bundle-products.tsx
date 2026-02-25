import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
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

    const { session, storeHash } = await authenticateAdmin(request);

    // SECURITY: Rate limiting - 50 requests per minute
    const rateLimitResult = await rateLimitRequest(request, storeHash, {
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

    // Fetch products from BigCommerce catalog API
    const apiPath = query
      ? `/catalog/products?keyword=${encodeURIComponent(query)}&include=variants,images&is_visible=true&limit=50`
      : `/catalog/products?include=variants,images&is_visible=true&limit=50`;
    const productsResponse = await bigcommerceApi(storeHash, apiPath);
    const productsData = await productsResponse.json();

    const products: Product[] = (productsData.data || []).map((p: Record<string, unknown>) => ({
      id: String(p.id),
      title: (p.name as string) || 'Untitled Product',
      handle: ((p.custom_url as { url?: string })?.url || `/${p.id}/`).replace(/^\/|\/$/g, ''),
      status: (p.is_visible as boolean) ? 'ACTIVE' : 'DRAFT',
      totalInventory: (p.inventory_level as number) || 0,
      variants: ((p.variants as Array<Record<string, unknown>>) || []).map((v: Record<string, unknown>) => ({
        id: String(v.id),
        title: ((v.option_values as Array<{ label: string }>) || []).map((o: { label: string }) => o.label).join(' / ') || 'Default',
        price: Number(v.price) || Number(p.price) || 0,
        inventoryQuantity: (v.inventory_level as number) || 0,
      })),
      price: String(p.price || '0.00'),
      image: ((p.images as Array<{ url_standard?: string }>) || [])[0]?.url_standard || undefined,
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
