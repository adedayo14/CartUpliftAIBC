import type { LoaderFunctionArgs } from "@remix-run/node";
import { verifySignedPayload, extractStoreHash, deleteStoreUser } from "../bigcommerce.server";
import { logger } from "~/utils/logger.server";

/**
 * BigCommerce Remove User Callback
 *
 * Called when a user is removed from a store that has the app installed.
 * Receives: signed_payload_jwt
 * We log the event but don't delete data since other users may still use the app.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const signedPayload = url.searchParams.get("signed_payload_jwt");

  if (!signedPayload) {
    return new Response("Missing signed_payload_jwt", { status: 400 });
  }

  try {
    const payload = verifySignedPayload(signedPayload);
    const storeHash = payload.store_hash
      || extractStoreHash(payload.sub || payload.context || "");

    logger.info("User removed from store", {
      storeHash,
      userId: payload.user.id,
    });

    await deleteStoreUser({
      storeHash,
      userId: payload.user.id,
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Remove user callback failed", { message: errMsg });
    return new Response("Failed", { status: 500 });
  }
};
