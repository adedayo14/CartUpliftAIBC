import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  exchangeCodeForToken,
  extractStoreHash,
  saveStoreSession,
  cookieSessionStorage,
  afterAuthSetup,
  upsertStoreUser,
} from "../bigcommerce.server";
import { logger } from "~/utils/logger.server";

/**
 * BigCommerce OAuth Install Callback
 *
 * Called when a merchant installs the app from the BigCommerce App Store.
 * Receives: code, scope, context (stores/{store_hash})
 * Exchanges the code for an access token and stores the session.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const scope = url.searchParams.get("scope");
  const context = url.searchParams.get("context");

  if (!code || !scope || !context) {
    logger.error("Missing OAuth parameters in install callback", {
      hasCode: !!code,
      hasScope: !!scope,
      hasContext: !!context,
    });
    return new Response("Missing required OAuth parameters", { status: 400 });
  }

  try {
    // Exchange auth code for access token
    const tokenData = await exchangeCodeForToken(code, context, scope);
    const storeHash = extractStoreHash(context);

    // Save the session to database
    await saveStoreSession({
      storeHash,
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      userId: tokenData.user.id,
      email: tokenData.user.email,
    });

    // Track installing user (owner status will be updated on /auth/load)
    await upsertStoreUser({
      storeHash,
      userId: tokenData.user.id,
      email: tokenData.user.email,
      isOwner: false,
    });

    logger.info("App installed successfully", {
      storeHash,
      userId: tokenData.user.id,
      email: tokenData.user.email,
    });

    // Run post-install setup (webhooks, scripts, starter bundle)
    // Run async - don't block the redirect
    afterAuthSetup(storeHash, tokenData.account_uuid).catch((error) => {
      logger.error("afterAuthSetup failed", { storeHash, error });
    });

    // Set session cookie and redirect to admin dashboard
    const cookieSession = await cookieSessionStorage.getSession();
    cookieSession.set("storeHash", storeHash);
    cookieSession.set("userId", tokenData.user.id);
    cookieSession.set("email", tokenData.user.email);

    return redirect("/admin", {
      headers: {
        "Set-Cookie": await cookieSessionStorage.commitSession(cookieSession),
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error("OAuth install failed", { message: errMsg, stack: errStack });
    return new Response("Installation failed. Please try again.", {
      status: 500,
    });
  }
};
