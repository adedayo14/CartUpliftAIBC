import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

/**
 * /admin → redirect to /admin/dashboard
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect("/admin/dashboard");
};
