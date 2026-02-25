# Cart Uplift BigCommerce - TODO

## Infrastructure (DONE)
- [x] Create Vercel project (cart-uplift-aibc.vercel.app)
- [x] Create Neon database (cart-uplift-bc-db)
- [x] Push database schema (`prisma db push`)
- [x] Set env vars: `BC_CLIENT_ID`, `BC_CLIENT_SECRET`, `BC_APP_URL`, `SESSION_SECRET`, `NODE_ENV`
- [x] Set `BC_PARTNER_ACCOUNT_UUID`
- [x] Configure Dev Portal callback URLs (install/load/uninstall/remove-user)
- [x] Set OAuth scopes (Orders RO, Products RO, Info RO, Content Modify, Storefront Tokens)
- [x] Register app scope/subscription update webhooks
- [x] BigDesign migration (all 6 routes)
- [x] GitHub → Vercel auto-deploy connected

## Runtime Fixes (DONE)
- [x] Fix Resend crash when `RESEND_API_KEY` not set (conditional init)
- [x] Fix Neon DB connection drops (remove eager `$connect()`, use lazy connections)
- [x] Fix Prisma `directUrl` to use `DATABASE_URL_UNPOOLED`
- [x] Fix iframe embedding (CSP `frame-ancestors` + clear `X-Frame-Options` in vercel.json)
- [x] Fix admin index redirect (`/admin` → `/admin/dashboard`)
- [x] Hide `<s-app-nav>` custom elements when outside BC iframe
- [x] Fix settings save (`shop` → `storeHash` in payload)
- [x] Improve error logging (serialize Error objects properly)

## OAuth Flow (DONE)
- [x] Test OAuth install flow on a dev store
- [x] Token exchange + session save to Neon DB
- [x] Cookie session set + redirect to `/admin`

## Testing (Next)
- [ ] Test Load callback (opening app from BC admin iframe)
- [ ] Test settings save after deploy
- [ ] Test dashboard loads with real data
- [ ] Test webhook delivery with real BigCommerce payloads
- [ ] Test storefront script injection (cart-uplift.js, cart-bundles.js)
- [ ] Test storefront proxy endpoints

## Billing Setup (Needs Account API Token)
- [ ] Set `BC_ACCOUNT_API_TOKEN` (from BigCommerce Partner Portal)
- [ ] Set `BC_APPLICATION_ID` (from Dev Tools)
- [ ] Test Unified Billing subscription flow

## Post-Launch
- [ ] Fix superadmin dashboard store links (use `store-{hash}.mybigcommerce.com` URL format)
- [ ] Update onboarding copy to BigCommerce equivalents
- [ ] Add BigCommerce multi-storefront support
- [ ] Add `categoryScore` to similarity computation (use `getCategories()` from BC API)
- [ ] Add `priceScore` to similarity computation (use product price data from BC API)
- [ ] Add co-view tracking from frontend events for `coViewScore`
