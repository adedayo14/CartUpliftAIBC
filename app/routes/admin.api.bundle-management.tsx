import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prisma from "../db.server";
import { BUNDLE_TYPES } from "~/constants/bundle";

// GraphQL Response types
interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
}

interface GraphQLCollectionNode {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

interface GraphQLProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number;
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        inventoryQuantity: number;
      };
    }>;
  };
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
}

interface CollectionsGraphQLResponse {
  data?: {
    collections?: {
      edges: Array<{
        node: GraphQLCollectionNode;
      }>;
    };
  };
  errors?: GraphQLError[];
}

interface ProductsGraphQLResponse {
  data?: {
    products?: {
      edges: Array<{
        node: GraphQLProductNode;
      }>;
    };
    collection?: {
      products?: {
        edges: Array<{
          node: GraphQLProductNode;
        }>;
      };
    };
  };
  errors?: GraphQLError[];
}

interface CategoryResponse {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

interface ProductResponse {
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
  image: string | undefined;
}

interface BundleActionBody {
  action?: string;
  shop?: string;
  name?: string;
  description?: string;
  type?: string;
  bundleType?: string;
  discountType?: string;
  discountValue?: string | number;
  categoryIds?: string;
  collectionIds?: string;
  productIds?: string;
  minProducts?: string | number;
  minBundlePrice?: string | number;
  assignmentType?: string;
  assignedProducts?: string;
  bundleStyle?: string;
  selectMinQty?: string | number;
  selectMaxQty?: string | number;
  tierConfig?: string;
  allowDeselect?: string | boolean;
  hideIfNoML?: string | boolean;
  bundleId?: string;
  status?: string;
  [key: string]: unknown;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "repair-ai-bundles") {
      // Repair AI bundles that are missing product information
      const aiBundles = await prisma.bundle.findMany({
        where: { 
          shop: session.shop,
          type: { in: ['ml', 'ai_suggested'] },
          status: 'active'
        },
        include: {
          products: true
        }
      });

      const { getBundleInsights } = await import('../models/bundleInsights.server');
      const insights = await getBundleInsights({
        shop: session.shop,
        admin,
        orderLimit: 40,
        minPairOrders: 2
      });

      let repairedCount = 0;
      const results = [];

      for (const bundle of aiBundles) {
        // Skip if bundle already has products
        if (bundle.products && bundle.products.length > 0) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'already-has-products', productsCount: bundle.products.length });
          continue;
        }

        // For AI bundles without products, use the most popular ML bundle (first one after sorting)
        const matchingInsight = insights.bundles[0]; // Most popular bundle

        if (!matchingInsight || matchingInsight.productIds.length === 0) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'no-insights-available', availableInsights: insights.bundles.length });
          continue;
        }

        try {
          // Fetch product titles from Shopify
          const productGids = matchingInsight.productIds.map(id => `gid://shopify/Product/${id}`);
          const productDetailsQuery = `
            query getProducts($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                }
              }
            }
          `;
          
          const productsResponse = await admin.graphql(productDetailsQuery, {
            variables: { ids: productGids }
          });
          
          const productsData = await productsResponse.json();
          const products = productsData?.data?.nodes || [];

          // Update bundle with productIds
          await prisma.bundle.update({
            where: { id: bundle.id },
            data: {
              productIds: JSON.stringify(matchingInsight.productIds)
            }
          });

          // Create BundleProduct records
          const bundleProducts = matchingInsight.productIds.map((productId: string, index: number) => {
            const productNode = products.find((p: any) => p?.id?.includes(productId));
            return {
              bundleId: bundle.id,
              productId: String(productId),
              productTitle: productNode?.title || matchingInsight.productTitles[index] || `Product ${productId}`,
              position: index,
              required: index === 0
            };
          });

          await prisma.bundleProduct.createMany({
            data: bundleProducts
          });

          repairedCount++;
          results.push({ 
            bundleId: bundle.id, 
            name: bundle.name, 
            status: 'repaired', 
            productsAdded: bundleProducts.length,
            mlBundleUsed: matchingInsight.name,
            products: bundleProducts.map(p => ({ id: p.productId, title: p.productTitle }))
          });
        } catch (error) {
          results.push({ bundleId: bundle.id, name: bundle.name, status: 'error', error: String(error) });
        }
      }

      return json({ 
        success: true, 
        message: `Repaired ${repairedCount} AI bundles`,
        repairedCount,
        totalMLBundlesAvailable: insights.bundles.length,
        results 
      });
    }

    if (action === "bundles") {
      // Get all bundles for the shop
      const bundles = await prisma.bundle.findMany({
        where: { shop: session.shop },
        include: {
          bundles: true  // Include BundleProduct relations
        },
        orderBy: { createdAt: 'desc' }
      });

      return json({ success: true, bundles });
    }

    if (action === "categories") {
      // Get shop categories via GraphQL (use already authenticated admin client)
      // Add timeout protection
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
        console.error('🔥 Collections GraphQL request failed:', response.status);
        return json({ 
          success: false, 
          error: 'Failed to fetch collections from Shopify',
          categories: []
        }, { status: 500 });
      }

      const responseJson = await response.json() as CollectionsGraphQLResponse;

      if (responseJson.errors) {
        console.error('🔥 Collections GraphQL errors:', responseJson.errors);
        return json({
          success: false,
          error: 'Failed to fetch collections from Shopify',
          categories: []
        }, { status: 500 });
      }

      const collections = responseJson.data?.collections?.edges || [];

      return json({
        success: true,
        categories: collections.map((edge): CategoryResponse => ({
          id: edge.node.id,
          title: edge.node.title,
          handle: edge.node.handle,
          productsCount: edge.node.productsCount
        }))
      });
    }

    if (action === "products") {
      const categoryId = url.searchParams.get("categoryId");
      const query = url.searchParams.get("query") || "";
      // Use already authenticated admin client

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

      // Add timeout protection
      const graphqlPromise = admin.graphql(graphqlQuery, { variables });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Products request timed out')), 10000)
      );

      const response = await Promise.race([graphqlPromise, timeoutPromise]) as Response;
      
      if (!response.ok) {
        console.error('🔥 Products GraphQL request failed:', response.status);
        return json({ 
          success: false, 
          error: 'Failed to fetch products from Shopify',
          products: []
        }, { status: 500 });
      }

      const responseJson = await response.json() as ProductsGraphQLResponse;

      if (responseJson.errors) {
        console.error('🔥 Products GraphQL errors:', responseJson.errors);
        return json({
          success: false,
          error: 'GraphQL query failed',
          products: []
        }, { status: 500 });
      }

      let products = [];
      if (categoryId) {
        products = responseJson.data?.collection?.products?.edges || [];
      } else {
        products = responseJson.data?.products?.edges || [];
      }

      return json({
        success: true,
        products: products.map((edge): ProductResponse => ({
          id: edge.node.id,
          title: edge.node.title,
          handle: edge.node.handle,
          status: edge.node.status,
          totalInventory: edge.node.totalInventory,
          variants: edge.node.variants.edges.map((v) => ({
            id: v.node.id,
            title: v.node.title,
            price: parseFloat(v.node.price),
            inventoryQuantity: v.node.inventoryQuantity
          })),
          price: edge.node.variants.edges[0]?.node?.price || "0.00",
          image: edge.node.featuredImage?.url
        }))
      });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("🔥 Bundle management loader error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to load data";
    return json({
      success: false,
      error: errorMessage,
      products: action === "products" ? [] : undefined,
      categories: action === "categories" ? [] : undefined
    }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Support both JSON and FormData bodies
  let actionType: string | null;
  let body: BundleActionBody = {};
  let shop: string | undefined;
  let admin;

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      body = await request.json() as BundleActionBody;
      actionType = body.action || null;
      shop = body.shop; // Get shop from payload like settings API
    } catch (e: unknown) {
      console.error('[Bundle API Action] JSON parse error:', e);
      return json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    actionType = formData.get('action')?.toString() || null;
    shop = formData.get('shop')?.toString();
    formData.forEach((v, k) => { body[k] = v; });
  }

  // Always authenticate to get admin API access
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;
    admin = auth.admin;
    // Use shop from payload if provided, otherwise from session
    if (!shop) {
      shop = session.shop;
    }
  } catch (authError: unknown) {
    const errorMessage = authError instanceof Error ? authError.message : 'Unknown error';
    console.error('[Bundle API Action] ❌ Authentication failed:', errorMessage);
    return json({ success: false, error: 'Authentication failed' }, { status: 401 });
  }

  try {
    if (actionType === 'fix-bundle-ids') {
      // Fix existing bundles with gid:// prefixes
      const bundles = await prisma.bundle.findMany({
        where: {
          shop: shop,
          assignedProducts: { not: null }
        }
      });

      let updatedCount = 0;
      for (const bundle of bundles) {
        if (!bundle.assignedProducts) continue;

        const productIds = JSON.parse(bundle.assignedProducts) as string[];
        const hasPrefix = productIds.some((id: string) => id.startsWith('gid://'));

        if (hasPrefix) {
          const cleanedIds = productIds.map((id: string) =>
            id.replace('gid://shopify/Product/', '')
          );

          await prisma.bundle.update({
            where: { id: bundle.id },
            data: { assignedProducts: JSON.stringify(cleanedIds) }
          });
          updatedCount++;
        }
      }

      return json({ success: true, updatedCount });
    }
    
    if (actionType === 'create-bundle') {
      const name = (body.name as string) || '';
      const description = (body.description as string) || '';
      const rawType = (body.type as string) || (body.bundleType as string) || BUNDLE_TYPES.ML;
      const type = rawType === BUNDLE_TYPES.AI_SUGGESTED ? BUNDLE_TYPES.ML : rawType;
      const discountType = (body.discountType as string) || 'percentage';
      const parsedDiscountValue = parseFloat(String(body.discountValue));
      const discountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0;
      const collectionIds = (body.categoryIds as string) || (body.collectionIds as string) || '[]';
      const productIds = (body.productIds as string) || '[]';
      const minProducts = body.minProducts ? parseInt(String(body.minProducts)) : null;
      const minBundlePrice = body.minBundlePrice ? parseFloat(String(body.minBundlePrice)) : null;
      const assignmentType = (body.assignmentType as string) || 'specific';
      
      // NEW FIELDS - Enhanced bundle features
      const assignedProducts = (body.assignedProducts as string) || '[]';  // Default to empty array JSON string
      const bundleStyle = (body.bundleStyle as string) || 'grid';
      const selectMinQty = body.selectMinQty ? parseInt(String(body.selectMinQty)) : null;
      const selectMaxQty = body.selectMaxQty ? parseInt(String(body.selectMaxQty)) : null;
      const tierConfig = (body.tierConfig as string) || '[]';  // Default to empty array JSON string
      const allowDeselect = body.allowDeselect !== undefined ? String(body.allowDeselect) === 'true' : true;
      const hideIfNoML = body.hideIfNoML !== undefined ? String(body.hideIfNoML) === 'true' : false;

      if (!name || !type || discountValue < 0) {
        return json({ success: false, error: "Invalid bundle data" }, { status: 400 });
      }

      // Create the bundle
      const bundle = await prisma.bundle.create({
        data: {
          shop: shop,
          name,
          description,
          type,
          discountType,
          discountValue,
          collectionIds,
          productIds,
          minProducts,
          minBundlePrice,
          assignmentType,
          // NEW FIELDS
          assignedProducts,  // Now defaults to '[]' instead of null
          bundleStyle,
          selectMinQty,
          selectMaxQty,
          tierConfig,
          allowDeselect,
          hideIfNoML,
          status: 'active'  // Start as active so it shows immediately
        }
      });

      // Add products to bundle if provided
      if (productIds) {
        try {
          const productIdArray = JSON.parse(productIds) as string[];
          if (Array.isArray(productIdArray) && productIdArray.length > 0) {
            const bundleProducts = productIdArray.map((productId: string, index: number) => ({
              bundleId: bundle.id,
              productId,
              position: index,
              required: index === 0 // First product is required by default
            }));

            await prisma.bundleProduct.createMany({
              data: bundleProducts
            });
          }
        } catch (e: unknown) {
          console.warn("Failed to parse product IDs:", e);
        }
      }
      
      // For AI/ML bundles without products, try to fetch from ML insights and store them
      if ((type === 'ml' || type === 'ai_suggested') && (!productIds || productIds === '[]')) {
        try {
          const { getBundleInsights } = await import('../models/bundleInsights.server');
          const insights = await getBundleInsights({
            shop,
            admin,
            orderLimit: 40,
            minPairOrders: 2
          });
          
          // Find matching bundle by name
          const matchingInsight = insights.bundles.find(b => 
            b.name.toLowerCase().includes(name.toLowerCase()) || 
            name.toLowerCase().includes(b.name.toLowerCase())
          );
          
          if (matchingInsight && matchingInsight.productIds.length > 0) {
            console.log(`🔍 Found ML insights for "${name}":`, matchingInsight.productIds);
            
            // Store product IDs in the bundle
            await prisma.bundle.update({
              where: { id: bundle.id },
              data: {
                productIds: JSON.stringify(matchingInsight.productIds)
              }
            });
            
            // Fetch product titles from Shopify
            const productGids = matchingInsight.productIds.map(id => `gid://shopify/Product/${id}`);
            const productDetailsQuery = `
              query getProducts($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on Product {
                    id
                    title
                  }
                }
              }
            `;
            
            const productsResponse = await admin.graphql(productDetailsQuery, {
              variables: { ids: productGids }
            });
            
            const productsData = await productsResponse.json();
            const products = productsData?.data?.nodes || [];
            
            // Create BundleProduct records with titles
            const bundleProducts = matchingInsight.productIds.map((productId: string, index: number) => {
              const productNode = products.find((p: any) => p?.id?.includes(productId));
              return {
                bundleId: bundle.id,
                productId: String(productId),
                productTitle: productNode?.title || matchingInsight.productTitles[index] || `Product ${productId}`,
                position: index,
                required: index === 0
              };
            });
            
            await prisma.bundleProduct.createMany({
              data: bundleProducts
            });
            
            console.log(`✅ Stored ${bundleProducts.length} products for AI bundle "${name}"`);
          }
        } catch (error) {
          console.warn(`⚠️ Could not fetch ML insights for AI bundle "${name}":`, error);
        }
      }

      return json({ success: true, bundle });
    }

    if (actionType === 'update-bundle') {
      const bundleId = (body.bundleId as string);
      const name = (body.name as string);
      const description = (body.description as string);
      const status = (body.status as string);
      const discountType = (body.discountType as string) || 'percentage';
      const parsedDiscountValue = parseFloat(String(body.discountValue));
      const discountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0;
      const assignmentType = (body.assignmentType as string) || 'specific';
      const minProducts = body.minProducts ? parseInt(String(body.minProducts)) : null;
      const minBundlePrice = body.minBundlePrice ? parseFloat(String(body.minBundlePrice)) : null;
      const allowDeselect = body.allowDeselect !== undefined ? Boolean(body.allowDeselect) : true;
      const hideIfNoML = body.hideIfNoML !== undefined ? Boolean(body.hideIfNoML) : false;

      // Validation: Check for duplicate "show on all" bundles (only if changing to "all")
      if (assignmentType === 'all') {
        const currentBundle = await prisma.bundle.findUnique({
          where: { id: bundleId },
          select: { type: true, assignmentType: true }
        });

        // Only check if we're changing FROM specific TO all, or if it's already "all" and active
        if (currentBundle && (currentBundle.assignmentType !== 'all' || status === 'active')) {
          const existingShowAllBundle = await prisma.bundle.findFirst({
            where: {
              shop,
              type: currentBundle.type,
              assignmentType: 'all',
              status: 'active',
              id: { not: bundleId } // Exclude current bundle
            },
            select: { id: true, name: true }
          });

          if (existingShowAllBundle) {
            const bundleTypeLabel = currentBundle.type === 'manual' ? 'Manual' : 'AI';
            return json({
              success: false,
              error: `Only one ${bundleTypeLabel} bundle can show on all products. "${existingShowAllBundle.name}" is already active. Please pause or delete it first, or change this bundle to show on specific products.`
            }, { status: 400 });
          }
        }
      }

      const bundle = await prisma.bundle.update({
        where: { id: bundleId, shop: shop },
        data: {
          name,
          description,
          status,
          discountType,
          discountValue,
          assignmentType,
          minProducts,
          minBundlePrice,
          allowDeselect,
          hideIfNoML,
        }
      });

      return json({ success: true, bundle });
    }

    if (actionType === 'delete-bundle') {
      const bundleId = (body.bundleId as string);

      await prisma.bundle.delete({
        where: { id: bundleId, shop: shop }
      });

      return json({ success: true, message: "Bundle deleted successfully" });
    }

    if (actionType === 'toggle-status') {
      const bundleId = (body.bundleId as string);
      const status = (body.status as string);

      const bundle = await prisma.bundle.update({
        where: { id: bundleId, shop: shop },
        data: { status }
      });

      return json({ success: true, bundle });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    console.error("[Bundle API Action] Error:", error);
    if (error instanceof Error) {
      console.error("[Bundle API Action] Error stack:", error.stack);
    }
    const errorMessage = error instanceof Error ? error.message : "Failed to perform action";
    return json({ success: false, error: errorMessage }, { status: 500 });
  }
};