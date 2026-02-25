import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { useState, useEffect } from "react";

import { authenticateAdmin } from "../bigcommerce.server";
import { SessionStatus } from "../components/SessionStatus";
import { ClientOnly } from "../components/ClientOnly";
import { PlanBadge } from "../components/PlanBadge";
import { AdminFallbackNav } from "../components/AdminFallbackNav";
import { getOrCreateSubscription } from "../services/billing.server";
import { json } from "@remix-run/node";
import styles from "../styles/admin.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, storeHash } = await authenticateAdmin(request);

    // Hard-code the API key to avoid hydration mismatch
    const apiKey = "ba2c932cf6717c8fb6207fcc8111fe70";

    // Get real subscription data and sync with BigCommerce billing
    const subscription = await getOrCreateSubscription(storeHash);

    // JSON.stringify can't handle Infinity, so convert to a large number for serialization
    const orderLimitSafe = subscription.orderLimit === Infinity ? 999999 : subscription.orderLimit;

    return json({
      apiKey,
      currentPlan: subscription.planTier,
      orderCount: subscription.orderCount,
      orderLimit: orderLimitSafe,
      approaching: subscription.isApproaching,
      isLimitReached: subscription.isLimitReached,
    });
  } catch (error) {
    // Handle session expiration gracefully
    if (error instanceof Response) {
      // Auth redirects are expected - re-throw them
      throw error;
    }

    console.error('[Admin Layout] Loader error:', error);
    throw new Response("Failed to load admin", { status: 500 });
  }
};

export default function App() {
  const { currentPlan, orderCount, orderLimit, approaching, isLimitReached } = useLoaderData<typeof loader>();
  const [isAppBridgeReady, setIsAppBridgeReady] = useState(false);
  const [hasRefreshed, setHasRefreshed] = useState(false);

  // Wait for App Bridge to be ready before rendering navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.message === 'BigCommerce.ready') {
        setIsAppBridgeReady(true);

        // Quiet refresh after App Bridge is ready to ensure navigation renders
        if (!hasRefreshed) {
          setHasRefreshed(true);
          // Force a re-render by updating state
          setTimeout(() => {
            setIsAppBridgeReady(false);
            setTimeout(() => setIsAppBridgeReady(true), 10);
          }, 100);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Fallback: If App Bridge ready signal doesn't come within 1.5 seconds, show nav anyway
    const fallbackTimer = setTimeout(() => {
      setIsAppBridgeReady(true);
    }, 1500);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(fallbackTimer);
    };
  }, [hasRefreshed]);

  return (
    <>
      {/* BigCommerce App Navigation - only render after App Bridge is ready */}
      {isAppBridgeReady && (
        <s-app-nav>
          <s-link href="/admin/dashboard">Analytics</s-link>
          <s-link href="/admin/settings">Settings</s-link>
          <s-link href="/admin/bundles">FBT</s-link>
        </s-app-nav>
      )}
      <div className={styles.headerBar}>
        <div className={styles.planBadgeContainer}>
          <PlanBadge
            plan={currentPlan}
            orderCount={orderCount}
            orderLimit={orderLimit}
            isApproaching={approaching}
          />
        </div>
        <AdminFallbackNav />
      </div>
      <ClientOnly fallback={<div>Loading...</div>}>
        {() => (
          <>
            <SessionStatus />
            {isLimitReached && (
              <div className={styles.limitWarning}>
                <div className={styles.limitWarningContent}>
                  <span className={styles.limitWarningIcon}>⚠️</span>
                  <div className={styles.limitWarningText}>
                    <strong>Order limit reached</strong> - You've used {orderCount} of your {orderLimit} monthly orders.
                    Upgrade your plan to continue using Cart Uplift.
                  </div>
                </div>
              </div>
            )}
            <Outlet />
          </>
        )}
      </ClientOnly>
    </>
  );
}

// Error boundary for admin layout
export function ErrorBoundary() {
  const error = useRouteError();

  // Handle session-related errors more gracefully
  if (error && typeof error === 'object' && 'status' in error) {
    const responseError = error as { status: number; statusText?: string };

    if (responseError.status === 401) {
      // For embedded apps, use App Bridge for re-authentication
      if (typeof window !== 'undefined') {
        // Redirect to BigCommerce auth flow
        window.location.href = '/auth/load';
      }

      return (
        <div>
          <h3>Session Expired</h3>
          <p>Re-authenticating...</p>
        </div>
      );
    }
  }

  return (
    <div>
      <h3>Something went wrong</h3>
      <p>Please try refreshing the page.</p>
    </div>
  );
}

export const headers: HeadersFunction = () => {
  const headers = new Headers();

  // Allow embedding in BigCommerce admin
  headers.set("Content-Security-Policy", "frame-ancestors https://*.bigcommerce.com https://store-*.mybigcommerce.com");

  return headers;
};
