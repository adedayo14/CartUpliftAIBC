import prisma from "./db.server";
import { logger } from "~/utils/logger.server";
import { createCookieSessionStorage, redirect } from "@remix-run/node";
import jwt from "jsonwebtoken";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BigCommerceSession {
  storeHash: string;
  accessToken: string;
  scope: string;
  userId: number;
  email: string;
  storeDomain?: string;
}

interface BCOAuthTokenResponse {
  access_token: string;
  scope: string;
  user: {
    id: number;
    username: string;
    email: string;
  };
  context: string; // "stores/{store_hash}"
  account_uuid: string;
}

interface BCSignedPayload {
  user: {
    id: number;
    email: string;
    locale: string;
  };
  owner: {
    id: number;
    email: string;
  };
  context: string; // "stores/{store_hash}"
  store_hash: string;
  timestamp: number;
}

// ─── Environment ─────────────────────────────────────────────────────────────

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const bcConfig = {
  get clientId() { return getEnvOrThrow("BC_CLIENT_ID"); },
  get clientSecret() { return getEnvOrThrow("BC_CLIENT_SECRET"); },
  get appUrl() { return getEnvOrThrow("BC_APP_URL"); },
  get authCallback() { return `${this.appUrl}/auth/install`; },
  get loadCallback() { return `${this.appUrl}/auth/load`; },
  get uninstallCallback() { return `${this.appUrl}/auth/uninstall`; },
  get removeUserCallback() { return `${this.appUrl}/auth/remove-user`; },
};

// ─── Cookie Session Storage ──────────────────────────────────────────────────

const sessionSecret = process.env.SESSION_SECRET || "default-secret-change-me";

export const cookieSessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__bc_session",
    httpOnly: true,
    path: "/",
    sameSite: "none", // Required for iframe embedding in BC admin
    secrets: [sessionSecret],
    secure: true,
    maxAge: 60 * 60 * 24, // 24 hours
  },
});

// ─── OAuth Flow ──────────────────────────────────────────────────────────────

/**
 * Exchange the authorization code for an access token.
 * Called during the /auth/install callback.
 */
export async function exchangeCodeForToken(
  code: string,
  context: string,
  scope: string
): Promise<BCOAuthTokenResponse> {
  const response = await fetch("https://login.bigcommerce.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: bcConfig.clientId,
      client_secret: bcConfig.clientSecret,
      code,
      context,
      scope,
      grant_type: "authorization_code",
      redirect_uri: bcConfig.authCallback,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("BigCommerce OAuth token exchange failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`OAuth token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<BCOAuthTokenResponse>;
}

/**
 * Extract store_hash from BigCommerce context string.
 * Context format: "stores/{store_hash}" or "stores/{store_hash}/..."
 */
export function extractStoreHash(context: string): string {
  const match = context.match(/^stores\/([a-z0-9]+)/i);
  if (!match) throw new Error(`Invalid BigCommerce context: ${context}`);
  return match[1];
}

/**
 * Verify and decode a BigCommerce signed_payload (JWT).
 * Used for /auth/load, /auth/uninstall, /auth/remove-user callbacks.
 */
export function verifySignedPayload(signedPayload: string): BCSignedPayload {
  try {
    const decoded = jwt.verify(signedPayload, bcConfig.clientSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    });
    return decoded as BCSignedPayload;
  } catch (error) {
    logger.error("Failed to verify BigCommerce signed payload", { error });
    throw new Error("Invalid signed_payload");
  }
}

// ─── Session Management ──────────────────────────────────────────────────────

/**
 * Save or update a BigCommerce store session in the database.
 */
export async function saveStoreSession(data: {
  storeHash: string;
  accessToken: string;
  scope: string;
  userId: number;
  email: string;
}): Promise<void> {
  const sessionId = `bc_${data.storeHash}`;

  await prisma.session.upsert({
    where: { id: sessionId },
    update: {
      accessToken: data.accessToken,
      scope: data.scope,
      userId: BigInt(data.userId),
      email: data.email,
      storeHash: data.storeHash,
    },
    create: {
      id: sessionId,
      storeHash: data.storeHash,
      state: "installed",
      isOnline: false,
      accessToken: data.accessToken,
      scope: data.scope,
      userId: BigInt(data.userId),
      email: data.email,
    },
  });
}

/**
 * Get a stored session for a BigCommerce store.
 */
export async function getStoreSession(storeHash: string): Promise<BigCommerceSession | null> {
  const session = await prisma.session.findFirst({
    where: { storeHash },
  });

  if (!session) return null;

  return {
    storeHash: session.storeHash!,
    accessToken: session.accessToken,
    scope: session.scope || "",
    userId: Number(session.userId || 0),
    email: session.email || "",
    storeDomain: session.storeDomain || undefined,
  };
}

/**
 * Delete all sessions for a store (on uninstall).
 */
export async function deleteStoreSessions(storeHash: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { storeHash },
  });
}

