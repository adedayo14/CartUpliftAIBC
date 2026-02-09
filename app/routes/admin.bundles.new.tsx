import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import type { PrismaClient } from "@prisma/client";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Text,
  Select,
  Toast,
  Frame,
  FormLayout,
  Checkbox,
  Button,
  InlineStack,
  Icon,
  Banner,
  Badge,
  ResourceList,
  ResourceItem,
  Thumbnail,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { formatMoney } from "../utils/formatters";
import prisma from "../db.server";
import { BUNDLE_TYPES, BUNDLE_STATUS, DISCOUNT_TYPES } from "~/constants/bundle";
import "../styles/admin-bundles.css";

// GraphQL type definitions
interface GraphQLProductNode {
  id: string;
  title: string;
  variants: {
    edges: Array<{
      node: {
        price: string;
      };
    }>;
  };
  featuredMedia?: {
    preview: {
      image: {
        url: string;
      };
    };
  };
}

interface GraphQLProductEdge {
  node: GraphQLProductNode;
}

interface GraphQLProductsResponse {
  data?: {
    products: {
      edges: GraphQLProductEdge[];
    };
  };
  errors?: unknown[];
}

interface GraphQLCollectionNode {
  id: string;
  title: string;
  productsCount: number | { count: number };
}

interface GraphQLCollectionEdge {
  node: GraphQLCollectionNode;
}

interface GraphQLCollectionsResponse {
  data?: {
    collections: {
      edges: GraphQLCollectionEdge[];
    };
  };
  errors?: unknown[];
}

interface BundleFormData {
  name: string;
  description: string;
  type: string;
  status: string;
  discountType: string;
  discountValue: number;
  minProducts: number;
  minBundlePrice: number | null;
  allowDeselect: boolean;
  hideIfNoML: boolean;
  productIds: string | null;
  collectionIds: string | null;
  assignedProducts: string;
  assignmentType: string;
}

interface Product {
  id: string;
  title: string;
  price: string;
  image: string;
}

interface Collection {
  id: string;
  title: string;
  productsCount: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const { shop } = session;

    let collections: Collection[] = [];
    let products: Product[] = [];
    let currencyCode = 'USD';

    // Fetch shop currency
    try {
      const shopRes = await admin.graphql(`
        #graphql
        query shopInfo { 
          shop { 
            currencyCode 
          } 
        }
      `);
      const shopData = await shopRes.json();
      currencyCode = shopData.data?.shop?.currencyCode || 'USD';
    } catch (err) {
    }

    // Fetch products
    try {
      const productsRes = await admin.graphql(`
        #graphql
        query getProducts {
          products(first: 50) {
            edges {
              node {
                id
                title
                variants(first: 1) {
                  edges { 
                    node { 
                      price 
                    } 
                  }
                }
                featuredMedia { 
                  preview { 
                    image { 
                      url 
                    } 
                  } 
                }
              }
            }
          }
        }
      `);
      const productsData = await productsRes.json() as GraphQLProductsResponse;

      if (productsData.errors) {
      }

      if (productsData.data?.products?.edges) {
        products = productsData.data.products.edges
          .filter((edge: GraphQLProductEdge) => edge?.node)
          .map((edge: GraphQLProductEdge) => {
            const node = edge.node;
            const variant = node.variants?.edges?.[0]?.node;
            const mediaImage = node.featuredMedia?.preview?.image;
            return {
              id: node.id,
              title: node.title || 'Untitled Product',
              price: variant?.price || '0.00',
              image: mediaImage?.url || 'https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png'
            };
          });
      }
    } catch (error: unknown) {
    }

    // Fetch collections
    try {
      const collectionsRes = await admin.graphql(`
        #graphql
        query getCollections {
          collections(first: 50) {
            edges { 
              node { 
                id 
                title 
                productsCount {
                  count
                }
              } 
            }
          }
        }
      `);
      const collectionsData = await collectionsRes.json() as GraphQLCollectionsResponse;

      if (collectionsData.errors) {
      }

      if (collectionsData.data?.collections?.edges) {
        collections = collectionsData.data.collections.edges
          .filter((edge: GraphQLCollectionEdge) => edge?.node)
          .map((edge: GraphQLCollectionEdge) => ({
            id: edge.node.id,
            title: edge.node.title || 'Untitled Collection',
            productsCount: typeof edge.node.productsCount === 'number' 
              ? edge.node.productsCount 
              : (edge.node.productsCount?.count || 0)
          }));
      }
    } catch (error: unknown) {
    }

