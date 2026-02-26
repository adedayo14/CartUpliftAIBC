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

  // List existing scripts
  let existing: Array<{ uuid: string; name: string; src: string; enabled: boolean }> = [];
  try {
    const listResponse = await bigcommerceApi(storeHash, "/content/scripts");
    if (listResponse.ok) {
      const listData = await listResponse.json();
      existing = (listData?.data || []).map((s: Record<string, unknown>) => ({
        uuid: s.uuid,
        name: s.name,
        src: s.src,
        enabled: s.enabled,
      }));
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
        afterInstall = (listData?.data || []).map((s: Record<string, unknown>) => ({
          uuid: s.uuid,
          name: s.name,
          src: s.src,
          enabled: s.enabled,
        }));
      }
    } catch {
      // keep existing
    }
  }

  return json({
    storeHash,
    scripts: shouldInstall ? afterInstall : existing,
    cartUpliftScripts: (shouldInstall ? afterInstall : existing).filter(
      (s: { name: string }) => s.name.includes("CartUplift")
    ),
    installResult,
  });
};
