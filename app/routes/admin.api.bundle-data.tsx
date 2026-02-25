import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

/**
 * Admin API endpoint for bundle management data fetching
 * Uses /admin/api/ pattern for proper BigCommerce embedded app authentication
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

interface GraphQLProductsData {
  data?: {
    products: {
      edges: Array<{
        node: GraphQLProductNode;
      }>;
    };
    collection?: {
      products: {
        edges: Array<{
          node: GraphQLProductNode;
        }>;
      };
    };
  };
  errors?: unknown[];
}

interface GraphQLCollectionNode {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

interface GraphQLCollectionsData {
  data?: {
    collections: {
      edges: Array<{
        node: GraphQLCollectionNode;
      }>;
    };
  };
  errors?: unknown[];
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

interface Category {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('🔥 [admin.api.bundle-data] Request received');
  
  try {
    const { session, storeHash } = await authenticateAdmin(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    console.log('🔥 [admin.api.bundle-data] Action:', action, 'Store:', storeHash);

    // Fetch products
    if (action === "products") {
      const categoryId = url.searchParams.get("categoryId");
      const query = url.searchParams.get("query") || "";

      let apiPath = `/catalog/products?include=variants,images&is_visible=true&limit=50`;
      if (query) {
        apiPath += `&keyword=${encodeURIComponent(query)}`;
      }
      if (categoryId) {
        apiPath += `&categories:in=${encodeURIComponent(categoryId)}`;
      }

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
      });
    }

    // Fetch collections/categories
    if (action === "categories") {
      const categoriesResponse = await bigcommerceApi(storeHash, `/catalog/categories?is_visible=true&limit=50`);
      const categoriesData = await categoriesResponse.json();

      const categories: Category[] = (categoriesData.data || []).map((c: Record<string, unknown>) => ({
        id: String(c.id),
        title: (c.name as string) || 'Untitled Category',
        handle: ((c.custom_url as { url?: string })?.url || `/${c.id}/`).replace(/^\/|\/$/g, ''),
        productsCount: 0, // BigCommerce categories API does not return product count directly
      }));

      return json({
        success: true,
        categories
      });
    }

    // Invalid action
    console.error('🔥 [admin.api.bundle-data] Invalid action:', action);
    return json({ 
      success: false, 
      error: 'Invalid action parameter',
      products: []
    }, { status: 400 });

  } catch (error: unknown) {
    console.error('🔥 [admin.api.bundle-data] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      products: []
    }, { status: 500 });
  }
};
