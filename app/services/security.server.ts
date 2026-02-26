// Phase 3: Advanced security utilities
import crypto from "crypto";

export const SecurityHeaders = {
  // Content Security Policy
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.bigcommerce.com https://widget.replain.cc",
    "style-src 'self' 'unsafe-inline' https://*.bigcommerce.com https://fonts.googleapis.com https://widget.replain.cc",
    "img-src 'self' data: blob: https://*.bigcommerce.com https://assets.replain.cc https://storage.replain.cc",
    "font-src 'self' https://fonts.gstatic.com https://*.bigcommerce.com",
    "connect-src 'self' https://*.bigcommerce.com https://api.bigcommerce.com https://login.bigcommerce.com https://widget.replain.cc https://app.replain.cc https://ws.replain.cc wss://widget.replain.cc wss://app.replain.cc wss://ws.replain.cc",
    "media-src 'self' https://widget.replain.cc",
    "frame-src 'self' https://*.bigcommerce.com",
    "frame-ancestors https://*.bigcommerce.com https://*.mybigcommerce.com",
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
 * Validate BigCommerce store hash format
 */
export function validateStoreHash(storeHash: string): boolean {
  if (!storeHash || typeof storeHash !== 'string') return false;

  // BigCommerce store hashes are alphanumeric, typically 10 characters
  const storeHashPattern = /^[a-z0-9]{5,20}$/i;
  return storeHashPattern.test(storeHash);
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
 * Validate and sanitize product ID (BigCommerce product IDs are numeric)
 */
export function validateProductId(productId: string | null | undefined): string | null {
  if (!productId) return null;

  const cleanId = productId.trim();

  // Validate it's a valid number
  if (!/^\d+$/.test(cleanId)) {
    return null;
  }

  return cleanId;
}

/**
 * Validate and sanitize variant ID (BigCommerce variant IDs are numeric)
 */
export function validateVariantId(variantId: string | null | undefined): string | null {
  if (!variantId) return null;

  const cleanId = variantId.trim();

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
 * Get allowed domains for a BigCommerce store
 * Returns the default mybigcommerce.com domain
 */
const domainCache = new Map<string, { domains: string[]; timestamp: number }>();
const DOMAIN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getStoreDomains(
  storeHash: string
): Promise<string[]> {
  const bcDomain = `store-${storeHash}.mybigcommerce.com`;
  const bcOrigin = `https://${bcDomain}`;

  // Check cache first
  const cached = domainCache.get(storeHash);
  if (cached && (Date.now() - cached.timestamp) < DOMAIN_CACHE_TTL) {
    return cached.domains;
  }

  const domains = [bcOrigin];

  // Cache the result
  domainCache.set(storeHash, { domains, timestamp: Date.now() });
  return domains;
}

/**
 * Validate CORS origin against shop's allowed domains
 * Returns the allowed origin if valid, null otherwise
 */
export async function validateCorsOrigin(
  origin: string | null,
  storeHash: string
): Promise<string | null> {
  if (!origin) return null;

  // Development mode: Allow localhost and preview domains
  if (process.env.NODE_ENV === 'development') {
    if (
      origin.startsWith('http://localhost') ||
      origin.startsWith('https://localhost') ||
      origin.includes('ngrok') ||
      origin.includes('cloudflare')
    ) {
      return origin;
    }
  }

  // Get allowed domains for this store
  const allowedDomains = await getStoreDomains(storeHash);

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
  console.warn('[CORS] Rejected origin:', { origin, storeHash, allowedDomains });
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