    return json({ shop, collections, products, currencyCode });
  } catch (error: unknown) {
    console.error('[admin.bundles.new] Loader error:', error);
    // Return empty data instead of throwing to prevent 500 error
    return json({ 
      shop: 'unknown',
      collections: [], 
      products: [], 
      currencyCode: 'USD' 
    }, { status: 200 });
  }
};

// Add action handler to process form submission server-side
export const action = async ({ request }: ActionFunctionArgs) => {
  let shop = 'unknown';

  try {
    const { session } = await authenticate.admin(request);
    shop = session.shop;

    // Handle both JSON and FormData
    const contentType = request.headers.get('content-type') || '';
    let actionType: string | null = null;
    let bundleData: Partial<BundleFormData> = {};

    if (contentType.includes('application/json')) {
      const body = await request.json();
      actionType = body.action;

      if (actionType === 'create-bundle') {
        bundleData = {
          name: body.name || '',
          description: body.description || '',
          type: body.type || BUNDLE_TYPES.ML,
          status: body.status || BUNDLE_STATUS.ACTIVE,
          discountType: body.discountType || DISCOUNT_TYPES.PERCENTAGE,
          discountValue: parseFloat(body.discountValue) || 0,
          minProducts: parseInt(body.minProducts) || 2,
          minBundlePrice: body.minBundlePrice ? parseFloat(body.minBundlePrice) : null,
          allowDeselect: body.allowDeselect === true,
          hideIfNoML: body.hideIfNoML === true,
          productIds: body.productIds || null,
          collectionIds: body.collectionIds || null,
          assignedProducts: body.assignedProducts || '[]',
          assignmentType: body.assignmentType || 'all',
        };
      }
    } else {
      const formData = await request.formData();
      actionType = formData.get('action')?.toString() || null;

      if (actionType === 'create-bundle') {
        bundleData = {
          name: formData.get('name')?.toString() || '',
          description: formData.get('description')?.toString() || '',
          type: formData.get('type')?.toString() || BUNDLE_TYPES.ML,
          status: formData.get('status')?.toString() || BUNDLE_STATUS.ACTIVE,
          discountType: formData.get('discountType')?.toString() || DISCOUNT_TYPES.PERCENTAGE,
          discountValue: parseFloat(formData.get('discountValue')?.toString() || '0'),
          minProducts: parseInt(formData.get('minProducts')?.toString() || '2'),
          minBundlePrice: formData.get('minBundlePrice')?.toString() ? parseFloat(formData.get('minBundlePrice')!.toString()) : null,
          allowDeselect: formData.get('allowDeselect') === 'true',
          hideIfNoML: formData.get('hideIfNoML') === 'true',
          productIds: formData.get('productIds')?.toString() || null,
          collectionIds: formData.get('collectionIds')?.toString() || null,
          assignedProducts: formData.get('assignedProducts')?.toString() || '[]',
          assignmentType: formData.get('assignmentType')?.toString() || 'all',
        };
      }
    }

    if (actionType === 'create-bundle') {
      // Validation: Check for duplicate "show on all" bundles
      if (bundleData.assignmentType === 'all') {
        const existingShowAllBundle = await (prisma as unknown as PrismaClient).bundle.findFirst({
          where: {
            shop,
            type: bundleData.type,
            assignmentType: 'all',
            status: 'active'
          },
          select: { id: true, name: true }
        });

        if (existingShowAllBundle) {
          const bundleTypeLabel = bundleData.type === 'manual' ? 'Manual' : 'AI';
          return json({
            success: false,
            error: `Only one ${bundleTypeLabel} bundle can show on all products. "${existingShowAllBundle.name}" is already active. Please pause or delete it first, or change this bundle to show on specific products.`
          }, { status: 400 });
        }
      }

      // Create bundle in database
      const bundle = await (prisma as unknown as PrismaClient).bundle.create({
        data: {
          shop,
          ...bundleData,
        },
      });

      // Redirect to bundles list after successful creation
      return redirect('/admin/bundles');
    }
  
    return json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[admin.bundles.new] Action auth error:', error);
    return json({ success: false, error: 'Session expired. Please refresh the page.' }, { status: 401 });
  }
};

