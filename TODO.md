# Cart Uplift BigCommerce - TODO

## Launch (Blocked on Credentials)
- [ ] Set env vars: `BC_CLIENT_ID`, `BC_CLIENT_SECRET`, `BC_APP_URL`, `DATABASE_URL`, `SESSION_SECRET`
- [ ] Set billing env vars: `BC_PARTNER_ACCOUNT_UUID`, `BC_ACCOUNT_API_TOKEN`, `BC_APPLICATION_ID`
- [ ] Configure Dev Portal callback URLs (install/load/uninstall/remove-user)
- [ ] Run `npx prisma db push` on production database
- [ ] Enable Neon connection pooling (`?pgbouncer=true`) for production
- [ ] Test OAuth flow end-to-end
- [ ] Test webhook delivery with real BigCommerce payloads
- [ ] Test storefront proxy endpoints

## Pre-Launch (No Credentials Needed)
- [ ] Register app scope/subscription update webhooks (confirm scope names)

## Post-Launch
- [ ] Fix superadmin dashboard store links (use `store-{hash}.mybigcommerce.com` URL format)
- [ ] Update onboarding copy to BigCommerce equivalents
- [ ] Add BigCommerce multi-storefront support
- [ ] Add `categoryScore` to similarity computation (use `getCategories()` from BC API)
- [ ] Add `priceScore` to similarity computation (use product price data from BC API)
- [ ] Add co-view tracking from frontend events for `coViewScore`
