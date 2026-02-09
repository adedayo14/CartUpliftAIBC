import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

/**
 * Admin API endpoint for bundle management data fetching
 * Uses /admin/api/ pattern for proper Shopify embedded app authentication
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
    const { session, admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    
    console.log('🔥 [admin.api.bundle-data] Action:', action, 'Shop:', session.shop);

    // Fetch products
    if (action === "products") {
      const categoryId = url.searchParams.get("categoryId");
      const query = url.searchParams.get("query") || "";

      let graphqlQuery = `
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

      if (categoryId) {
        graphqlQuery = `
          #graphql
          query getProductsByCollection($id: ID!, $query: String!) {
            collection(id: $id) {
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
          }
        `;
      }

      const variables = categoryId 
        ? { id: categoryId, query: query || "status:active" } 
        : { query: query || "status:active" };

      console.log('🔥 [admin.api.bundle-data] Fetching products with variables:', variables);

      // Add timeout protection
      const graphqlPromise = admin.graphql(graphqlQuery, { variables });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Products request timed out')), 10000)
      );

      const response = await Promise.race([graphqlPromise, timeoutPromise]) as Response;
      
      if (!response.ok) {
        console.error('🔥 [admin.api.bundle-data] GraphQL request failed:', response.status);
        return json({ 
          success: false, 
          error: `GraphQL request failed with status ${response.status}`,
          products: []
        }, { status: 500 });
      }

      const responseJson = await response.json() as GraphQLProductsData;

      if (responseJson.errors) {
        console.error('🔥 [admin.api.bundle-data] GraphQL errors:', responseJson.errors);
        return json({
          success: false,
          error: 'GraphQL query failed',
          products: [],
          graphqlErrors: responseJson.errors
        }, { status: 500 });
      }

      let productEdges = [];
      if (categoryId) {
        productEdges = responseJson.data?.collection?.products?.edges || [];
      } else {
        productEdges = responseJson.data?.products?.edges || [];
      }

      console.log(`🔥 [admin.api.bundle-data] Successfully fetched ${productEdges.length} products`);

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
      });
    }

    // Fetch collections/categories
    if (action === "categories") {
      console.log('🔥 [admin.api.bundle-data] Fetching collections');
      
      const graphqlPromise = admin.graphql(`
        #graphql
        query getCollections {
          collections(first: 100) {
            edges {
              node {
                id
                title
                handle
                productsCount
              }
            }
          }
        }
      `);

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Collections request timed out')), 10000)
      );

      const response = await Promise.race([graphqlPromise, timeoutPromise]) as Response;
      
      if (!response.ok) {
        console.error('🔥 [admin.api.bundle-data] Collections request failed:', response.status);
        return json({ 
          success: false, 
          error: 'Failed to fetch collections',
          categories: []
        }, { status: 500 });
      }

      const responseJson = await response.json() as GraphQLCollectionsData;

      if (responseJson.errors) {
        console.error('🔥 [admin.api.bundle-data] Collections GraphQL errors:', responseJson.errors);
        return json({
          success: false,
          error: 'Failed to fetch collections',
          categories: []
        }, { status: 500 });
      }

      const collectionEdges = responseJson.data?.collections?.edges || [];
      console.log(`🔥 [admin.api.bundle-data] Successfully fetched ${collectionEdges.length} collections`);

      const categories: Category[] = collectionEdges.map((edge: { node: GraphQLCollectionNode }) => ({
        id: edge.node.id,
        title: edge.node.title,
        handle: edge.node.handle,
        productsCount: edge.node.productsCount
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
