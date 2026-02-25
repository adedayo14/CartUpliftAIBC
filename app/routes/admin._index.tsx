import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

/**
 * /admin → redirect to /admin/dashboard
 * Preserves `context` query param for third-party cookie fallback.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const context = url.searchParams.get("context");
  const target = context ? `/admin/dashboard?context=${context}` : "/admin/dashboard";
  return redirect(target);
};
