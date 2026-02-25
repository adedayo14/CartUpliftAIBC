import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "@remix-run/react";
import { useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { useEffect } from "react";
import type { LinksFunction } from "@remix-run/node";
import { GlobalStyles } from "@bigcommerce/big-design";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700&display=swap",
  },
];

export default function App() {
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
        <Meta />
        <Links />
      </head>
      <body>
        <GlobalStyles />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const errorId = 'error-' + Date.now();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if ((window as Record<string, unknown>).Sentry) {
        ((window as Record<string, unknown>).Sentry as { captureException: (error: unknown) => void }).captureException(error);
      }

      console.error('App Error:', {
        errorId,
        error,
        timestamp: new Date().toISOString()
      });
    }
  }, [error, errorId]);

  if (isRouteErrorResponse(error)) {
    return (
      <html>
        <head>
          <title>{error.status} {error.statusText}</title>
          <Meta />
          <Links />
        </head>
      <body>
        <GlobalStyles />
        <div className="error-page">
          <h1 className="error-status">{error.status}</h1>
            <p className="error-message">{error.statusText}</p>
            {error.data?.message && (
              <p className="error-details">{error.data.message}</p>
            )}
            <p className="error-id">Error ID: {errorId}</p>
          </div>
          <Scripts />
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
        <GlobalStyles />
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
      </body>
    </html>
  );
}
