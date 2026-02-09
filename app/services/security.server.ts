// Phase 3: Advanced security utilities
import crypto from "crypto";

export const SecurityHeaders = {
  // Content Security Policy
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.shopify.com https://*.shopifycdn.com https://cdn.shopify.com https://cdn.shopifycdn.net https://widget.replain.cc",
    "style-src 'self' 'unsafe-inline' https://*.shopify.com https://*.shopifycdn.com https://cdn.shopify.com https://fonts.googleapis.com https://widget.replain.cc",
    "img-src 'self' data: blob: https://*.shopify.com https://*.shopifycdn.com https://cdn.shopify.com https://assets.replain.cc https://storage.replain.cc",
    "font-src 'self' https://fonts.gstatic.com https://*.shopify.com https://*.shopifycdn.com",
    "connect-src 'self' https://*.shopify.com https://*.myshopify.com https://cdn.shopify.com wss://*.shopify.com wss://*.myshopify.com https://widget.replain.cc https://app.replain.cc https://ws.replain.cc wss://widget.replain.cc wss://app.replain.cc wss://ws.replain.cc",
    "media-src 'self' https://widget.replain.cc",
    "frame-src 'self' https://*.shopify.com https://*.myshopify.com",
  "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.shopify.com",
  ].join("; "),
  
  // Additional security headers
  "X-Content-Type-Options": "nosniff",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

/**
 * Input sanitization for user-provided data
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  return input
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Validate shop domain format
 */
export function validateShopDomain(shop: string): boolean {
  if (!shop || typeof shop !== 'string') return false;
  
  const shopPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]\.myshopify\.com$/i;
  return shopPattern.test(shop);
}

/**
 * Generate secure random tokens
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Time-safe string comparison to prevent timing attacks
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Extract and validate IP address from request
 */
export function getClientIP(request: { headers: { get: (name: string) => string | null } }): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const remoteAddr = request.headers.get('x-remote-addr');

  // Parse forwarded header (format: "client, proxy1, proxy2")
  if (forwarded) {
    const ips = forwarded.split(',').map((ip: string) => ip.trim());
    const clientIP = ips[0];

    // Basic IP validation
    if (isValidIP(clientIP)) {
      return clientIP;
    }
  }

  if (realIP && isValidIP(realIP)) {
    return realIP;
  }

  if (remoteAddr && isValidIP(remoteAddr)) {
    return remoteAddr;
  }

  return '127.0.0.1'; // Fallback
}

function isValidIP(ip: string): boolean {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;

  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip);
}

/**
 * Validate and sanitize product ID (Shopify product IDs are numeric)
 */
export function validateProductId(productId: string | null | undefined): string | null {
  if (!productId) return null;

  // Remove any GID prefix if present (gid://shopify/Product/123 -> 123)
  const cleanId = productId.replace(/^gid:\/\/shopify\/Product\//, '');

  // Validate it's a valid number
  if (!/^\d+$/.test(cleanId)) {
    return null;
  }

  return cleanId;
}

/**
 * Validate and sanitize variant ID
 */
export function validateVariantId(variantId: string | null | undefined): string | null {
  if (!variantId) return null;

  // Remove any GID prefix if present
  const cleanId = variantId.replace(/^gid:\/\/shopify\/ProductVariant\//, '');

  // Validate it's a valid number
  if (!/^\d+$/.test(cleanId)) {
    return null;
  }

  return cleanId;
}

/**
 * Validate bundle ID (alphanumeric with optional ai- prefix)
 */
export function validateBundleId(bundleId: string | null | undefined): string | null {
  if (!bundleId) return null;

  // Allow alphanumeric, hyphens, underscores (common ID patterns)
  // Allow "ai-" prefix for AI-generated bundles
  if (!/^(ai-)?[a-zA-Z0-9_-]+$/.test(bundleId)) {
    return null;
  }

  // Limit length to prevent abuse
  if (bundleId.length > 100) {
    return null;
  }

  return bundleId;
}

/**
 * Validate session ID (UUID or alphanumeric)
 */
export function validateSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;

  // Allow UUID format or alphanumeric
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    return null;
  }

  return sessionId;
}

/**
 * Sanitize text input (for titles, names, descriptions)
 * Preserves valid characters but removes malicious patterns
 */
export function sanitizeTextInput(input: string | null | undefined, maxLength = 500): string {
  if (!input || typeof input !== 'string') return '';

  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '') // Remove iframes
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick=, onerror=, etc.)
    .trim()
    .substring(0, maxLength);
}

