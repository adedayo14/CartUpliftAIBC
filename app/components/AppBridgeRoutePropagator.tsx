import { useEffect } from "react";
import { useLocation } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { History } from "@shopify/app-bridge/actions";

const APP_HANDLE = "cartupliftai";
const APP_BASE_PATH = "/app";

/**
 * Keep the Shopify admin URL in sync with the current Remix route so merchants
 * see clean URLs like /apps/cartupliftai/dashboard when navigating inside the app.
 */
export function AppBridgeRoutePropagator() {
  const app = useAppBridge();
  const location = useLocation();

  useEffect(() => {
    if (typeof window === "undefined" || !app || window.top === window.self) {
      return;
    }

    const history = History.create(app);

    const pathWithoutBase = location.pathname.startsWith(APP_BASE_PATH)
      ? location.pathname.slice(APP_BASE_PATH.length)
      : location.pathname;

    const normalizedPath =
      pathWithoutBase && pathWithoutBase !== "/"
        ? pathWithoutBase.startsWith("/")
          ? pathWithoutBase
          : `/${pathWithoutBase}`
        : "/";

    const searchString = location.search ?? "";
    const adminPath = `/apps/${APP_HANDLE}${normalizedPath}${searchString}`;

    history.dispatch(History.Action.REPLACE, adminPath);
  }, [app, location]);

  return null;
}
