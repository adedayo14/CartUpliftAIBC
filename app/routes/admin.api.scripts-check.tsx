import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi, ensureStorefrontScripts } from "../bigcommerce.server";

/**
 * GET /admin/api/scripts-check
 *
 * Lists currently installed storefront scripts and optionally re-installs
 * CartUplift scripts. Append ?install=1 to force reinstall.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);
  const url = new URL(request.url);
  const shouldInstall = url.searchParams.get("install") === "1";

  // Check store status via V2 API
  let storeStatus: Record<string, unknown> = {};
  try {
    const storeResponse = await bigcommerceApi(storeHash, "/store", { version: "v2" });
    if (storeResponse.ok) {
      const storeData = await storeResponse.json();
      storeStatus = {
        name: storeData.name,
        status: storeData.status,
        domain: storeData.domain,
        secure_url: storeData.secure_url,
        plan_name: storeData.plan_name,
        is_price_entered_with_tax: storeData.is_price_entered_with_tax,
        stencil_enabled: storeData.features?.stencil_enabled,
      };
    }
  } catch (error) {
    storeStatus = { error: error instanceof Error ? error.message : String(error) };
  }

  // List existing scripts (return ALL fields for debugging)
  let existing: Array<Record<string, unknown>> = [];
  try {
    const listResponse = await bigcommerceApi(storeHash, "/content/scripts");
    if (listResponse.ok) {
      const listData = await listResponse.json();
      existing = (listData?.data || []) as Array<Record<string, unknown>>;
    } else {
      const errorData = await listResponse.json().catch(() => ({}));
      return json({
        storeHash,
        error: "Failed to list scripts",
        status: listResponse.status,
        details: errorData,
      });
    }
  } catch (error) {
    return json({
      storeHash,
      error: "Exception listing scripts",
      details: error instanceof Error ? error.message : String(error),
    });
  }

  // Optionally reinstall
  let installResult: string | null = null;
  if (shouldInstall) {
    try {
      await ensureStorefrontScripts(storeHash);
      installResult = "success";
    } catch (error) {
      installResult = error instanceof Error ? error.message : String(error);
    }
  }

  // Re-list after install
  let afterInstall = existing;
  if (shouldInstall) {
    try {
      const listResponse = await bigcommerceApi(storeHash, "/content/scripts");
      if (listResponse.ok) {
        const listData = await listResponse.json();
        afterInstall = (listData?.data || []) as Array<Record<string, unknown>>;
      }
    } catch {
      // keep existing
    }
  }

  const finalScripts = shouldInstall ? afterInstall : existing;

  return json({
    storeHash,
    storeStatus,
    scripts: finalScripts,
    cartUpliftScripts: finalScripts.filter(
      (s) => String(s.name || "").includes("CartUplift")
    ),
    installResult,
  });
};