/**
 * Validate numeric input (for quantities, prices, etc.)
 */
export function validateNumericInput(value: string | number | null | undefined, min = 0, max = 1000000): number | null {
  if (value === null || value === undefined) return null;

  const num = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  if (num < min || num > max) {
    return null;
  }

  return num;
}

/**
 * Validate email address (for support forms, etc.)
 */
export function validateEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== 'string') return null;

  // Basic email validation
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    return null;
  }

  // Limit length
  if (email.length > 254) {
    return null;
  }

  return email.toLowerCase().trim();
}

/**
 * Validate URL (for custom domains, webhooks, etc.)
 */
export function validateUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);

    // Only allow https and http
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/**
 * Get allowed domains for a shop (myshopify.com + custom domains)
 * Cached to avoid hitting Shopify API on every request
 */
const domainCache = new Map<string, { domains: string[]; timestamp: number }>();
const DOMAIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getShopDomains(
  shop: string,
  admin?: { graphql: (query: string) => Promise<Response> }
): Promise<string[]> {
  const myshopifyDomain = shop.endsWith('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  const myshopifyOrigin = `https://${myshopifyDomain}`;

  // Check cache first
  const cached = domainCache.get(shop);
  if (cached && (Date.now() - cached.timestamp) < DOMAIN_CACHE_TTL) {
    return cached.domains;
  }

  // If no admin API provided, just return myshopify domain
  if (!admin) {
    return [myshopifyOrigin];
  }

  try {
    // Fetch custom domains from Shopify
    const response = await admin.graphql(`
      #graphql
      query {
        shop {
          domains(first: 10) {
            edges {
              node {
                host
                url
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const domains: string[] = [myshopifyOrigin]; // Always include myshopify.com

    // Add custom domains
    const domainEdges = data?.data?.shop?.domains?.edges || [];
    for (const edge of domainEdges) {
      const url = edge?.node?.url;
      if (url && url !== myshopifyOrigin) {
        domains.push(url);
      }
    }

    // Cache the result
    domainCache.set(shop, { domains, timestamp: Date.now() });
    return domains;

  } catch (error) {
    console.warn('[CORS] Failed to fetch custom domains, using myshopify.com only:', error);
    return [myshopifyOrigin];
  }
}

/**
 * Validate CORS origin against shop's allowed domains
 * Returns the allowed origin if valid, null otherwise
 */
export async function validateCorsOrigin(
  origin: string | null,
  shop: string,
  admin?: { graphql: (query: string) => Promise<Response> }
): Promise<string | null> {
  if (!origin) return null;

  // Development mode: Allow localhost and preview domains
  if (process.env.NODE_ENV === 'development') {
    if (
      origin.startsWith('http://localhost') ||
      origin.startsWith('https://localhost') ||
      origin.includes('ngrok') ||
      origin.includes('cloudflare') ||
      origin.includes('shopify.dev')
    ) {
      return origin;
    }
  }

  // Get allowed domains for this shop
  const allowedDomains = await getShopDomains(shop, admin);

  // Check if origin matches any allowed domain
  // Must be exact match or subdomain match
  for (const domain of allowedDomains) {
    if (origin === domain) {
      return origin;
    }
    // Allow subdomains (e.g., www.example.com if example.com is allowed)
    if (origin.startsWith('https://') && domain.startsWith('https://')) {
      const originHost = origin.replace('https://', '');
      const domainHost = domain.replace('https://', '');
      if (originHost.endsWith(`.${domainHost}`)) {
        return origin;
      }
    }
  }

  // Origin not in allowlist
  console.warn('[CORS] Rejected origin:', { origin, shop, allowedDomains });
  return null;
}

/**
 * Generate CORS headers for a response
 */
export function getCorsHeaders(allowedOrigin: string | null): Record<string, string> {
  if (!allowedOrigin) {
    // No CORS headers if origin not allowed
    return {};
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', // 24 hours
    'Vary': 'Origin',
  };
}

/**
 * Request fingerprinting for additional security
 */
export function generateRequestFingerprint(request: { headers: { get: (name: string) => string | null } }): string {
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLanguage = request.headers.get('accept-language') || '';
  const acceptEncoding = request.headers.get('accept-encoding') || '';
  
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  
  return crypto
    .createHash('sha256')
    .update(fingerprint)
    .digest('hex')
    .substring(0, 16);
}
