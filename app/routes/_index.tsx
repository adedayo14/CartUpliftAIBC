import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

// Preserve query params (e.g., host, shop, embedded) when redirecting to /app
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const search = url.search; // includes leading '?', or empty string
  return redirect(`/app${search}`);
};

