import prisma from "./db.server";
import { logger } from "~/utils/logger.server";
import { createCookieSessionStorage, redirect } from "@remix-run/node";
import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "node:crypto";

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
  sub?: string; // JWT subject: "stores/{store_hash}"
  context?: string; // "stores/{store_hash}"
  store_hash?: string; // May or may not be present directly
  timestamp?: number;
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
      audience: bcConfig.clientId,
      issuer: "bc",
    });
    return decoded as BCSignedPayload;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to verify BigCommerce signed payload", { message: errMsg });
    throw new Error("Invalid signed_payload");
  }
}

// ─── Webhook Signature Verification ─────────────────────────────────────────

const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 300;

function decodeWebhookSecret(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed.startsWith("whsec_")) {
    const base64Part = trimmed.slice("whsec_".length);
    try {
      return Buffer.from(base64Part, "base64");
    } catch (_e) {
      return Buffer.from(base64Part, "utf8");
    }
  }

  const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0;
  if (looksBase64) {
    try {
      return Buffer.from(trimmed, "base64");
    } catch (_e) {
      // fall through to utf8
    }
  }

  return Buffer.from(trimmed, "utf8");
}

function verifyStandardWebhookSignature(
  body: string,
  headers: Headers,
  secret: string
): { valid: boolean; reason?: string } {
  const id = headers.get("webhook-id") || headers.get("svix-id");
  const timestamp = headers.get("webhook-timestamp") || headers.get("svix-timestamp");
  const signatureHeader = headers.get("webhook-signature") || headers.get("svix-signature");

  if (!id || !timestamp || !signatureHeader) {
    return { valid: false, reason: "missing_headers" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > STANDARD_WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  const signedPayload = `${id}.${timestamp}.${body}`;
  const secretBytes = decodeWebhookSecret(secret);
  const expectedSignature = createHmac("sha256", secretBytes)
    .update(signedPayload, "utf8")
    .digest("base64");

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedSignatures = signatureHeader
    .split(" ")
    .map((entry) => entry.split(",", 2)[1] || entry)
    .filter(Boolean);

  for (const signature of providedSignatures) {
    const signatureBuffer = Buffer.from(signature);
    if (
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "signature_mismatch" };
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
  const storeHash = normalizeStoreHash(data.storeHash);
  if (!storeHash) {
    throw new Error("Invalid store hash while saving session");
  }

  const sessionId = `bc_${storeHash}`;

  await prisma.session.upsert({
    where: { id: sessionId },
    update: {
      accessToken: data.accessToken,
      scope: data.scope,
      userId: BigInt(data.userId),
      email: data.email,
      storeHash,
    },
    create: {
      id: sessionId,
      storeHash,
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
  const normalizedStoreHash = normalizeStoreHash(storeHash);
  if (!normalizedStoreHash) return null;

  const session = await prisma.session.findFirst({
    where: { storeHash: normalizedStoreHash },
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
  const normalizedStoreHash = normalizeStoreHash(storeHash);
  if (!normalizedStoreHash) {
    logger.warn("Skipping session delete for invalid store hash", { storeHash });
    return;
  }

  await prisma.session.deleteMany({
    where: { storeHash: normalizedStoreHash },
  });
}

// ─── Store Users (Multi-User Support) ───────────────────────────────────────

/**
 * Upsert a BigCommerce control panel user for a store.
 */
export async function upsertStoreUser(data: {
  storeHash: string;
  userId: number;
  email: string;
  isOwner?: boolean;
}): Promise<void> {
  const storeHash = normalizeStoreHash(data.storeHash);
  if (!storeHash) {
    throw new Error("Invalid store hash while upserting store user");
  }

  await prisma.storeUser.upsert({
    where: {
      storeHash_bcUserId: {
        storeHash,
        bcUserId: BigInt(data.userId),
      },
    },
    update: {
      email: data.email,
      isOwner: data.isOwner ?? false,
    },
    create: {
      storeHash,
      bcUserId: BigInt(data.userId),
      email: data.email,
      isOwner: data.isOwner ?? false,
    },
  });
}

/**
 * Remove a specific store user (called on /auth/remove-user).
 */
export async function deleteStoreUser(data: {
  storeHash: string;
  userId: number;
}): Promise<void> {
  const storeHash = normalizeStoreHash(data.storeHash);
  if (!storeHash) {
    logger.warn("Skipping store user delete for invalid store hash", { storeHash: data.storeHash, userId: data.userId });
    return;
  }

  await prisma.storeUser.deleteMany({
    where: {
      storeHash,
      bcUserId: BigInt(data.userId),
    },
  });
}

/**
 * Remove all store users (called on uninstall).
 */
export async function deleteStoreUsers(storeHash: string): Promise<void> {
  const normalizedStoreHash = normalizeStoreHash(storeHash);
  if (!normalizedStoreHash) {
    logger.warn("Skipping store-user delete for invalid store hash", { storeHash });
    return;
  }

  await prisma.storeUser.deleteMany({
    where: { storeHash: normalizedStoreHash },
  });
}

// ─── Request Authentication ──────────────────────────────────────────────────

const STORE_HASH_REGEX = /^[a-z0-9]+$/i;

function normalizeStoreHash(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return STORE_HASH_REGEX.test(trimmed) ? trimmed : undefined;
}

function isApiLikeRequest(request: Request): boolean {
  const accept = request.headers.get("accept") || "";
  const path = new URL(request.url).pathname;

  return (
    request.method.toUpperCase() !== "GET" ||
    accept.includes("application/json") ||
    request.headers.get("x-remix-request") === "true" ||
    request.headers.get("x-remix-fetch") === "true" ||
    request.headers.get("x-requested-with")?.toLowerCase() === "xmlhttprequest" ||
    path.startsWith("/admin/api/") ||
    path.startsWith("/api/")
  );
}

function buildSessionExpiredResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "Session expired",
      message: "Your session has expired. Please reload the app from BigCommerce.",
      needsRefresh: true,
    }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

function resolveStoreHashFromRequest(request: Request): string | undefined {
  const url = new URL(request.url);
  const fromQuery = normalizeStoreHash(url.searchParams.get("context"));
  if (fromQuery) return fromQuery;

  const fromHeader = normalizeStoreHash(
    request.headers.get("x-store-hash") || request.headers.get("x-bc-context")
  );
  if (fromHeader) return fromHeader;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const fromReferer = normalizeStoreHash(refererUrl.searchParams.get("context"));
      if (fromReferer) return fromReferer;
    } catch {
      // Ignore malformed referrer values.
    }
  }

  return undefined;
}

/**
 * Authenticate an admin request by reading the session cookie.
 * Falls back to URL `context` param for browsers that block third-party cookies (iframe).
 * Returns the BigCommerce session or redirects to install.
 */
export async function authenticateAdmin(request: Request): Promise<{
  session: BigCommerceSession;
  storeHash: string;
}> {
  const isApiRequest = isApiLikeRequest(request);

  const cookieSession = await cookieSessionStorage.getSession(
    request.headers.get("Cookie")
  );

  let storeHash = normalizeStoreHash(cookieSession.get("storeHash") as string | undefined);

  // Fallbacks for iframe contexts where third-party cookies may be blocked.
  if (!storeHash) {
    storeHash = resolveStoreHashFromRequest(request);
  }

  if (!storeHash) {
    if (isApiRequest) {
      throw buildSessionExpiredResponse();
    }

    throw redirect("/auth?error=no_session");
  }

  const session = await getStoreSession(storeHash);

  if (!session) {
    if (isApiRequest) {
      throw buildSessionExpiredResponse();
    }
    throw redirect("/auth?error=no_session");
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
  const hasStandardHeaders =
    request.headers.has("webhook-id") ||
    request.headers.has("svix-id") ||
    request.headers.has("webhook-signature") ||
    request.headers.has("svix-signature");

  if (hasStandardHeaders) {
    const verification = verifyStandardWebhookSignature(body, request.headers, bcConfig.clientSecret);
    if (!verification.valid) {
      logger.warn("Webhook signature verification failed", {
        reason: verification.reason,
        hasId: request.headers.has("webhook-id") || request.headers.has("svix-id"),
        hasTimestamp: request.headers.has("webhook-timestamp") || request.headers.has("svix-timestamp"),
        hasSignature: request.headers.has("webhook-signature") || request.headers.has("svix-signature"),
      });
      throw new Response("Invalid webhook signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    logger.warn("Missing Standard Webhooks headers in production");
    throw new Response("Missing webhook signature headers", { status: 401 });
  } else {
    logger.warn("Missing Standard Webhooks headers; skipping signature verification in non-production");
  }

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

function getStorefrontScripts(appUrl: string, storeHash?: string) {
  const query = storeHash ? `?store_hash=${encodeURIComponent(storeHash)}` : "";

  return [
    {
      name: "CartUplift Cart Drawer",
      src: `${appUrl}/storefront/cart-uplift.js${query}`,
      auto_uninstall: true,
      load_method: "default",
      location: "footer",
      visibility: "all_pages",
      kind: "src",
      consent_category: "essential",
    },
    {
      name: "CartUplift Bundles",
      src: `${appUrl}/storefront/cart-bundles.js${query}`,
      auto_uninstall: true,
      load_method: "default",
      location: "footer",
      visibility: "all_pages",
      kind: "src",
      consent_category: "essential",
    },
  ];
}

/**
 * Ensure the expected storefront scripts exist with the current app URL/query params.
 * Updates stale versions and keeps canonical scripts in place.
 */
export async function ensureStorefrontScripts(storeHash: string): Promise<void> {
  const listResponse = await bigcommerceApi(storeHash, "/content/scripts");
  if (!listResponse.ok) {
    const errorData = await listResponse.json().catch(() => ({}));
    logger.warn("Failed to list storefront scripts during sync", { storeHash, error: errorData });
    return;
  }

  const listData = await listResponse.json();
  const existing = (listData?.data as Array<{ uuid: string; name?: string; src?: string }>) || [];
  const scripts = getStorefrontScripts(bcConfig.appUrl, storeHash);

  for (const script of scripts) {
    // Remove ALL existing scripts with the same name to ensure config is up to date
    const sameName = existing.filter((item) => item.name === script.name);
    for (const old of sameName) {
      const deleteResp = await bigcommerceApi(storeHash, `/content/scripts/${old.uuid}`, {
        method: "DELETE",
      });
      if (deleteResp.ok) {
        logger.info("Removed old storefront script", { storeHash, name: old.name, uuid: old.uuid });
      } else {
        const errorData = await deleteResp.json().catch(() => ({}));
        logger.warn("Failed to remove old storefront script", { storeHash, uuid: old.uuid, error: errorData });
      }
    }

    // Create fresh script with current config
    const response = await bigcommerceApi(storeHash, "/content/scripts", {
      method: "POST",
      body: script,
    });

    if (response.ok) {
      logger.info("Storefront script installed", { storeHash, name: script.name });
      continue;
    }

    const errorData = await response.json().catch(() => ({}));
    logger.error("Script installation failed", { storeHash, name: script.name, error: errorData });
  }
}

/**
 * Remove storefront scripts installed by Cart Uplift.
 */
export async function cleanupStorefrontScripts(storeHash: string): Promise<void> {
  try {
    const session = await getStoreSession(storeHash);
    if (!session) {
      logger.info("Skipping storefront script cleanup; no active session", { storeHash });
      return;
    }

    const listResponse = await bigcommerceApi(storeHash, "/content/scripts");
    if (!listResponse.ok) {
      const errorData = await listResponse.json().catch(() => ({}));
      logger.warn("Failed to list storefront scripts", { storeHash, error: errorData });
      return;
    }

    const listData = await listResponse.json();
    const existing = (listData?.data as Array<{ uuid: string; name?: string; src?: string }>) || [];
    const targets = getStorefrontScripts(bcConfig.appUrl);

    const toRemove = existing.filter(script =>
      targets.some(target => target.name === script.name || target.src === script.src)
    );

    for (const script of toRemove) {
      const response = await bigcommerceApi(storeHash, `/content/scripts/${script.uuid}`, {
        method: "DELETE",
      });
      if (response.ok) {
        logger.info("Storefront script removed", { storeHash, uuid: script.uuid, name: script.name });
      } else {
        const errorData = await response.json().catch(() => ({}));
        logger.warn("Failed to remove storefront script", { storeHash, uuid: script.uuid, error: errorData });
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn("Storefront script cleanup failed", { storeHash, message: errMsg });
  }
}

// ─── After Auth Hook ─────────────────────────────────────────────────────────

/**
 * Run post-install tasks: register webhooks, create starter bundle, fetch store info.
 */
export async function afterAuthSetup(storeHash: string, accountUuid?: string): Promise<void> {
  const appUrl = bcConfig.appUrl;

  if (accountUuid) {
    await prisma.settings.upsert({
      where: { storeHash },
      update: { accountUuid },
      create: { storeHash, accountUuid },
    });
  }

  // 1. Fetch store info (currency, name, email)
  try {
    const storeResponse = await bigcommerceApi(storeHash, "/store", { version: "v2" });
    if (storeResponse.ok) {
      const storeData = await storeResponse.json();
      const resolvedAccountUuid = accountUuid || storeData.account_uuid || storeData.accountUuid;
      await prisma.settings.upsert({
        where: { storeHash },
        update: {
          ownerEmail: storeData.admin_email || null,
          currencyCode: storeData.currency || null,
          accountUuid: resolvedAccountUuid || undefined,
        },
        create: {
          storeHash,
          ownerEmail: storeData.admin_email || null,
          currencyCode: storeData.currency || null,
          accountUuid: resolvedAccountUuid || null,
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
        const title = (errorData as { title?: string })?.title || "";
        const alreadyExists =
          response.status === 409
          || (response.status === 422 && /already exists/i.test(title));

        // 409/422 duplicate hook responses are non-fatal.
        if (alreadyExists) {
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
    await ensureStorefrontScripts(storeHash);
  } catch (error) {
    logger.error("Failed to install storefront scripts", { storeHash, error });
  }
}
