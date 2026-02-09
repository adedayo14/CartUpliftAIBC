import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useNavigation } from "@remix-run/react";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Toast,
  EmptyState,
  Button,
  InlineStack,
} from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

import prisma from "../db.server";
import adminBundlesStyles from "~/styles/admin-bundles.css?url";
import { BundleTable } from "../components/BundleTable";
import type { Bundle } from "./admin.bundles";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: adminBundlesStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let shop = 'unknown-shop';
  
  try {
    const { admin, session } = await authenticate.admin(request);
    shop = session.shop;

    const rawBundles = await prisma.bundle.findMany({ where: { shop }, orderBy: { createdAt: 'desc' } });

    const bundles: Bundle[] = rawBundles.map(bundle => {
      let parsedTierConfig: { qty: number; discount: number }[] | null = null;
      if (typeof bundle.tierConfig === 'string') {
        try {
          const parsed = JSON.parse(bundle.tierConfig);
          if (Array.isArray(parsed)) {
            parsedTierConfig = parsed;
          }
        } catch (e) {
          console.error(`[Loader] Failed to parse tierConfig for bundle ${bundle.id}`, e);
        }
      } else if (Array.isArray(bundle.tierConfig)) {
        parsedTierConfig = bundle.tierConfig as { qty: number; discount: number }[];
      }
      
      return { 
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        type: bundle.type,
        status: bundle.status,
        discountType: bundle.discountType,
        discountValue: bundle.discountValue,
        totalPurchases: bundle.totalPurchases,
        totalRevenue: bundle.totalRevenue,
        productIds: bundle.productIds,
        collectionIds: bundle.collectionIds,
        assignedProducts: bundle.assignedProducts,
        bundleStyle: (bundle.bundleStyle as Bundle['bundleStyle']) || null,
        minProducts: bundle.minProducts,
        minBundlePrice: bundle.minBundlePrice,
        selectMinQty: bundle.selectMinQty,
        selectMaxQty: bundle.selectMaxQty,
        allowDeselect: bundle.allowDeselect,
        hideIfNoML: bundle.hideIfNoML,
        createdAt: bundle.createdAt.toISOString(),
        tierConfig: parsedTierConfig,
      };
    });

    const shopQuery = admin.graphql(`query shopInfo { shop { currencyCode } }`).then(res => res.json());
    const productsQuery = admin.graphql(
      `#graphql
      query getProducts {
        products(first: 50) {
          edges {
            node {
              id
              title
              handle
            }
          }
        }
      }`
    ).then(res => res.json());

    const [shopResult, productsResult] = await Promise.allSettled([shopQuery, productsQuery]);

    let currencyCode = 'USD';
    let products: { node: { id: string; title: string; handle: string } }[] = [];

    if (shopResult.status === 'fulfilled') {
      if (shopResult.value?.errors?.length) {
        console.error('[admin.bundles._index] shop query errors:', shopResult.value.errors);
      } else {
        currencyCode = shopResult.value?.data?.shop?.currencyCode || 'USD';
      }
    } else {
      console.error('[admin.bundles._index] shop query failed:', shopResult.reason);
    }

    if (productsResult.status === 'fulfilled') {
      if (productsResult.value?.errors?.length) {
        console.error('[admin.bundles._index] products query errors:', productsResult.value.errors);
      } else {
        products = productsResult.value?.data?.products?.edges || [];
      }
    } else {
      console.error('[admin.bundles._index] products query failed:', productsResult.reason);
    }

    return json({ shop, bundles, currencyCode, products });
  } catch (error) {
    console.error("[admin.bundles._index] Loader error:", error);
    
    // If we can't get shop from session, try from the error or return generic fallback
    let shopFallback = 'unknown-shop';
    try {
      const url = new URL(request.url);
      shopFallback = url.searchParams.get('shop') || shopFallback;
    } catch (_e) {
      // Ignore URL parsing errors
    }
    
    // Return empty data instead of throwing to prevent error boundary flash
    return json({
      shop: shopFallback,
      bundles: [],
      currencyCode: 'USD',
      products: [],
      error: error instanceof Error ? error.message : 'Failed to load bundles'
    }, { status: 200 }); // Return 200 to prevent error boundary trigger
  }
};

