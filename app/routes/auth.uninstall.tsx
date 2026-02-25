import type { LoaderFunctionArgs } from "@remix-run/node";
import { verifySignedPayload, deleteStoreSessions, deleteStoreUsers, cleanupStorefrontScripts } from "../bigcommerce.server";
import { logger } from "~/utils/logger.server";

/**
 * BigCommerce Uninstall Callback
 *
 * Called when a merchant uninstalls the app from their BigCommerce store.
 * Receives: signed_payload_jwt
 * Cleans up all sessions for the store.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const signedPayload = url.searchParams.get("signed_payload_jwt");

  if (!signedPayload) {
    return new Response("Missing signed_payload_jwt", { status: 400 });
  }

  try {
    const payload = verifySignedPayload(signedPayload);
    const storeHash = payload.store_hash;

    logger.info("App uninstalled", { storeHash });

    // Best-effort cleanup before credentials are removed
    await cleanupStorefrontScripts(storeHash);

    // Delete all sessions/users for this store
    await deleteStoreSessions(storeHash);
    await deleteStoreUsers(storeHash);

    return new Response("OK", { status: 200 });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Uninstall callback failed", { message: errMsg });
    return new Response("Failed", { status: 500 });
  }
};