// ─── Request Authentication ──────────────────────────────────────────────────

/**
 * Authenticate an admin request by reading the session cookie.
 * Returns the BigCommerce session or redirects to install.
 */
export async function authenticateAdmin(request: Request): Promise<{
  session: BigCommerceSession;
  storeHash: string;
}> {
  const cookieSession = await cookieSessionStorage.getSession(
    request.headers.get("Cookie")
  );

  const storeHash = cookieSession.get("storeHash") as string | undefined;

  if (!storeHash) {
    // Check if this is an API/fetcher request
    const isApiRequest =
      request.headers.get("accept")?.includes("application/json") ||
      request.method === "POST";

    if (isApiRequest) {
      throw new Response(
        JSON.stringify({
          error: "Session expired",
          message: "Your session has expired. Please reload the app.",
          needsRefresh: true,
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    throw redirect("/auth/load?error=no_session");
  }

  const session = await getStoreSession(storeHash);

  if (!session) {
    throw redirect("/auth/load?error=no_session");
  }

  return { session, storeHash };
}

/**
 * Authenticate a BigCommerce webhook request.
 * BC webhooks are sent over HTTPS. We validate using a shared secret header.
 */
export async function authenticateWebhook(request: Request): Promise<{
  storeHash: string;
  payload: Record<string, unknown>;
}> {
  const body = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }

  // BigCommerce webhook payload includes producer field: "stores/{store_hash}"
  const producer = payload.producer as string | undefined;
  if (!producer) {
    throw new Response("Missing producer field", { status: 400 });
  }

  const storeHash = extractStoreHash(producer);

  // Verify the store exists in our database
  const session = await getStoreSession(storeHash);
  if (!session) {
    logger.warn("Webhook received for unknown store", { storeHash });
    throw new Response("Unknown store", { status: 404 });
  }

  // Optional: validate custom webhook secret header
  const webhookSecret = request.headers.get("x-webhook-secret");
  if (process.env.BC_WEBHOOK_SECRET && webhookSecret !== process.env.BC_WEBHOOK_SECRET) {
    logger.warn("Invalid webhook secret", { storeHash });
    throw new Response("Invalid webhook secret", { status: 401 });
  }

  return { storeHash, payload };
}

// ─── BigCommerce API Client ──────────────────────────────────────────────────

/**
 * Make an authenticated request to the BigCommerce API.
 */
export async function bigcommerceApi(
  storeHash: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    version?: "v2" | "v3";
  } = {}
): Promise<Response> {
  const session = await getStoreSession(storeHash);
  if (!session) throw new Error(`No session found for store: ${storeHash}`);

  const { method = "GET", body, version = "v3" } = options;
  const baseUrl = `https://api.bigcommerce.com/stores/${storeHash}/${version}`;

  const headers: Record<string, string> = {
    "X-Auth-Token": session.accessToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return response;
}

// ─── After Auth Hook ─────────────────────────────────────────────────────────

/**
 * Run post-install tasks: register webhooks, create starter bundle, fetch store info.
 */
export async function afterAuthSetup(storeHash: string): Promise<void> {
  const appUrl = bcConfig.appUrl;

  // 1. Fetch store info (currency, name, email)
  try {
    const storeResponse = await bigcommerceApi(storeHash, "/store", { version: "v2" });
    if (storeResponse.ok) {
      const storeData = await storeResponse.json();
      await prisma.settings.upsert({
        where: { storeHash },
        update: {
          ownerEmail: storeData.admin_email || null,
          currencyCode: storeData.currency || null,
        },
        create: {
          storeHash,
          ownerEmail: storeData.admin_email || null,
          currencyCode: storeData.currency || null,
        },
      });
      logger.info("Store info captured", { storeHash, email: storeData.admin_email });
    }
  } catch (error) {
    logger.error("Failed to fetch store info", { storeHash, error });
  }

  // 2. Register webhooks
  const webhooks = [
    { scope: "store/order/created", destination: `${appUrl}/webhooks/orders/create` },
    { scope: "store/app/uninstalled", destination: `${appUrl}/webhooks/app/uninstalled` },
  ];

  for (const webhook of webhooks) {
    try {
      const response = await bigcommerceApi(storeHash, "/hooks", {
        method: "POST",
        body: {
          scope: webhook.scope,
          destination: webhook.destination,
          is_active: true,
          headers: process.env.BC_WEBHOOK_SECRET
            ? { "x-webhook-secret": process.env.BC_WEBHOOK_SECRET }
            : {},
        },
      });

      if (response.ok) {
        logger.info("Webhook registered", { storeHash, scope: webhook.scope });
      } else {
        const errorData = await response.json().catch(() => ({}));
        // 409 = webhook already exists, that's fine
        if (response.status === 409) {
          logger.info("Webhook already exists", { storeHash, scope: webhook.scope });
        } else {
          logger.error("Webhook registration failed", { storeHash, scope: webhook.scope, error: errorData });
        }
      }
    } catch (error) {
      logger.error("Failed to register webhook", { storeHash, scope: webhook.scope, error });
    }
  }

  // 3. Auto-create starter ML bundle (if none exists)
  try {
    const existingBundles = await prisma.bundle.count({
      where: { storeHash },
    });

    if (existingBundles === 0) {
      logger.info("Creating starter ML bundle", { storeHash });

      await prisma.bundle.create({
        data: {
          storeHash,
          name: "Frequently Bought Together",
          description: "AI-powered product recommendations based on shopping patterns",
          type: "ai_suggested",
          status: "active",
          discountType: "percentage",
          discountValue: 0,
          minProducts: 2,
          assignmentType: "all",
          bundleStyle: "grid",
          allowDeselect: true,
          hideIfNoML: false,
          productIds: "[]",
          collectionIds: "[]",
          assignedProducts: "[]",
        },
      });

      logger.info("Starter ML bundle created", { storeHash });
    }
  } catch (error) {
    logger.error("Failed to create starter bundle", { storeHash, error });
  }

  // 4. Install storefront scripts via Scripts API
  try {
    const scripts = [
      {
        name: "CartUplift Cart Drawer",
        src: `${appUrl}/storefront/cart-uplift.js`,
        auto_uninstall: true,
        load_method: "default",
        location: "footer",
        visibility: "storefront",
        kind: "src",
        consent_category: "functional",
      },
      {
        name: "CartUplift Bundles",
        src: `${appUrl}/storefront/cart-bundles.js`,
        auto_uninstall: true,
        load_method: "default",
        location: "footer",
        visibility: "storefront",
        kind: "src",
        consent_category: "functional",
      },
    ];

    for (const script of scripts) {
      const response = await bigcommerceApi(storeHash, "/content/scripts", {
        method: "POST",
        body: script,
      });
      if (response.ok) {
        logger.info("Storefront script installed", { storeHash, name: script.name });
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.error("Script installation failed", { storeHash, name: script.name, error: errorData });
      }
    }
  } catch (error) {
    logger.error("Failed to install storefront scripts", { storeHash, error });
  }
}
