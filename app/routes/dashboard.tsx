import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Redirect /dashboard to /admin/dashboard
  const url = new URL(request.url);
  return redirect(`/admin/dashboard${url.search}`, 301);
};
