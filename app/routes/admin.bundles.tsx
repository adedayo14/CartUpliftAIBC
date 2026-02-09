import { Outlet, useRouteError } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

// This is a layout route - child routes render in the <Outlet />
// - /admin/bundles -> admin.bundles._index.tsx (list view)
// - /admin/bundles/new -> admin.bundles.new.tsx (create)
// - /admin/bundles/:id -> admin.bundles.$id.tsx (edit)

export interface Bundle {
  id: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  discountType: string;
  discountValue: number;
  totalPurchases: number;
  totalRevenue: number;
  createdAt: string;
  productIds: string | null;
  collectionIds: string | null;
  assignedProducts: string | null;
  bundleStyle: "fbt" | "grid" | "list" | "carousel" | "tier" | null;
  minProducts: number | null;
  minBundlePrice: number | null;
  selectMinQty: number | null;
  selectMaxQty: number | null;
  allowDeselect: boolean | null;
  hideIfNoML: boolean | null;
  tierConfig: { qty: number; discount: number }[] | null;
}

/**
 * Layout loader intentionally does not run authentication so that
 * transient token refreshes triggered by App Bridge do not flash
 * the error boundary. Each child route performs its own auth.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  return json({ success: true });
};

// Layout component for bundles routes
// Version: v6.0.0 - Added auth and error boundary
export default function BundlesLayout() {
  return <Outlet />;
}

/**
 * Error boundary to catch and display auth and routing errors gracefully
 * Returns minimal UI to prevent flash during revalidation
 */
export function ErrorBoundary() {
  const error = useRouteError();

  // For bundles route, silently return to normal view instead of showing error
  // This prevents error flashes during revalidation after user actions
  return <Outlet />;
}
