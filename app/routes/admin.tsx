import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { Frame } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState, useEffect } from "react";

import { authenticate } from "../shopify.server";
import { SessionStatus } from "../components/SessionStatus";
import { ClientOnly } from "../components/ClientOnly";
import { PlanBadge } from "../components/PlanBadge";
import { AdminFallbackNav } from "../components/AdminFallbackNav";
import { getOrCreateSubscription } from "../services/billing.server";
import { json } from "@remix-run/node";
import styles from "../styles/admin.module.css";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);

    // Hard-code the API key to avoid hydration mismatch
    const apiKey = "ba2c932cf6717c8fb6207fcc8111fe70";
    
    // Get real subscription data and sync with Shopify Managed Pricing
    const subscription = await getOrCreateSubscription(session.shop, admin);
    
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
      // Shopify auth redirects are expected - re-throw them
      throw error;
    }
    
    console.error('[Admin Layout] Loader error:', error);
    throw new Response("Failed to load admin", { status: 500 });
  }
};

export default function App() {
  const { apiKey, currentPlan, orderCount, orderLimit, approaching, isLimitReached } = useLoaderData<typeof loader>();
  const [isAppBridgeReady, setIsAppBridgeReady] = useState(false);
  const [hasRefreshed, setHasRefreshed] = useState(false);

  // Wait for App Bridge to be ready before rendering navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.message === 'Shopify.API.ready') {
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
    <AppProvider isEmbeddedApp apiKey={apiKey || "ba2c932cf6717c8fb6207fcc8111fe70"}>
      {/* Shopify App Design System: App Nav - only render after App Bridge is ready */}
      {isAppBridgeReady && (
        <s-app-nav>
          <s-link href="/admin/dashboard">Analytics</s-link>
          <s-link href="/admin/settings">Settings</s-link>
          <s-link href="/admin/bundles">FBT</s-link>
        </s-app-nav>
      )}
      <Frame>
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
                      Upgrade via the Shopify App Store to continue using Cart Uplift.
                    </div>
                  </div>
                </div>
              )}
              <Outlet />
            </>
          )}
        </ClientOnly>
      </Frame>
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  
  // Handle session-related errors more gracefully
  if (error && typeof error === 'object' && 'status' in error) {
    const responseError = error as { status: number; statusText?: string };
    
    if (responseError.status === 401) {
      // For embedded apps, use App Bridge for re-authentication
      if (typeof window !== 'undefined') {
        if (window.top !== window.self) {
          // In iframe - use App Bridge reauth
          window.parent.postMessage({ 
            message: 'Shopify.API.reauthorizeApplication' 
          }, '*');
        } else {
          // Not in iframe - redirect to auth
          window.location.href = '/auth';
        }
      }
      
      return (
        <div>
          <h3>Session Expired</h3>
          <p>Re-authenticating with Shopify...</p>
        </div>
      );
    }
  }

  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  const headers = boundary.headers(headersArgs);
  
  // Allow embedding in Shopify admin via CSP only
  headers.set("Content-Security-Policy", "frame-ancestors https://*.myshopify.com https://admin.shopify.com https://*.shopify.com");
  
  return headers;
};