export default function BundleCreate() {
  const BUILD_VERSION = 'v14.0.0-BUNDLE-TYPE-CLARITY';

  const [authParams, setAuthParams] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setAuthParams(window.location.search);
    }
  }, []);
  
  // Feature flags - set to true to show advanced fields
  const SHOW_MINIMUM_FIELDS = false;
  const SHOW_ADVANCED_OPTIONS = false;
  
  const { shop, collections, products, currencyCode } = useLoaderData<typeof loader>();
  
  const [isSaving, setIsSaving] = useState(false);
  
  // Remove fetcher response handler since we're using direct fetch now

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState(BUNDLE_TYPES.ML);
  const [status, setStatus] = useState(BUNDLE_STATUS.ACTIVE);
  const [discountType, setDiscountType] = useState(DISCOUNT_TYPES.PERCENTAGE);
  const [discountValue, setDiscountValue] = useState("0");
  const [minProducts, setMinProducts] = useState("2");
  const [minBundlePrice, setMinBundlePrice] = useState("");
  const [allowDeselect, setAllowDeselect] = useState(true);
  const [hideIfNoML, setHideIfNoML] = useState(false);
  const [assignmentType, setAssignmentType] = useState<"all" | "specific">("specific");
  
  // Product/Collection selection
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>(""); // Changed to single string
  const [assignedProducts, setAssignedProducts] = useState<string[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [assignmentSearchQuery, setAssignmentSearchQuery] = useState("");
  const [bundleSearchQuery, setBundleSearchQuery] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showBundleProductPicker, setShowBundleProductPicker] = useState(false);
  
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const bundleTypeOptions = [
    { label: "Manual Selection (FBT Logic)", value: BUNDLE_TYPES.MANUAL },
    { label: "AI-Powered (Smart Recommendations)", value: BUNDLE_TYPES.ML },
    { label: "Collection-Based (Complete the Set)", value: BUNDLE_TYPES.COLLECTION },
  ];

  const discountTypeOptions = [
    { label: "Percentage", value: DISCOUNT_TYPES.PERCENTAGE },
    { label: "Fixed Amount", value: DISCOUNT_TYPES.FIXED },
  ];

  const currencySymbol = currencyCode === 'USD' ? '$' : currencyCode;

  // Filter products based on search
  const filteredProducts = useMemo(() => {
    if (!productSearchQuery) return products;
    const query = productSearchQuery.toLowerCase();
    return products.filter(p => p.title.toLowerCase().includes(query));
  }, [products, productSearchQuery]);

  // Filter products for assignment modal
  const filteredAssignmentProducts = useMemo(() => {
    if (!assignmentSearchQuery) return products;
    const query = assignmentSearchQuery.toLowerCase();
    return products.filter(p => p.title.toLowerCase().includes(query));
  }, [products, assignmentSearchQuery]);

  // Filter products for bundle contents modal
  const filteredBundleProducts = useMemo(() => {
    if (!bundleSearchQuery) return products;
    const query = bundleSearchQuery.toLowerCase();
    return products.filter(p => p.title.toLowerCase().includes(query));
  }, [products, bundleSearchQuery]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setToast({ content: "Bundle name is required", error: true });
      return;
    }

    if (type === BUNDLE_TYPES.MANUAL && selectedProducts.length === 0) {
      setToast({ content: "Please select at least 1 product for manual bundles", error: true });
      return;
    }

    if (type === BUNDLE_TYPES.MANUAL && selectedProducts.length > 2) {
      setToast({ content: "Manual bundles limited to 2 additional products (3 total with current product)", error: true });
      return;
    }

    if (type === BUNDLE_TYPES.COLLECTION && !selectedCollection) {
      setToast({ content: "Please select a collection", error: true });
      return;
    }

    if (assignmentType === "specific" && assignedProducts.length === 0) {
      setToast({ content: "Please assign this bundle to at least one product page", error: true });
      return;
    }

    setIsSaving(true);
    
    try {
      const currentAuthParams = authParams || (typeof window !== 'undefined' ? window.location.search : '');
      const payload = {
        action: 'create-bundle',
        shop, // Include shop in payload for authentication
        name: name.trim(),
        description: description.trim(),
        type,
        status,
        discountType,
        discountValue,
        minProducts,
        minBundlePrice: minBundlePrice || undefined,
        allowDeselect,
        hideIfNoML,
        productIds: type === BUNDLE_TYPES.MANUAL ? JSON.stringify(selectedProducts) : null,
        collectionIds: type === BUNDLE_TYPES.COLLECTION ? JSON.stringify([selectedCollection]) : null,
        assignedProducts: assignmentType === "all" ? JSON.stringify([]) : JSON.stringify(assignedProducts),
        assignmentType,
      };

      // Use XMLHttpRequest to avoid Remix interception in Shopify embedded apps
      const xhr = new XMLHttpRequest();
      const apiEndpoint = '/admin/api/bundle-management' + currentAuthParams;

      const xhrPromise = new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        xhr.open('POST', apiEndpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              resolve(result);
            } catch (parseError) {
              reject(new Error('Failed to parse server response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}: ${xhr.statusText}`));
          }
        };

        xhr.onerror = function() {
          reject(new Error('Network request failed'));
        };

        xhr.onabort = function() {
          reject(new Error('Request was aborted'));
        };

        xhr.ontimeout = function() {
          reject(new Error('Request timed out'));
        };

        xhr.timeout = 30000; // 30 second timeout

        try {
          xhr.send(JSON.stringify(payload));
        } catch (sendError) {
          reject(sendError);
        }
      });

      const result = await xhrPromise;

      if (result.success) {
        setToast({ content: "Bundle created successfully!" });

        // Use window.location for reliable navigation with auth params
        setTimeout(() => {
          window.location.href = '/admin/bundles' + currentAuthParams;
        }, 500); // Brief delay to show toast
      } else {
        const errorMsg = result.error || "Failed to create bundle";
        setToast({ content: errorMsg, error: true });
      }
    } catch (error: unknown) {
      console.error('[admin.bundles.new] Save error:', error);
      setToast({ content: "Failed to create bundle. Please try again.", error: true });
    } finally {
      setIsSaving(false);
    }
  }, [authParams, shop, name, description, type, status, discountType, discountValue, minProducts, minBundlePrice, allowDeselect, hideIfNoML, selectedProducts, selectedCollection, assignedProducts, assignmentType]);

  return (
    <Frame>
      <Page
        title="Create FBT"
        backAction={{
          url: "/admin/bundles" + authParams,
        }}
        primaryAction={{
          content: "Create FBT",
          onAction: handleSave,
          loading: isSaving,
          disabled: !name.trim() || isSaving,
        }}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Bundle Details
                  </Text>
                
                <FormLayout>
                  {(collections.length === 0 && products.length === 0) && (
                    <Banner tone="critical">
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          No Products or Collections Found
                        </Text>
                        <Text as="p" variant="bodySm">
                          The GraphQL API is not returning any data. Please navigate to <strong>/admin/debug</strong> to see the actual API response and troubleshoot. 
                          Possible causes: products not published, authentication issues, or empty store.
                        </Text>
                      </BlockStack>
                    </Banner>
                  )}

                  <TextField
                    label="Bundle Name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    placeholder="e.g., Summer Essentials Pack"
                    helpText="Bundle names are for internal use only."
                    requiredIndicator
                    disabled={isSaving}
                  />
                  
                  <TextField
                    label="Description"
                    value={description}
                    onChange={setDescription}
                    autoComplete="off"
                    multiline={2}
                    placeholder="Brief description of the bundle (optional)"
                    disabled={isSaving}
                  />
                  
                  <Select
                    label="Bundle Type"
                    options={bundleTypeOptions}
                    value={type}
                    onChange={setType}
                    helpText={
                      type === BUNDLE_TYPES.MANUAL
                        ? "Hand-pick specific products. Each product page displays that product bundled with your selections"
                        : type === BUNDLE_TYPES.ML
                        ? "AI analyzes purchase patterns to recommend products. Shows: Current product + 2 AI picks = 3 total"
                        : "AI selects 2 products from chosen collection. Shows: Current product + 2 from collection = 3 total"
                    }
                    disabled={isSaving}
                  />

                  {/* Product Selection for Manual Bundles - RIGHT AFTER Bundle Type */}
                  {type === BUNDLE_TYPES.MANUAL && (
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">Bundle Contents</Text>
                        <Banner tone="info" hideIcon>
                          <Text as="p" variant="bodySm">
                            Select up to 2 products to bundle with the current product.
                          </Text>
                        </Banner>

                        {products.length === 0 ? (
                          <Banner tone="warning" hideIcon>
                            <p>No products available. Add products to your store first.</p>
                          </Banner>
                        ) : (
                          <>
                            {selectedProducts.length === 0 && (
                              <Card background="bg-surface-caution">
                                <BlockStack gap="200">
                                  <Text as="h3" variant="headingMd">Products Required</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Choose which products to include in this bundle
                                  </Text>
                                  <Button
                                    onClick={() => setShowBundleProductPicker(true)}
                                    disabled={isSaving}
                                  >
                                    Select Bundle Products
                                  </Button>
                                </BlockStack>
                              </Card>
                            )}

                            {selectedProducts.length > 0 && (
                              <Card background="bg-surface-success">
                                <BlockStack gap="200">
                                  <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="200" blockAlign="center">
                                      <Icon source={CheckIcon} tone="success" />
                                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                                        {selectedProducts.length}/2 products selected
                                      </Text>
                                    </InlineStack>
                                    <Button
                                      size="micro"
                                      onClick={() => setShowBundleProductPicker(true)}
                                      disabled={isSaving}
                                    >
                                      Change
                                    </Button>
                                  </InlineStack>
                                  {selectedProducts.length >= 2 && (
                                    <Text as="p" variant="bodySm" tone="success">
                                      ✓ Maximum reached (Current product + 2 = 3 total)
                                    </Text>
                                  )}
                                </BlockStack>
                              </Card>
                            )}
                          </>
                        )}
                      </BlockStack>
                    </Card>
                  )}

                  {/* Collection Selection for Collection-Based Bundles */}
                  {type === BUNDLE_TYPES.COLLECTION && (
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">Select Collection</Text>
                        <Banner tone="info" hideIcon>
                          <Text as="p" variant="bodySm">
                            AI selects 2 products from this collection based on purchase patterns.
                          </Text>
                        </Banner>
                        {collections.length === 0 ? (
                          <Banner tone="warning" hideIcon>
                            <p>No collections available. Create collections in your store first.</p>
                          </Banner>
                        ) : (
                          <Select
                            label="Choose collection"
                            options={[
                              { label: "Select a collection...", value: "" },
                              ...collections.map((collection) => ({
                                label: `${collection.title} (${collection.productsCount} products)`,
                                value: collection.id
                              }))
                            ]}
                            value={selectedCollection}
                            onChange={setSelectedCollection}
                            disabled={isSaving}
                            helpText="Select ONE collection for AI to choose products from"
                          />
                        )}
                      </BlockStack>
                    </Card>
                  )}

                  {/* Show bundle on (assignment type) */}
                  <Select
                    label="Show bundle on"
                    options={[
                      { label: "All product pages", value: "all" },
                      { label: "Specific product pages", value: "specific" },
                    ]}
                    value={assignmentType}
                    onChange={(v) => setAssignmentType(v as "all" | "specific")}
                    disabled={isSaving}
                    helpText="Choose where this bundle should appear"
                  />

                  {assignmentType === "all" && (
                    <Banner tone="info" hideIcon>
                      <Text as="p" variant="bodyMd">This bundle will appear on all product pages in your store</Text>
                    </Banner>
                  )}

                  {/* Product Assignment - Show for specific pages BEFORE discount fields */}
                  {assignmentType === "specific" && assignedProducts.length === 0 && (
                    <Card background="bg-surface-caution">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingMd">Product Assignment Required</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Choose which product pages should display this bundle
                        </Text>
                        <Button
                          onClick={() => setShowProductPicker(true)}
                          disabled={isSaving}
                        >
                          Select Product Pages
                        </Button>
                        {products.length === 0 && (
                          <Text as="p" variant="bodySm" tone="critical">
                            ⚠️ No products found. Please check /admin/debug to troubleshoot.
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  )}

                  {assignmentType === "specific" && assignedProducts.length > 0 && (
                    <Card background="bg-surface-success">
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Icon source={CheckIcon} tone="success" />
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              Assigned to {assignedProducts.length} product page{assignedProducts.length === 1 ? '' : 's'}
                            </Text>
                          </InlineStack>
                          <Button
                            size="micro"
                            onClick={() => setShowProductPicker(true)}
                            disabled={isSaving}
                          >
                            Change
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}

                  <FormLayout.Group>
                    <Select
                      label="Discount Type"
                      options={discountTypeOptions}
                      value={discountType}
                      onChange={setDiscountType}
                      disabled={isSaving}
                    />
                    <TextField
                      label="Discount Value"
                      value={discountValue}
                      onChange={setDiscountValue}
                      autoComplete="off"
                      type="number"
                      min="0"
                      max={discountType === DISCOUNT_TYPES.PERCENTAGE ? "100" : undefined}
                      suffix={discountType === DISCOUNT_TYPES.PERCENTAGE ? "%" : currencySymbol}
                      disabled={isSaving}
                    />
                  </FormLayout.Group>

                  <Banner tone="warning" hideIcon>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        Discount Setup Required
                      </Text>
                      <Text as="p" variant="bodySm">
                        Create a matching discount in Shopify Admin. Cart Uplift doesn't auto-generate discounts—this value is for display only.
                      </Text>
                    </BlockStack>
                  </Banner>

                  {/* Hidden for now - keep for future use. Set SHOW_MINIMUM_FIELDS=true to enable */}
                  {SHOW_MINIMUM_FIELDS && (
                    <BlockStack gap="300">
                      <Text as="p" variant="bodyMd" fontWeight="medium">
                        Bundle Requirements
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Set minimums to control when the bundle qualifies for discounts
                      </Text>
                      
                      <FormLayout.Group>
                        <TextField
                          label="Minimum Products (optional)"
                          type="number"
                          value={minProducts}
                          onChange={setMinProducts}
                          autoComplete="off"
                          disabled={isSaving}
                          helpText="Number of items required (quantity)"
                          min="2"
                          placeholder="e.g., 2"
                        />
                        <TextField
                          label="Minimum Bundle Price (optional)"
                          type="number"
                          value={minBundlePrice}
                          onChange={setMinBundlePrice}
                          autoComplete="off"
                          disabled={isSaving}
                          helpText="Total cart value required"
                          prefix={currencySymbol}
                          placeholder="e.g., 50.00"
                        />
                      </FormLayout.Group>
                    </BlockStack>
                  )}

                  {/* Hidden - these are now defaults: allowDeselect=true, hideIfNoML=false 
                      Set SHOW_ADVANCED_OPTIONS=true to enable */}
                  {SHOW_ADVANCED_OPTIONS && (
                    <BlockStack gap="300">
                      <Checkbox
                        label="Allow customers to deselect bundle items"
                        checked={allowDeselect}
                        onChange={setAllowDeselect}
                        disabled={isSaving}
                        helpText="Let customers customize which products they want from the bundle"
                      />
                      <Checkbox
                        label="Hide bundle if no AI recommendations available"
                        checked={hideIfNoML}
                        onChange={setHideIfNoML}
                        disabled={isSaving}
                        helpText="Only show this bundle when AI can find suitable product recommendations"
                      />
                    </BlockStack>
                  )}

                  <Select
                    label="Status"
                    options={[
                      { label: "Active", value: BUNDLE_STATUS.ACTIVE },
                      { label: "Paused", value: BUNDLE_STATUS.PAUSED },
                    ]}
                    value={status}
                    onChange={setStatus}
                    disabled={isSaving}
                  />
                </FormLayout>
              </BlockStack>
            </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>

      {/* Product Picker Modal */}
      {showProductPicker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">Select Product Pages</Text>
                <Button onClick={() => setShowProductPicker(false)}>Done</Button>
              </InlineStack>
              
              <Text as="p" variant="bodyMd">
                Choose which product pages will display this bundle
              </Text>

              <TextField
                label=""
                value={assignmentSearchQuery}
                onChange={setAssignmentSearchQuery}
                placeholder="Search products..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setAssignmentSearchQuery("")}
              />

              {products.length === 0 ? (
                <Banner tone="warning" hideIcon>
                  <p>No products available. Add products to your store first.</p>
                </Banner>
              ) : (
                <ResourceList
                  items={filteredAssignmentProducts.slice(0, 50)}
                  renderItem={(product: Product) => {
                    const numericId = product.id.replace('gid://shopify/Product/', '');
                    const isSelected = assignedProducts.includes(numericId);
                    return (
                      <ResourceItem
                        id={product.id}
                        onClick={() => {
                          setAssignedProducts(
                            isSelected
                              ? assignedProducts.filter(id => id !== numericId)
                              : [...assignedProducts, numericId]
                          );
                        }}
                      >
                        <InlineStack gap="300" blockAlign="center">
                          <Checkbox label="" checked={isSelected} onChange={() => {}} />
                          <Thumbnail source={product.image} alt={product.title} size="small" />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd">{product.title}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatMoney(parseFloat(product.price), currencyCode)}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </BlockStack>
          </div>
        </div>
      )}

      {/* Bundle Product Picker Modal */}
      {showBundleProductPicker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingLg">Select Bundle Products</Text>
                <Button onClick={() => setShowBundleProductPicker(false)}>Done</Button>
              </InlineStack>
              
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Choose up to 2 products to bundle with the current product
                </Text>
                {selectedProducts.length >= 2 && (
                  <Text as="p" variant="bodySm" tone="success">
                    ✓ Maximum reached (Current product + 2 = 3 total)
                  </Text>
                )}
              </BlockStack>

              <TextField
                label=""
                value={bundleSearchQuery}
                onChange={setBundleSearchQuery}
                placeholder="Search products..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setBundleSearchQuery("")}
              />

              {products.length === 0 ? (
                <Banner tone="warning" hideIcon>
                  <p>No products available. Add products to your store first.</p>
                </Banner>
              ) : (
                <ResourceList
                  items={filteredBundleProducts.slice(0, 50)}
                  renderItem={(product: Product) => {
                    const numericId = product.id.replace('gid://shopify/Product/', '');
                    const isSelected = selectedProducts.includes(numericId);
                    const isDisabled = !isSelected && selectedProducts.length >= 2;
                    return (
                      <ResourceItem
                        id={product.id}
                        onClick={() => {
                          if (!isDisabled) {
                            setSelectedProducts(
                              isSelected
                                ? selectedProducts.filter(id => id !== numericId)
                                : [...selectedProducts, numericId]
                            );
                          }
                        }}
                      >
                        <InlineStack gap="300" blockAlign="center">
                          <Checkbox 
                            label="" 
                            checked={isSelected} 
                            disabled={isDisabled}
                            onChange={() => {}} 
                          />
                          <Thumbnail source={product.image} alt={product.title} size="small" />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd">{product.title}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatMoney(parseFloat(product.price), currencyCode)}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </BlockStack>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          content={toast.content}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </Frame>
  );
}

export function ErrorBoundary() {
  return (
    <Page title="Create FBT Bundle">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p">Loading bundle creation form...</Text>
              <Text as="p" tone="subdued">If this persists, please refresh the page.</Text>
              <Button onClick={() => window.location.reload()}>Refresh Page</Button>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
