# Cart Uplift BigCommerce - TODO

## Testing
- [ ] Test Load callback (opening app from BC admin iframe)
- [ ] Test settings save after deploy
- [ ] Test dashboard loads with real data
- [ ] Test webhook delivery with real BigCommerce payloads
- [ ] Test storefront script injection (cart-uplift.js, cart-bundles.js)
- [ ] Test storefront proxy endpoints
- [ ] Test recommendations showing in cart drawer
- [ ] Test shipping bar showing when enabled

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
