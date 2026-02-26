import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { authenticateAdmin } from "../bigcommerce.server";
import { SessionStatus } from "../components/SessionStatus";
import { ClientOnly } from "../components/ClientOnly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);
  return json({ storeHash });
};

export default function AppLayout() {
  const { storeHash } = useLoaderData<typeof loader>();

  return (
    <ClientOnly fallback={null}>
      {() => (
        <>
          <SessionStatus storeHash={storeHash} />
          <Outlet />
        </>
      )}
    </ClientOnly>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[App Layout] Error:", error);

  return (
    <div>
      <h3>Something went wrong</h3>
      <p>Please try refreshing the page.</p>
    </div>
  );
}

export const headers: HeadersFunction = () => {
  const headers = new Headers();
  headers.set("Content-Security-Policy", "frame-ancestors https://*.bigcommerce.com https://*.mybigcommerce.com");
  return headers;
};
