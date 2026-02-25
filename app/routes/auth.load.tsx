import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  verifySignedPayload,
  getStoreSession,
  cookieSessionStorage,
  upsertStoreUser,
} from "../bigcommerce.server";
import { logger } from "~/utils/logger.server";

/**
 * BigCommerce Load Callback
 *
 * Called every time a merchant opens the app from the BigCommerce admin panel.
 * Receives: signed_payload_jwt (JWT signed with client secret)
 * Verifies the JWT, looks up the session, and sets a cookie.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const signedPayload = url.searchParams.get("signed_payload_jwt");

  if (!signedPayload) {
    logger.warn("Missing signed_payload_jwt in load callback");
    return new Response("Missing signed_payload_jwt parameter", {
      status: 400,
    });
  }

  try {
    // Verify and decode the JWT
    const payload = verifySignedPayload(signedPayload);
    const storeHash = payload.store_hash;

    // Look up the store session
    const session = await getStoreSession(storeHash);
    if (!session) {
      logger.warn("No session found for store on load", { storeHash });
      return new Response(
        "App not installed. Please install CartUplift from the BigCommerce App Store.",
        { status: 403 }
      );
    }

    logger.info("App loaded", {
      storeHash,
      userId: payload.user.id,
      email: payload.user.email,
    });

    // Track control panel users for multi-user access
    await upsertStoreUser({
      storeHash,
      userId: payload.user.id,
      email: payload.user.email,
      isOwner: payload.user.id === payload.owner.id,
    });

    // Set session cookie and redirect to admin dashboard
    // Include storeHash in URL as fallback for browsers that block third-party cookies (iframe context)
    const cookieSession = await cookieSessionStorage.getSession();
    cookieSession.set("storeHash", storeHash);
    cookieSession.set("userId", payload.user.id);
    cookieSession.set("email", payload.user.email);

    const setCookie = await cookieSessionStorage.commitSession(cookieSession);

    return redirect(`/admin?context=${storeHash}`, {
      headers: {
        "Set-Cookie": setCookie,
      },
    });
  } catch (error) {
    logger.error("Load callback failed", { error });
    return new Response("Failed to verify session. Please try again.", {
      status: 401,
    });
  }
};
