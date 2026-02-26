// Authentication utilities for BigCommerce apps (loaded in iframe)

export function isEmbeddedApp(): boolean {
  if (typeof window === 'undefined') return false;
  return window.top !== window.self;
}

export function initializeAppBridge(): void {
  // No-op for BigCommerce - no App Bridge initialization needed
  // BigCommerce apps run in an iframe with cookie-based auth
}

function resolveStoreHash(fallbackStoreHash?: string): string | undefined {
  if (typeof window === "undefined") return fallbackStoreHash;

  const fromUrl = new URLSearchParams(window.location.search).get("context");
  if (fromUrl) {
    sessionStorage.setItem("bc_store_hash", fromUrl);
    return fromUrl;
  }

  return fallbackStoreHash || sessionStorage.getItem("bc_store_hash") || undefined;
}

export function reauthorizeApp(fallbackStoreHash?: string): void {
  const storeHash = resolveStoreHash(fallbackStoreHash);

  if (storeHash) {
    const path = window.location.pathname.startsWith("/admin")
      ? window.location.pathname
      : "/admin/dashboard";
    window.location.href = `${path}?context=${encodeURIComponent(storeHash)}`;
    return;
  }

  // We cannot self-call /auth/load; that endpoint requires a BC-signed JWT.
  window.location.href = "/auth?error=no_session";
}

export function handleAuthError(error: unknown): void {
  if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
    console.warn('Authentication error:', error);
  }

  // Check if this is a 401 error
  if (error && typeof error === 'object' && 'status' in error) {
    const responseError = error as { status: number };
    if (responseError.status === 401) {
      reauthorizeApp();
      return;
    }
  }
}
