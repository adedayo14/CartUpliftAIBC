import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "@remix-run/react";
import { IframeBreaker } from "./components/IframeBreaker";
import { useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { useEffect } from "react";

export default function App() {
  // Hard-code the API key to avoid hydration mismatch
  const apiKey = "ba2c932cf6717c8fb6207fcc8111fe70";
  const appBridgeVersion = "1";
  const location = useLocation();

  // Ensure Re:plain widget stays visible during SPA navigation
  useEffect(() => {
    if (typeof window === "undefined") return;

    const widgetSelectors = [
      "#__replain_widget",
      "#__replain_widget_embedded",
      "#__replain_widget_iframe",
      "#__replain_widget_iframe_embedded",
    ];
    const widget = document.querySelector(widgetSelectors.join(","));
    if (widget) {
      const el = widget as HTMLElement;
      if (el.style.display === "none") el.style.display = "";
      if (el.style.visibility === "hidden") el.style.visibility = "visible";
      return;
    }

    (window as any).replainSettings = { id: "ec6d6852-b600-407d-aca2-d8fec78d69b1" };

    const hasScript = document.querySelector('script[data-replain-script="true"]');
    if (hasScript) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://widget.replain.cc/dist/client.js";
    script.setAttribute("data-replain-script", "true");
    script.onload = () => {
      (window as any).replainInjected = true;
    };
    script.onerror = () => {
      (window as any).replainInjected = false;
    };
    document.head.appendChild(script);
  }, [location.pathname, location.search]);

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={apiKey} />
        <meta name="no-browser-extensions" content="true" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <script src={`https://cdn.shopify.com/shopifycloud/app-bridge.js?v=${appBridgeVersion}`} />
        <Meta />
        <Links />
      </head>
      <body>
        <IframeBreaker />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        {/* Re:plain Live Chat Widget injected in useEffect */}
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const errorId = 'error-' + Date.now();
  
  // Log to monitoring service
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Log to Sentry if available
      if ((window as Record<string, unknown>).Sentry) {
        ((window as Record<string, unknown>).Sentry as { captureException: (error: unknown) => void }).captureException(error);
      }
      
      // Also log to console for debugging (client-side error logging)
      console.error('App Error:', {
        errorId,
        error,
        timestamp: new Date().toISOString()
      });
    }
  }, [error, errorId]);

  // Check if it's a known error type
  if (isRouteErrorResponse(error)) {
    return (
      <html>
        <head>
          <title>{error.status} {error.statusText}</title>
          <Meta />
          <Links />
        </head>
        <body>
          <div className="error-page">
            <h1 className="error-status">{error.status}</h1>
            <p className="error-message">{error.statusText}</p>
            {error.data?.message && (
              <p className="error-details">{error.data.message}</p>
            )}
            <p className="error-id">Error ID: {errorId}</p>
          </div>
          <Scripts />
          {/* Re:plain Live Chat Widget intentionally not reinjected in error boundary */}
        </body>
      </html>
    );
  }

  return (
    <html>
      <head>
        <title>Something went wrong | Cart Uplift</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div className="error-page">
          <h1 className="error-title">Oops! Something went wrong</h1>
          <p className="error-description">
            We're working on fixing this issue. Please try refreshing the page.
          </p>
          {error instanceof Error && (
            <details className="error-details-dev">
              <summary className="error-summary">Error Details</summary>
              <pre className="error-stack">
                {error.stack || error.message}
              </pre>
            </details>
          )}
          <p className="error-id">Error ID: {errorId}</p>
        </div>
        <Scripts />
        {/* Re:plain Live Chat Widget intentionally not reinjected in error boundary */}
      </body>
    </html>
  );
}
