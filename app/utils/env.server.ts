/**
 * Environment Variables Validation
 *
 * Validates all required environment variables at startup to fail fast
 * rather than failing later with cryptic errors.
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
  validation?: (value: string) => boolean;
  errorMessage?: string;
  requiredIf?: (env: NodeJS.ProcessEnv) => boolean;
}

const ENV_VARS: EnvVar[] = [
  // BigCommerce Configuration (REQUIRED)
  {
    key: 'BC_CLIENT_ID',
    required: true,
    description: 'BigCommerce App Client ID',
    validation: (v) => v.length > 0,
    errorMessage: 'Must be a valid BigCommerce Client ID'
  },
  {
    key: 'BC_CLIENT_SECRET',
    required: true,
    description: 'BigCommerce App Client Secret',
    validation: (v) => v.length > 0,
    errorMessage: 'Must be a valid BigCommerce Client Secret'
  },
  {
    key: 'BC_APP_URL',
    required: true,
    description: 'Public URL where app is hosted',
    validation: (v) => v.startsWith('http://') || v.startsWith('https://'),
    errorMessage: 'Must be a valid URL starting with http:// or https://'
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

  // Stripe Billing (Optional - required for production)
  {
    key: 'STRIPE_SECRET_KEY',
    required: false,
    description: 'Stripe secret key for subscription billing'
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    required: false,
    description: 'Stripe webhook signing secret'
  },

  // BigCommerce Webhook Security (Optional)
  {
    key: 'BC_WEBHOOK_SECRET',
    required: false,
    description: 'Shared secret for BigCommerce webhook verification'
  },

  // Unified Billing (BigCommerce)
  {
    key: 'BILLING_PROVIDER',
    required: false,
    description: 'Billing provider (bigcommerce or stripe)',
    validation: (v) => v === 'bigcommerce' || v === 'stripe',
    errorMessage: 'Must be either "bigcommerce" or "stripe"'
  },
  {
    key: 'BC_PARTNER_ACCOUNT_UUID',
    required: false,
    description: 'Partner account UUID for GraphQL Account API',
    requiredIf: (env) => (env.BILLING_PROVIDER || 'bigcommerce') === 'bigcommerce' && env.NODE_ENV === 'production'
  },
  {
    key: 'BC_ACCOUNT_API_TOKEN',
    required: false,
    description: 'Account-level API token for GraphQL Account API',
    requiredIf: (env) => (env.BILLING_PROVIDER || 'bigcommerce') === 'bigcommerce' && env.NODE_ENV === 'production'
  },
  {
    key: 'BC_APPLICATION_ID',
    required: false,
    description: 'BigCommerce application ID (used to build product ID)',
    requiredIf: (env) => (env.BILLING_PROVIDER || 'bigcommerce') === 'bigcommerce' && env.NODE_ENV === 'production'
  },
  {
    key: 'BC_BILLING_RETURN_URL',
    required: false,
    description: 'Optional override for billing return URL'
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
    const isRequired = envVar.required || (envVar.requiredIf ? envVar.requiredIf(process.env) : false);

    if (isRequired && !value) {
      missing.push(envVar.key);
      errors.push(
        `Missing required environment variable: ${envVar.key}\n   Description: ${envVar.description}`
      );
      continue;
    }

    if (!isRequired && !value) {
      warnings.push(
        `Optional environment variable not set: ${envVar.key}\n   Description: ${envVar.description}`
      );
      continue;
    }

    if (value && envVar.validation) {
      if (!envVar.validation(value)) {
        errors.push(
          `Invalid value for ${envVar.key}: ${envVar.errorMessage || 'Validation failed'}\n   Current value: ${value.substring(0, 20)}...`
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

  if (result.warnings.length > 0) {
    console.warn('\nEnvironment Variable Warnings:');
    result.warnings.forEach(w => console.warn(w));
    console.warn('');
  }

  if (!result.valid) {
    console.error('\nEnvironment Variable Validation Failed:');
    console.error('='.repeat(60));
    result.errors.forEach(e => console.error(e));
    console.error('='.repeat(60));
    console.error('\nHow to fix:');
    console.error('   1. Set required variables in your .env file');
    console.error('   2. For production, set these in Vercel environment variables');
    console.error('');

    throw new Error(
      `Missing required environment variables: ${result.missing.join(', ')}`
    );
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('Environment variables validated successfully');
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
  // BigCommerce
  get bcClientId() { return getRequiredEnv('BC_CLIENT_ID'); },
  get bcClientSecret() { return getRequiredEnv('BC_CLIENT_SECRET'); },
  get bcAppUrl() { return getRequiredEnv('BC_APP_URL'); },

  // Database
  get databaseUrl() { return getRequiredEnv('DATABASE_URL'); },

  // Security
  get sessionSecret() { return getRequiredEnv('SESSION_SECRET'); },
  get cronSecret() { return getOptionalEnv('CRON_SECRET'); },
  get adminSecret() { return getOptionalEnv('ADMIN_SECRET'); },
  get migrationSecret() { return getOptionalEnv('MIGRATION_SECRET'); },

  // Stripe
  get stripeSecretKey() { return getOptionalEnv('STRIPE_SECRET_KEY'); },
  get stripeWebhookSecret() { return getOptionalEnv('STRIPE_WEBHOOK_SECRET'); },

  // BigCommerce Webhook
  get bcWebhookSecret() { return getOptionalEnv('BC_WEBHOOK_SECRET'); },

  // Billing
  get billingProvider() { return getOptionalEnv('BILLING_PROVIDER', 'bigcommerce'); },
  get bcPartnerAccountUuid() { return getRequiredEnv('BC_PARTNER_ACCOUNT_UUID'); },
  get bcAccountApiToken() { return getRequiredEnv('BC_ACCOUNT_API_TOKEN'); },
  get bcApplicationId() { return getRequiredEnv('BC_APPLICATION_ID'); },
  get bcBillingReturnUrl() { return getOptionalEnv('BC_BILLING_RETURN_URL'); },

  // Services
  get resendApiKey() { return getOptionalEnv('RESEND_API_KEY'); },

  // Configuration
  get nodeEnv() { return getOptionalEnv('NODE_ENV', 'development'); },
  get debugMode() { return getOptionalEnv('DEBUG_MODE', 'false') === 'true'; },
  get logFormat() { return getOptionalEnv('LOG_FORMAT', 'text'); },

  // Derived values
  get isProduction() { return this.nodeEnv === 'production'; },
  get isDevelopment() { return this.nodeEnv === 'development'; },
  get isTest() { return this.nodeEnv === 'test'; }
};
