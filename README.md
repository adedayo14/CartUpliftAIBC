# Cart Uplift AI - BigCommerce App

AI-powered product recommendations, smart bundles, and AOV optimization for BigCommerce stores.

> Deployed on Vercel: cart-uplift-aibc.vercel.app

## Tech Stack

- **Framework**: [Remix](https://remix.run) (Vite)
- **Database**: PostgreSQL via [Prisma](https://prisma.io) (hosted on Neon)
- **Hosting**: Vercel (serverless)
- **UI**: Polaris React components (standalone)
- **Auth**: BigCommerce OAuth2 (cookie-based sessions)
- **API**: BigCommerce REST API (V2/V3)

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL database (Neon recommended)
- BigCommerce Partner account + dev store

### Setup

```bash
npm install
cp .env.example .env   # Fill in your values
npx prisma generate
npx prisma db push
npm run dev
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `BC_CLIENT_ID` | App Client ID from BigCommerce Developer Portal |
| `BC_CLIENT_SECRET` | App Client Secret |
| `BC_APP_URL` | Public URL where app is hosted (e.g. `https://cartuplift.vercel.app`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret for encrypting sessions (min 32 chars) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key for transactional emails | _(disabled)_ |
| `CRON_SECRET` | Secret for authenticating cron job endpoints | _(none)_ |
| `ADMIN_SECRET` | Secret for admin-only API endpoints | _(none)_ |
| `BILLING_TEST_MODE` | Enable test billing mode | `false` |
| `NODE_ENV` | Environment mode | `development` |
| `DEBUG_MODE` | Enable debug logging | `false` |

### Unified Billing (BigCommerce Native)

| Variable | Description |
|----------|-------------|
| `BILLING_PROVIDER` | Billing provider (`bigcommerce` or `stripe`) |
| `BC_PARTNER_ACCOUNT_UUID` | Partner account UUID (GraphQL Account API) |
| `BC_ACCOUNT_API_TOKEN` | Account-level API token for GraphQL Account API |
| `BC_APPLICATION_ID` | App application ID (used to build product ID) |
| `BC_BILLING_RETURN_URL` | Optional override for billing return URL |

## Architecture

```
app/
  bigcommerce.server.ts     # OAuth, auth helpers (authenticateAdmin, authenticateWebhook)
  services/
    bigcommerce-api.server.ts  # BC REST API client (getProducts, getOrders, etc.)
    billing.server.ts          # Subscription/order limit management
    security.server.ts         # CORS, input validation, rate limiting
  routes/
    auth.install.tsx           # OAuth install flow
    auth.load.tsx              # BigCommerce load callback
    admin.*.tsx                # Merchant admin pages (dashboard, bundles, settings, billing)
    apps.proxy.$.tsx           # Storefront-facing API proxy (recommendations, bundles, tracking)
    webhooks.*.tsx             # Webhook handlers (orders, uninstall, GDPR)
    api.*.tsx                  # Public API endpoints (tracking, analytics)
  jobs/
    similarity-computation.server.ts  # Weekly product similarity analysis
    user-profile-update.server.ts     # Daily user behavior profiling
    data-cleanup.server.ts            # Data retention cleanup
  models/
    settings.server.ts         # Store settings CRUD
    bundles.server.ts          # Bundle CRUD
```

## Key Patterns

- **Auth**: `authenticateAdmin(request)` for admin routes, `authenticateWebhook(request)` for webhooks
- **DB**: All Prisma queries use `storeHash` field (not `shop`)
- **Storefront**: `authenticateStorefront(request)` extracts `store_hash` from query params
- **API Client**: `bigcommerceApi(storeHash, path, options)` for raw BC API calls

## Build & Deploy

```bash
# Build
npm run build          # prisma generate + remix vite:build

# Production build
npm run build:prod     # NODE_ENV=production

# Database
npx prisma db push     # Apply schema changes
npx prisma studio      # Browse data
```

## Scaling Notes

- Use Neon connection pooling for 500+ stores: append `?pgbouncer=true&connection_limit=5` to `DATABASE_URL`
- Neon Free (100 conn): ~500 stores with pooling
- Neon Launch (200 conn, $19/mo): 1000+ stores

## Billing Tiers

| Plan | Orders/mo | Price |
|------|-----------|-------|
| Free | 15 | $0 |
| Starter | 500 | $29/mo |
| Growth | 2,500 | $79/mo |
| Pro | Unlimited | $199/mo |

Grace buffer: 10% over limit before hard cutoff.