export default function BundlesIndex() {
  const isBrowser = typeof window !== 'undefined';

  const data = useLoaderData<typeof loader>();
  const { shop, bundles, currencyCode, error } = data;
  const navigation = useNavigation();

  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const hasLoadedSuccessfully = useRef(false);
  const [stableBundles, setStableBundles] = useState<Bundle[]>(bundles);
  const [stableShop, setStableShop] = useState(shop);
  const [stableCurrencyCode, setStableCurrencyCode] = useState(currencyCode);
  const suppressErrorsUntil = useRef(0);

  // Track if we've ever loaded successfully and cache stable data
  useEffect(() => {
    if (bundles && bundles.length >= 0 && !error) {
      hasLoadedSuccessfully.current = true;
      setStableBundles(bundles);
      setStableShop(shop);
      setStableCurrencyCode(currencyCode);
    }
  }, [bundles, shop, currencyCode, error]);

  // Extended toast handler that also sets error suppression window
  const handleSetToast = useCallback((toastData: { content: string; error?: boolean } | null) => {
    setToast(toastData);
    // Suppress errors for 1 second after any action to prevent flash during revalidation
    if (toastData) {
      suppressErrorsUntil.current = Date.now() + 1000;
    }
  }, []);

  // Detect if we're currently revalidating or navigating
  const isRevalidating = navigation.state === "loading" || navigation.state === "submitting";
  const inSuppressWindow = Date.now() < suppressErrorsUntil.current;

  // Only show error state on initial load failure, never during revalidation or suppress window
  // During revalidation, keep showing cached stable data to prevent error flash
  if (error && !hasLoadedSuccessfully.current && !isRevalidating && !inSuppressWindow) {
    return (
      <Page title="FBT (Frequently Bought Together)">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Error loading bundles"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>An error occurred while loading your FBT bundles.</p>
                <p className="bundle-error-description">{error}</p>
                <br />
                <Button onClick={() => window.location.reload()}>Refresh Page</Button>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const searchParams = isBrowser ? window.location.search : '';
  const createBundleUrl = '/admin/bundles/new' + searchParams;
  
  const handleCreateBundle = useCallback(() => {
    if (!isBrowser) {
      return;
    }
    window.location.href = createBundleUrl;
  }, [createBundleUrl]);

  const handleEditBundle = useCallback((bundle: Bundle) => {
    if (!isBrowser) {
      return;
    }
    window.location.href = `/admin/bundles/${bundle.id}` + window.location.search;
  }, [isBrowser]);

  const toastMarkup = toast ? (
    <Toast content={toast.content} onDismiss={() => setToast(null)} error={toast.error} />
  ) : null;

  // Use stable cached data to prevent showing empty state during revalidation
  const displayBundles = hasLoadedSuccessfully.current ? stableBundles : bundles;
  const displayShop = hasLoadedSuccessfully.current ? stableShop : shop;
  const displayCurrencyCode = hasLoadedSuccessfully.current ? stableCurrencyCode : currencyCode;

  // Empty state when no bundles exist
  if (displayBundles.length === 0) {
    return (
      <Page title="FBT (Frequently Bought Together)">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Create your first FBT"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create product bundles to increase average order value and drive more sales.</p>
                <br />
                <Button icon={PlusIcon} onClick={handleCreateBundle}>Create FBT</Button>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
        {toastMarkup}
      </Page>
    );
  }

  return (
    <Page title="FBT (Frequently Bought Together)" fullWidth>
      <Layout>
        <Layout.Section>
          <InlineStack align="end">
            <Button icon={PlusIcon} variant="primary" onClick={handleCreateBundle}>
              Create FBT
            </Button>
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BundleTable
              key={`bundle-table-${displayBundles.length}`}
              shop={displayShop}
              bundles={displayBundles}
              currencyCode={displayCurrencyCode}
              onEdit={handleEditBundle}
              setToast={handleSetToast}
            />
          </Card>
        </Layout.Section>
      </Layout>
      {toastMarkup}
    </Page>
  );
}

/**
 * Error boundary to prevent error flashes during revalidation
 * Returns user to bundles list gracefully
 */
export function ErrorBoundary() {
  return (
    <Page title="FBT (Frequently Bought Together)">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Loading bundles..."
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Please wait while we refresh your FBT bundles.</p>
              <br />
              <Button onClick={() => window.location.reload()}>Refresh Page</Button>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
