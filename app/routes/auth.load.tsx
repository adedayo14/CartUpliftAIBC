import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  verifySignedPayload,
  extractStoreHash,
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
  const context = url.searchParams.get("context");

  if (!signedPayload) {
    logger.warn("Missing signed_payload_jwt in load callback", {
      hasContext: !!context,
    });
    if (context && /^[a-z0-9]+$/i.test(context)) {
      return redirect(`/auth?error=no_session&context=${context}`);
    }
    return redirect("/auth?error=no_session");
  }

  try {
    // Verify and decode the JWT
    const payload = verifySignedPayload(signedPayload);
    // BC JWT may have store_hash directly, or in sub/context as "stores/{hash}"
    const storeHash = payload.store_hash
      || extractStoreHash(payload.sub || payload.context || "");

    logger.info("Load callback JWT decoded", {
      storeHash,
      hasStoreHash: !!payload.store_hash,
      sub: payload.sub,
      context: payload.context,
    });

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
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Load callback failed", { message: errMsg });
    return new Response("Failed to verify session. Please try again.", {
      status: 401,
    });
  }
};
