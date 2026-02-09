/**
 * Environment Variables Validation
 *
 * Validates all required environment variables at startup to fail fast
 * rather than failing later with cryptic errors.
 *
 * Usage:
 *   import { validateEnv } from "~/utils/env.server";
 *   validateEnv(); // Call at app startup
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
  validation?: (value: string) => boolean;
  errorMessage?: string;
}

const ENV_VARS: EnvVar[] = [
  // Shopify Configuration (REQUIRED)
  {
    key: 'SHOPIFY_API_KEY',
    required: true,
    description: 'Shopify App Client ID',
    validation: (v) => v.length > 0,
    errorMessage: 'Must be a valid Shopify API key'
  },
  {
    key: 'SHOPIFY_API_SECRET',
    required: true,
    description: 'Shopify App Client Secret',
    validation: (v) => v.length > 0,
    errorMessage: 'Must be a valid Shopify API secret'
  },
  {
    key: 'SHOPIFY_APP_URL',
    required: true,
    description: 'Public URL where app is hosted',
    validation: (v) => v.startsWith('http://') || v.startsWith('https://'),
    errorMessage: 'Must be a valid URL starting with http:// or https://'
  },
  {
    key: 'SCOPES',
    required: true,
    description: 'Shopify API scopes (comma-separated)',
    validation: (v) => v.includes('read_orders') && v.includes('read_products'),
    errorMessage: 'Must include at least read_orders,read_products'
  },

  // Database Configuration (REQUIRED)
  {
    key: 'DATABASE_URL',
    required: true,
    description: 'PostgreSQL database connection string',
    validation: (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    errorMessage: 'Must be a valid PostgreSQL connection string'
  },

  // Session/Security (REQUIRED)
  {
    key: 'SESSION_SECRET',
    required: true,
    description: 'Secret key for session encryption',
    validation: (v) => v.length >= 32,
    errorMessage: 'Must be at least 32 characters long for security'
  },

  // Optional Services
  {
    key: 'RESEND_API_KEY',
    required: false,
    description: 'Resend API key for email notifications (optional)'
  },
  {
    key: 'CRON_SECRET',
    required: false,
    description: 'Secret for authenticating cron job requests (recommended for production)'
  },
  {
    key: 'ADMIN_SECRET',
    required: false,
    description: 'Secret for admin-only API endpoints (recommended for production)'
  },
  {
    key: 'MIGRATION_SECRET',
    required: false,
    description: 'Secret for database migration endpoints (recommended for production)'
  },

  // Optional Configuration
  {
    key: 'NODE_ENV',
    required: false,
    description: 'Environment mode (development, production, test)',
    validation: (v) => ['development', 'production', 'test'].includes(v),
    errorMessage: 'Must be one of: development, production, test'
  },
  {
    key: 'DEBUG_MODE',
    required: false,
    description: 'Enable debug logging (true/false)',
    validation: (v) => v === 'true' || v === 'false',
    errorMessage: 'Must be either "true" or "false"'
  },
  {
    key: 'LOG_FORMAT',
    required: false,
    description: 'Log output format (json/text)',
    validation: (v) => v === 'json' || v === 'text',
    errorMessage: 'Must be either "json" or "text"'
  },
  {
    key: 'SHOP_CUSTOM_DOMAIN',
    required: false,
    description: 'Custom shop domain if not using .myshopify.com'
  }
];

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missing: string[];
}

/**
 * Validate all environment variables
 */
export function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.key];

    // Check if required variable is missing
    if (envVar.required && !value) {
      missing.push(envVar.key);
      errors.push(
        `❌ Missing required environment variable: ${envVar.key}\n   Description: ${envVar.description}`
      );
      continue;
    }

    // Warn about optional variables
    if (!envVar.required && !value) {
      warnings.push(
        `⚠️  Optional environment variable not set: ${envVar.key}\n   Description: ${envVar.description}`
      );
      continue;
    }

    // Validate value if validation function provided
    if (value && envVar.validation) {
      if (!envVar.validation(value)) {
        errors.push(
          `❌ Invalid value for ${envVar.key}: ${envVar.errorMessage || 'Validation failed'}\n   Current value: ${value.substring(0, 20)}...`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missing
  };
}

/**
 * Validate environment and throw if invalid (for startup validation)
 */
export function validateEnvOrThrow(): void {
  const result = validateEnv();

  // Always log warnings
  if (result.warnings.length > 0) {
    console.warn('\n🟡 Environment Variable Warnings:');
    result.warnings.forEach(w => console.warn(w));
    console.warn('');
  }

  // Throw if there are errors
  if (!result.valid) {
    console.error('\n🔴 Environment Variable Validation Failed:');
    console.error('='.repeat(60));
    result.errors.forEach(e => console.error(e));
    console.error('='.repeat(60));
    console.error('\n💡 How to fix:');
    console.error('   1. Copy .env.example to .env (if it exists)');
    console.error('   2. Fill in all required variables in .env');
    console.error('   3. For production, set these in your hosting platform (Vercel, etc.)');
    console.error('');

    throw new Error(
      `Missing required environment variables: ${result.missing.join(', ')}`
    );
  }

  // Success message in development
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Environment variables validated successfully');
  }
}

/**
 * Get a required environment variable (throws if missing)
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `This should have been caught by validateEnvOrThrow(). ` +
      `Make sure to call validateEnvOrThrow() at app startup.`
    );
  }
  return value;
}

/**
 * Get an optional environment variable with fallback
 */
export function getOptionalEnv(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

/**
 * Type-safe environment variable getters
 */
export const env = {
  // Shopify
  get shopifyApiKey() { return getRequiredEnv('SHOPIFY_API_KEY'); },
  get shopifyApiSecret() { return getRequiredEnv('SHOPIFY_API_SECRET'); },
  get shopifyAppUrl() { return getRequiredEnv('SHOPIFY_APP_URL'); },
  get scopes() { return getRequiredEnv('SCOPES'); },

  // Database
  get databaseUrl() { return getRequiredEnv('DATABASE_URL'); },

  // Security
  get sessionSecret() { return getRequiredEnv('SESSION_SECRET'); },
  get cronSecret() { return getOptionalEnv('CRON_SECRET'); },
  get adminSecret() { return getOptionalEnv('ADMIN_SECRET'); },
  get migrationSecret() { return getOptionalEnv('MIGRATION_SECRET'); },

  // Services
  get resendApiKey() { return getOptionalEnv('RESEND_API_KEY'); },

  // Configuration
  get nodeEnv() { return getOptionalEnv('NODE_ENV', 'development'); },
  get debugMode() { return getOptionalEnv('DEBUG_MODE', 'false') === 'true'; },
  get logFormat() { return getOptionalEnv('LOG_FORMAT', 'text'); },
  get shopCustomDomain() { return getOptionalEnv('SHOP_CUSTOM_DOMAIN'); },

  // Derived values
  get isProduction() { return this.nodeEnv === 'production'; },
  get isDevelopment() { return this.nodeEnv === 'development'; },
  get isTest() { return this.nodeEnv === 'test'; }
};
