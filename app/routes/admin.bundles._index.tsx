import type { LoaderFunctionArgs, LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useState, useCallback, useRef, useEffect } from "react";
import { Box, Panel, Flex, Button, Text, H1, H2 } from "@bigcommerce/big-design";
import { AddIcon, CloseIcon } from "@bigcommerce/big-design-icons";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";

import prisma from "../db.server";
import adminBundlesStyles from "~/styles/admin-bundles.css?url";
import { BundleTable } from "../components/BundleTable";
import type { Bundle } from "./admin.bundles";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: adminBundlesStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let storeHashVal = 'unknown-shop';

  try {
    const { session, storeHash } = await authenticateAdmin(request);
    storeHashVal = storeHash;

    const rawBundles = await prisma.bundle.findMany({ where: { storeHash }, orderBy: { createdAt: 'desc' } });

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

    // Fetch currency and products from BigCommerce in parallel
    const shopQuery = bigcommerceApi(storeHash, "/store", { version: "v2" }).then(res => res.json());
    const productsQuery = bigcommerceApi(storeHash, "/catalog/products?include=variants,images&is_visible=true&limit=50").then(res => res.json());

    const [shopResult, productsResult] = await Promise.allSettled([shopQuery, productsQuery]);

    let currencyCode = 'USD';
    let products: { node: { id: string; title: string; handle: string } }[] = [];

    if (shopResult.status === 'fulfilled') {
      currencyCode = shopResult.value?.currency || 'USD';
    } else {
      console.error('[admin.bundles._index] store info query failed:', shopResult.reason);
    }

    if (productsResult.status === 'fulfilled') {
      const bcProducts = productsResult.value?.data || [];
      products = bcProducts.map((p: Record<string, unknown>) => ({
        node: {
          id: String(p.id),
          title: (p.name as string) || 'Untitled Product',
          handle: ((p.custom_url as { url?: string })?.url || `/${p.id}/`).replace(/^\/|\/$/g, ''),
        }
      }));
    } else {
      console.error('[admin.bundles._index] products query failed:', productsResult.reason);
    }

    return json({ storeHash: storeHashVal, bundles, currencyCode, products });
  } catch (error) {
    console.error("[admin.bundles._index] Loader error:", error);

    // If we can't get storeHash from session, try from query params
    let storeHashFallback = 'unknown-shop';
    try {
      const url = new URL(request.url);
      storeHashFallback = url.searchParams.get('storeHash') || url.searchParams.get('shop') || storeHashFallback;
    } catch (_e) {
      // Ignore URL parsing errors
    }

    // Return empty data instead of throwing to prevent error boundary flash
    return json({
      storeHash: storeHashFallback,
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
  const { storeHash, bundles, currencyCode, error } = data;
  const navigation = useNavigation();

  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const hasLoadedSuccessfully = useRef(false);
  const [stableBundles, setStableBundles] = useState<Bundle[]>(bundles);
  const [stableStoreHash, setStableStoreHash] = useState(storeHash);
  const [stableCurrencyCode, setStableCurrencyCode] = useState(currencyCode);
  const suppressErrorsUntil = useRef(0);

  // Track if we've ever loaded successfully and cache stable data
  useEffect(() => {
    if (bundles && bundles.length >= 0 && !error) {
      hasLoadedSuccessfully.current = true;
      setStableBundles(bundles);
      setStableStoreHash(storeHash);
      setStableCurrencyCode(currencyCode);
    }
  }, [bundles, storeHash, currencyCode, error]);

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
      <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <Flex flexDirection="column" flexGap="1.5rem">
          <H1>FBT (Frequently Bought Together)</H1>
          {toastMarkup(toast, setToast)}
          <Panel>
            <Flex flexDirection="column" flexGap="0.75rem">
              <H2>Error loading bundles</H2>
              <Text>An error occurred while loading your FBT bundles.</Text>
              <Text className="bundle-error-description">{error}</Text>
              <Button onClick={() => window.location.reload()}>Refresh Page</Button>
            </Flex>
          </Panel>
        </Flex>
      </Box>
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

  // Use stable cached data to prevent showing empty state during revalidation
  const displayBundles = hasLoadedSuccessfully.current ? stableBundles : bundles;
  const displayStoreHash = hasLoadedSuccessfully.current ? stableStoreHash : storeHash;
  const displayCurrencyCode = hasLoadedSuccessfully.current ? stableCurrencyCode : currencyCode;

  // Empty state when no bundles exist
  if (displayBundles.length === 0) {
    return (
      <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <Flex flexDirection="column" flexGap="1.5rem">
          <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
            <H1>FBT (Frequently Bought Together)</H1>
            <Button iconLeft={<AddIcon />} variant="primary" onClick={handleCreateBundle}>
              Create FBT
            </Button>
          </Flex>
          {toastMarkup(toast, setToast)}
          <Panel>
            <Flex flexDirection="column" flexGap="0.75rem">
              <H2>Create your first FBT</H2>
              <Text>Create product bundles to increase average order value and drive more sales.</Text>
              <Button iconLeft={<AddIcon />} onClick={handleCreateBundle}>Create FBT</Button>
            </Flex>
          </Panel>
        </Flex>
      </Box>
    );
  }

  return (
    <Box padding="medium" style={{ maxWidth: "100%", margin: "0 auto" }}>
      <Flex flexDirection="column" flexGap="1.5rem">
        <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
          <H1>FBT (Frequently Bought Together)</H1>
          <Button iconLeft={<AddIcon />} variant="primary" onClick={handleCreateBundle}>
            Create FBT
          </Button>
        </Flex>
        {toastMarkup(toast, setToast)}
        <Panel>
          <BundleTable
            key={`bundle-table-${displayBundles.length}`}
            storeHash={displayStoreHash}
            bundles={displayBundles}
            currencyCode={displayCurrencyCode}
            onEdit={handleEditBundle}
            setToast={handleSetToast}
          />
        </Panel>
      </Flex>
    </Box>
  );
}

function toastMarkup(
  toast: { content: string; error?: boolean } | null,
  setToast: (toast: { content: string; error?: boolean } | null) => void,
) {
  if (!toast) return null;

  return (
    <Panel>
      <Flex flexDirection="row" justifyContent="space-between" alignItems="center" flexGap="0.75rem">
        <Text color={toast.error ? "danger" : "success"}>{toast.content}</Text>
        <Button variant="subtle" iconOnly={<CloseIcon />} onClick={() => setToast(null)} />
      </Flex>
    </Panel>
  );
}

/**
 * Error boundary to prevent error flashes during revalidation
 * Returns user to bundles list gracefully
 */
export function ErrorBoundary() {
  return (
    <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <Flex flexDirection="column" flexGap="1.5rem">
        <H1>FBT (Frequently Bought Together)</H1>
        <Panel>
          <Flex flexDirection="column" flexGap="0.75rem">
            <H2>Loading bundles...</H2>
            <Text>Please wait while we refresh your FBT bundles.</Text>
            <Button onClick={() => window.location.reload()}>Refresh Page</Button>
          </Flex>
        </Panel>
      </Flex>
    </Box>
  );
}
