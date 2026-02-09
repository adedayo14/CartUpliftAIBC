# Environment Variables Documentation

Complete guide to configuring CartUplift environment variables.

## Quick Start

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Fill in required variables** (see below)

3. **Verify configuration:**
   ```bash
   npm run dev
   ```
   The app will validate all variables on startup and show helpful error messages if anything is missing or invalid.

---

## Required Variables

These variables **must** be set or the app will not start.

### Shopify Configuration

| Variable | Description | Example | Where to Get It |
|----------|-------------|---------|-----------------|
| `SHOPIFY_API_KEY` | Your Shopify App Client ID | `ba2c932cf6717c8fb6207fcc8111fe70` | Partner Dashboard > Apps > [Your App] > Client credentials |
| `SHOPIFY_API_SECRET` | Your Shopify App Client Secret | `shpss_xxxxx...` | Partner Dashboard > Apps > [Your App] > Client credentials |
| `SHOPIFY_APP_URL` | Public URL where app is hosted | `https://cartuplift.vercel.app` | Your deployment URL (Vercel, etc.) |
| `SCOPES` | Shopify API permissions (comma-separated) | `read_orders,read_products,read_themes` | Pre-configured, don't change unless needed |

### Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host.neon.tech/db?sslmode=require` |

**Where to get it:**
- **Neon (recommended)**: Create a project at [neon.tech](https://neon.tech), copy connection string
- **Local development**: `postgresql://postgres:password@localhost:5432/cartuplift`

### Security

| Variable | Description | How to Generate |
|----------|-------------|-----------------|
| `SESSION_SECRET` | Secret key for encrypting user sessions (min 32 chars) | `openssl rand -base64 32` |

---

## Optional Variables

These enhance functionality but aren't required for the app to run.

### Optional Services

| Variable | Description | Required For | Where to Get It |
|----------|-------------|--------------|-----------------|
| `RESEND_API_KEY` | API key for sending emails | Support contact form | [resend.com](https://resend.com) |
| `CRON_SECRET` | Secret for authenticating cron jobs | Production security | `openssl rand -base64 32` |
| `ADMIN_SECRET` | Secret for admin-only API endpoints | Production security | `openssl rand -base64 32` |
| `MIGRATION_SECRET` | Secret for database migration endpoints | Production security | `openssl rand -base64 32` |

### Optional Configuration

| Variable | Description | Default | Valid Values |
|----------|-------------|---------|--------------|
| `NODE_ENV` | Environment mode | `development` | `development`, `production`, `test` |
| `DEBUG_MODE` | Enable detailed debug logging | `false` | `true`, `false` |
| `LOG_FORMAT` | Log output format | `text` | `json`, `text` |
| `SHOP_CUSTOM_DOMAIN` | Custom shop domain | _(none)_ | `example.com` |

---

## Platform-Specific Setup

### Vercel

1. Go to your project settings
2. Navigate to **Settings > Environment Variables**
3. Add each variable with its value
4. Set environment: **Production**, **Preview**, and **Development** as needed

**Important:** After adding variables, trigger a new deployment for them to take effect.

### Local Development

1. Create `.env` file in project root:
   ```bash
   cp .env.example .env
   ```

2. Fill in values (see `.env.example` for template)

3. **Never commit `.env`** (it's already in `.gitignore`)

---

## Validation

The app validates all environment variables at startup:

```typescript
import { validateEnvOrThrow } from "~/utils/env.server";

// This runs automatically and throws helpful errors if misconfigured
validateEnvOrThrow();
```

### What Gets Validated

✅ **Required variables** are present
✅ **URLs** start with `http://` or `https://`
✅ **Scopes** include minimum required permissions
✅ **Database URL** is valid PostgreSQL format
✅ **SESSION_SECRET** is at least 32 characters
✅ **Enums** use valid values (NODE_ENV, LOG_FORMAT, etc.)

### Example Error Messages

```
🔴 Environment Variable Validation Failed:
============================================================
❌ Missing required environment variable: SHOPIFY_API_KEY
   Description: Shopify App Client ID

❌ Invalid value for SESSION_SECRET: Must be at least 32 characters long for security
   Current value: short_secret...
============================================================

💡 How to fix:
   1. Copy .env.example to .env (if it exists)
   2. Fill in all required variables in .env
   3. For production, set these in your hosting platform (Vercel, etc.)
```

---

## Type-Safe Access

Use the `env` helper for type-safe, validated access:

```typescript
import { env } from "~/utils/env.server";

// Required variables (throws if missing)
const apiKey = env.shopifyApiKey;
const dbUrl = env.databaseUrl;

// Optional variables (returns empty string if not set)
const resendKey = env.resendApiKey;

// Derived values
if (env.isProduction) {
  // Production-only logic
}

if (env.debugMode) {
  // Debug logging
}
```

---

## Security Best Practices

### ✅ DO

- Use strong, random secrets (32+ characters)
- Store secrets in environment variables, never in code
- Use different secrets for development and production
- Rotate secrets periodically (especially after team member changes)
- Set appropriate secrets for production (`CRON_SECRET`, `ADMIN_SECRET`, etc.)

### ❌ DON'T

- Commit `.env` to version control
- Share secrets in Slack, email, or other unencrypted channels
- Use simple/guessable secrets like "password123"
- Re-use the same secret across multiple services
- Hard-code secrets in source files

---

## Troubleshooting

### "Missing required environment variable: X"

**Fix:** Add the variable to `.env` (local) or your hosting platform (production)

### "Invalid value for SHOPIFY_APP_URL"

**Fix:** Ensure URL starts with `http://` or `https://`

### "Must include at least read_orders,read_products"

**Fix:** Your `SCOPES` variable is missing required permissions. Should be:
```
SCOPES=read_orders,read_products,read_themes
```

### Environment variables not updating in Vercel

**Fix:** After changing variables in Vercel dashboard, trigger a new deployment:
```bash
git commit --allow-empty -m "Trigger deployment"
git push
```

---

## Migration from Old Setup

If upgrading from a version without environment validation:

1. Copy `.env.example` to `.env`
2. Fill in your existing values
3. Add any new required variables
4. Test with `npm run dev`
5. Update production environment (Vercel/etc.)
6. Deploy

---

## Support

If you encounter issues with environment configuration:

1. Check this documentation
2. Review the error messages (they're designed to be helpful!)
3. Verify `.env.example` has all variables you need
4. Contact support with the validation error output
