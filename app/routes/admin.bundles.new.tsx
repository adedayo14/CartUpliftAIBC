import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useCallback, useMemo, useEffect } from "react";
import type { PrismaClient } from "@prisma/client";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  H3,
  Small,
  Button,
  Badge,
  HR,
  Input,
  Textarea,
  Select,
  Checkbox,
} from "@bigcommerce/big-design";
import { ArrowBackIcon, CheckIcon } from "@bigcommerce/big-design-icons";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
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
    const { session, storeHash } = await authenticateAdmin(request);
    const shop = storeHash;

    let collections: Collection[] = [];
    let products: Product[] = [];
    let currencyCode = 'USD';

    // Fetch store currency from BigCommerce v2 store info
    try {
      const storeRes = await bigcommerceApi(storeHash, "/store", { version: "v2" });
      const storeData = await storeRes.json();
      currencyCode = storeData.currency || 'USD';
    } catch (err) {
      console.error('[admin.bundles.new] Failed to fetch store currency:', err);
    }

    // Fetch products from BigCommerce catalog
    try {
      const productsRes = await bigcommerceApi(storeHash, "/catalog/products?include=variants,images&is_visible=true&limit=50");
      const productsData = await productsRes.json();
      if (productsData.data) {
        products = productsData.data.map((p: Record<string, unknown>) => ({
          id: String(p.id),
          title: (p.name as string) || 'Untitled Product',
          price: String(p.price || '0.00'),
          image: ((p.images as Array<{ url_standard?: string }>) || [])[0]?.url_standard || '',
        }));
      }
    } catch (error: unknown) {
      console.error('[admin.bundles.new] Failed to fetch products:', error);
    }

    // Fetch categories from BigCommerce catalog
    try {
      const collectionsRes = await bigcommerceApi(storeHash, "/catalog/categories?is_visible=true&limit=50");
      const collectionsData = await collectionsRes.json();
      if (collectionsData.data) {
        collections = collectionsData.data.map((c: Record<string, unknown>) => ({
          id: String(c.id),
          title: (c.name as string) || 'Untitled Category',
          productsCount: 0,
        }));
      }
    } catch (error: unknown) {
      console.error('[admin.bundles.new] Failed to fetch categories:', error);
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
    const { storeHash } = await authenticateAdmin(request);
    shop = storeHash;

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
            storeHash: shop,
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
          storeHash: shop,
          ...bundleData,
        },
      });

      // Redirect to bundles list after successful creation
      return redirect(`/admin/bundles?context=${shop}`);
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
    { content: "Manual Selection (FBT Logic)", value: BUNDLE_TYPES.MANUAL },
    { content: "AI-Powered (Smart Recommendations)", value: BUNDLE_TYPES.ML },
    { content: "Collection-Based (Complete the Set)", value: BUNDLE_TYPES.COLLECTION },
  ];

  const discountTypeOptions = [
    { content: "Percentage", value: DISCOUNT_TYPES.PERCENTAGE },
    { content: "Fixed Amount", value: DISCOUNT_TYPES.FIXED },
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

      // Use XMLHttpRequest to avoid Remix interception in embedded apps
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
    <>
      <Box padding="medium">
        {/* Page header with back button and primary action */}
        <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '1.5rem' }}>
          <Flex alignItems="center" flexGap="1rem">
            <Button
              variant="subtle"
              onClick={() => { window.location.href = "/admin/bundles" + authParams; }}
              iconLeft={<ArrowBackIcon />}
            >
              Back
            </Button>
            <H1>Create FBT</H1>
          </Flex>
          <Button
            variant="primary"
            onClick={handleSave}
            isLoading={isSaving}
            disabled={!name.trim() || isSaving}
          >
            Create FBT
          </Button>
        </Flex>

        {/* Layout */}
        <Flex flexDirection="column" flexGap="1.5rem">
          <Box>
            <Flex flexDirection="column" flexGap="1.5rem">
              <Panel>
                <Box padding="xxSmall">
                  <Flex flexDirection="column" flexGap="1.5rem">
                    <H2>Bundle Details</H2>

                    <Flex flexDirection="column" flexGap="1rem">
                      {(collections.length === 0 && products.length === 0) && (
                        <Box
                          style={{
                            borderLeft: '4px solid #c62828',
                            backgroundColor: '#ffebee',
                            padding: '1rem',
                            borderRadius: '4px',
                          }}
                        >
                          <Flex flexDirection="column" flexGap="0.5rem">
                            <Text bold>No Products or Collections Found</Text>
                            <Small>
                              The GraphQL API is not returning any data. Please navigate to <strong>/admin/debug</strong> to see the actual API response and troubleshoot.
                              Possible causes: products not published, authentication issues, or empty store.
                            </Small>
                          </Flex>
                        </Box>
                      )}

                      <Input
                        label="Bundle Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g., Summer Essentials Pack"
                        description="Bundle names are for internal use only."
                        required
                        disabled={isSaving}
                      />

                      <Textarea
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Brief description of the bundle (optional)"
                        disabled={isSaving}
                        rows={2}
                      />

                      <Select
                        label="Bundle Type"
                        options={bundleTypeOptions}
                        value={type}
                        onOptionChange={(val) => setType(val)}
                        description={
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
                        <Panel>
                          <Box padding="xxSmall">
                            <Flex flexDirection="column" flexGap="1rem">
                              <H3>Bundle Contents</H3>
                              <Box
                                style={{
                                  borderLeft: '4px solid #1565c0',
                                  backgroundColor: '#e3f2fd',
                                  padding: '1rem',
                                  borderRadius: '4px',
                                }}
                              >
                                <Small>
                                  Select up to 2 products to bundle with the current product.
                                </Small>
                              </Box>

                              {products.length === 0 ? (
                                <Box
                                  style={{
                                    borderLeft: '4px solid #ed6c02',
                                    backgroundColor: '#fff3e0',
                                    padding: '1rem',
                                    borderRadius: '4px',
                                  }}
                                >
                                  <Text>No products available. Add products to your store first.</Text>
                                </Box>
                              ) : (
                                <>
                                  {selectedProducts.length === 0 && (
                                    <Panel>
                                      <Box padding="xxSmall">
                                        <Flex flexDirection="column" flexGap="0.5rem">
                                          <H3>Products Required</H3>
                                          <Text color="secondary">
                                            Choose which products to include in this bundle
                                          </Text>
                                          <Button
                                            onClick={() => setShowBundleProductPicker(true)}
                                            disabled={isSaving}
                                          >
                                            Select Bundle Products
                                          </Button>
                                        </Flex>
                                      </Box>
                                    </Panel>
                                  )}

                                  {selectedProducts.length > 0 && (
                                    <Panel>
                                      <Box padding="xxSmall">
                                        <Flex flexDirection="column" flexGap="0.5rem">
                                          <Flex justifyContent="space-between" alignItems="center">
                                            <Flex flexGap="0.5rem" alignItems="center">
                                              <CheckIcon color="success" />
                                              <Text bold>
                                                {selectedProducts.length}/2 products selected
                                              </Text>
                                            </Flex>
                                            <Button
                                              variant="subtle"
                                              onClick={() => setShowBundleProductPicker(true)}
                                              disabled={isSaving}
                                            >
                                              Change
                                            </Button>
                                          </Flex>
                                          {selectedProducts.length >= 2 && (
                                            <Text color="success">
                                              Maximum reached (Current product + 2 = 3 total)
                                            </Text>
                                          )}
                                        </Flex>
                                      </Box>
                                    </Panel>
                                  )}
                                </>
                              )}
                            </Flex>
                          </Box>
                        </Panel>
                      )}

                      {/* Collection Selection for Collection-Based Bundles */}
                      {type === BUNDLE_TYPES.COLLECTION && (
                        <Panel>
                          <Box padding="xxSmall">
                            <Flex flexDirection="column" flexGap="1rem">
                              <H3>Select Collection</H3>
                              <Box
                                style={{
                                  borderLeft: '4px solid #1565c0',
                                  backgroundColor: '#e3f2fd',
                                  padding: '1rem',
                                  borderRadius: '4px',
                                }}
                              >
                                <Small>
                                  AI selects 2 products from this collection based on purchase patterns.
                                </Small>
                              </Box>
                              {collections.length === 0 ? (
                                <Box
                                  style={{
                                    borderLeft: '4px solid #ed6c02',
                                    backgroundColor: '#fff3e0',
                                    padding: '1rem',
                                    borderRadius: '4px',
                                  }}
                                >
                                  <Text>No collections available. Create collections in your store first.</Text>
                                </Box>
                              ) : (
                                <Select
                                  label="Choose collection"
                                  options={[
                                    { content: "Select a collection...", value: "" },
                                    ...collections.map((collection) => ({
                                      content: `${collection.title} (${collection.productsCount} products)`,
                                      value: collection.id
                                    }))
                                  ]}
                                  value={selectedCollection}
                                  onOptionChange={(val) => setSelectedCollection(val)}
                                  disabled={isSaving}
                                  description="Select ONE collection for AI to choose products from"
                                />
                              )}
                            </Flex>
                          </Box>
                        </Panel>
                      )}

                      {/* Show bundle on (assignment type) */}
                      <Select
                        label="Show bundle on"
                        options={[
                          { content: "All product pages", value: "all" },
                          { content: "Specific product pages", value: "specific" },
                        ]}
                        value={assignmentType}
                        onOptionChange={(v) => setAssignmentType(v as "all" | "specific")}
                        disabled={isSaving}
                        description="Choose where this bundle should appear"
                      />

                      {assignmentType === "all" && (
                        <Box
                          style={{
                            borderLeft: '4px solid #1565c0',
                            backgroundColor: '#e3f2fd',
                            padding: '1rem',
                            borderRadius: '4px',
                          }}
                        >
                          <Text>This bundle will appear on all product pages in your store</Text>
                        </Box>
                      )}

                      {/* Product Assignment - Show for specific pages BEFORE discount fields */}
                      {assignmentType === "specific" && assignedProducts.length === 0 && (
                        <Panel>
                          <Box padding="xxSmall">
                            <Flex flexDirection="column" flexGap="0.5rem">
                              <H3>Product Assignment Required</H3>
                              <Text color="secondary">
                                Choose which product pages should display this bundle
                              </Text>
                              <Button
                                onClick={() => setShowProductPicker(true)}
                                disabled={isSaving}
                              >
                                Select Product Pages
                              </Button>
                              {products.length === 0 && (
                                <Text color="danger">
                                  No products found. Please check /admin/debug to troubleshoot.
                                </Text>
                              )}
                            </Flex>
                          </Box>
                        </Panel>
                      )}

                      {assignmentType === "specific" && assignedProducts.length > 0 && (
                        <Panel>
                          <Box padding="xxSmall">
                            <Flex flexDirection="column" flexGap="0.5rem">
                              <Flex justifyContent="space-between" alignItems="center">
                                <Flex flexGap="0.5rem" alignItems="center">
                                  <CheckIcon color="success" />
                                  <Text bold>
                                    Assigned to {assignedProducts.length} product page{assignedProducts.length === 1 ? '' : 's'}
                                  </Text>
                                </Flex>
                                <Button
                                  variant="subtle"
                                  onClick={() => setShowProductPicker(true)}
                                  disabled={isSaving}
                                >
                                  Change
                                </Button>
                              </Flex>
                            </Flex>
                          </Box>
                        </Panel>
                      )}

                      <Flex flexDirection="row" flexGap="1rem">
                        <Select
                          label="Discount Type"
                          options={discountTypeOptions}
                          value={discountType}
                          onOptionChange={(val) => setDiscountType(val)}
                          disabled={isSaving}
                        />
                        <Input
                          label="Discount Value"
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          type="number"
                          disabled={isSaving}
                        />
                      </Flex>

                      <Box
                        style={{
                          borderLeft: '4px solid #ed6c02',
                          backgroundColor: '#fff3e0',
                          padding: '1rem',
                          borderRadius: '4px',
                        }}
                      >
                        <Flex flexDirection="column" flexGap="0.25rem">
                          <Text bold>
                            Discount Setup Required
                          </Text>
                          <Small>
                            Create a matching discount in your BigCommerce control panel. Cart Uplift doesn't auto-generate discounts -- this value is for display only.
                          </Small>
                        </Flex>
                      </Box>

                      {/* Hidden for now - keep for future use. Set SHOW_MINIMUM_FIELDS=true to enable */}
                      {SHOW_MINIMUM_FIELDS && (
                        <Flex flexDirection="column" flexGap="1rem">
                          <Text bold>
                            Bundle Requirements
                          </Text>
                          <Text color="secondary">
                            Set minimums to control when the bundle qualifies for discounts
                          </Text>

                          <Flex flexDirection="row" flexGap="1rem">
                            <Input
                              label="Minimum Products (optional)"
                              type="number"
                              value={minProducts}
                              onChange={(e) => setMinProducts(e.target.value)}
                              disabled={isSaving}
                              description="Number of items required (quantity)"
                              placeholder="e.g., 2"
                            />
                            <Input
                              label="Minimum Bundle Price (optional)"
                              type="number"
                              value={minBundlePrice}
                              onChange={(e) => setMinBundlePrice(e.target.value)}
                              disabled={isSaving}
                              description="Total cart value required"
                              placeholder="e.g., 50.00"
                            />
                          </Flex>
                        </Flex>
                      )}

                      {/* Hidden - these are now defaults: allowDeselect=true, hideIfNoML=false
                          Set SHOW_ADVANCED_OPTIONS=true to enable */}
                      {SHOW_ADVANCED_OPTIONS && (
                        <Flex flexDirection="column" flexGap="1rem">
                          <Checkbox
                            label="Allow customers to deselect bundle items"
                            checked={allowDeselect}
                            onChange={(e) => setAllowDeselect(e.target.checked)}
                            disabled={isSaving}
                            description="Let customers customize which products they want from the bundle"
                          />
                          <Checkbox
                            label="Hide bundle if no AI recommendations available"
                            checked={hideIfNoML}
                            onChange={(e) => setHideIfNoML(e.target.checked)}
                            disabled={isSaving}
                            description="Only show this bundle when AI can find suitable product recommendations"
                          />
                        </Flex>
                      )}

                      <Select
                        label="Status"
                        options={[
                          { content: "Active", value: BUNDLE_STATUS.ACTIVE },
                          { content: "Paused", value: BUNDLE_STATUS.PAUSED },
                        ]}
                        value={status}
                        onOptionChange={(val) => setStatus(val)}
                        disabled={isSaving}
                      />
                    </Flex>
                  </Flex>
                </Box>
              </Panel>
            </Flex>
          </Box>
        </Flex>
      </Box>

      {/* Product Picker Modal */}
      {showProductPicker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <Flex flexDirection="column" flexGap="1.5rem">
              <Flex justifyContent="space-between" alignItems="center">
                <H2>Select Product Pages</H2>
                <Button onClick={() => setShowProductPicker(false)}>Done</Button>
              </Flex>

              <Text>
                Choose which product pages will display this bundle
              </Text>

              <Input
                label=""
                value={assignmentSearchQuery}
                onChange={(e) => setAssignmentSearchQuery(e.target.value)}
                placeholder="Search products..."
              />

              {products.length === 0 ? (
                <Box
                  style={{
                    borderLeft: '4px solid #ed6c02',
                    backgroundColor: '#fff3e0',
                    padding: '1rem',
                    borderRadius: '4px',
                  }}
                >
                  <Text>No products available. Add products to your store first.</Text>
                </Box>
              ) : (
                <Box>
                  {filteredAssignmentProducts.slice(0, 50).map((product: Product) => {
                    const numericId = String(product.id);
                    const isSelected = assignedProducts.includes(numericId);
                    return (
                      <Box
                        key={product.id}
                        padding="xSmall"
                        style={{ borderBottom: '1px solid #e0e0e0', cursor: 'pointer' }}
                        onClick={() => {
                          setAssignedProducts(
                            isSelected
                              ? assignedProducts.filter(id => id !== numericId)
                              : [...assignedProducts, numericId]
                          );
                        }}
                      >
                        <Flex flexGap="1rem" alignItems="center">
                          <Checkbox label="" checked={isSelected} onChange={() => {}} />
                          <img
                            src={product.image}
                            alt={product.title}
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                          />
                          <Flex flexDirection="column" flexGap="0.125rem">
                            <Text>{product.title}</Text>
                            <Text color="secondary">
                              {formatMoney(parseFloat(product.price), currencyCode)}
                            </Text>
                          </Flex>
                        </Flex>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Flex>
          </div>
        </div>
      )}

      {/* Bundle Product Picker Modal */}
      {showBundleProductPicker && (
        <div className="modal-overlay">
          <div className="modal-content">
            <Flex flexDirection="column" flexGap="1.5rem">
              <Flex justifyContent="space-between" alignItems="center">
                <H2>Select Bundle Products</H2>
                <Button onClick={() => setShowBundleProductPicker(false)}>Done</Button>
              </Flex>

              <Flex flexDirection="column" flexGap="0.5rem">
                <Text>
                  Choose up to 2 products to bundle with the current product
                </Text>
                {selectedProducts.length >= 2 && (
                  <Text color="success">
                    Maximum reached (Current product + 2 = 3 total)
                  </Text>
                )}
              </Flex>

              <Input
                label=""
                value={bundleSearchQuery}
                onChange={(e) => setBundleSearchQuery(e.target.value)}
                placeholder="Search products..."
              />

              {products.length === 0 ? (
                <Box
                  style={{
                    borderLeft: '4px solid #ed6c02',
                    backgroundColor: '#fff3e0',
                    padding: '1rem',
                    borderRadius: '4px',
                  }}
                >
                  <Text>No products available. Add products to your store first.</Text>
                </Box>
              ) : (
                <Box>
                  {filteredBundleProducts.slice(0, 50).map((product: Product) => {
                    const numericId = String(product.id);
                    const isSelected = selectedProducts.includes(numericId);
                    const isDisabled = !isSelected && selectedProducts.length >= 2;
                    return (
                      <Box
                        key={product.id}
                        padding="xSmall"
                        style={{
                          borderBottom: '1px solid #e0e0e0',
                          cursor: isDisabled ? 'not-allowed' : 'pointer',
                          opacity: isDisabled ? 0.5 : 1,
                        }}
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
                        <Flex flexGap="1rem" alignItems="center">
                          <Checkbox
                            label=""
                            checked={isSelected}
                            disabled={isDisabled}
                            onChange={() => {}}
                          />
                          <img
                            src={product.image}
                            alt={product.title}
                            style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                          />
                          <Flex flexDirection="column" flexGap="0.125rem">
                            <Text>{product.title}</Text>
                            <Text color="secondary">
                              {formatMoney(parseFloat(product.price), currencyCode)}
                            </Text>
                          </Flex>
                        </Flex>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Flex>
          </div>
        </div>
      )}

      {toast && (
        <Box
          style={{
            position: 'fixed',
            bottom: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: toast.error ? '#c62828' : '#2e7d32',
            color: '#fff',
            padding: '0.75rem 1.5rem',
            borderRadius: '4px',
            zIndex: 9999,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            cursor: 'pointer',
          }}
          onClick={() => setToast(null)}
        >
          <Text color="white">{toast.content}</Text>
        </Box>
      )}
    </>
  );
}

export function ErrorBoundary() {
  return (
    <Box padding="medium">
      <Flex alignItems="center" flexGap="1rem" style={{ marginBottom: '1.5rem' }}>
        <H1>Create FBT Bundle</H1>
      </Flex>
      <Flex flexDirection="column" flexGap="1.5rem">
        <Box>
          <Panel>
            <Box padding="xxSmall">
              <Flex flexDirection="column" flexGap="1.5rem">
                <Text>Loading bundle creation form...</Text>
                <Text color="secondary">If this persists, please refresh the page.</Text>
                <Button onClick={() => window.location.reload()}>Refresh Page</Button>
              </Flex>
            </Box>
          </Panel>
        </Box>
      </Flex>
    </Box>
  );
}
