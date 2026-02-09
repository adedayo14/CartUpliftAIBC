import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { SessionStatus } from "../components/SessionStatus";
import { ClientOnly } from "../components/ClientOnly";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // SHOPIFY_API_KEY is required for App Bridge initialization
  // This is the public Client ID, not the secret
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey) {
    throw new Error('SHOPIFY_API_KEY environment variable is required');
  }

  return { apiKey };
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ClientOnly fallback={null}>
      {() => (
        <AppProvider isEmbeddedApp apiKey={apiKey}>
          <NavMenu>
            <a href="/app/dashboard">Analytics</a>
            <a href="/app/settings">Settings</a>
            <a href="/app/bundles">FBT</a>
          </NavMenu>
          <SessionStatus />
          <Outlet />
        </AppProvider>
      )}
    </ClientOnly>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
