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

## Billing Setup (Code Done - Needs Env Vars)
- [ ] Set `BC_PARTNER_ACCOUNT_UUID` in Vercel (from Partner Portal)
- [ ] Set `BC_ACCOUNT_API_TOKEN` in Vercel (from Partner Portal)
- [ ] Set `BC_APPLICATION_ID` in Vercel (from Dev Tools)
- [ ] Test Unified Billing subscription flow end-to-end

## ML Upgrade (Code Done - Needs Deploy + Data)
- [x] Fix eventType → event bug in api.ml.collaborative-data.tsx
- [x] Logistic regression weight learning (weight-learning.server.ts)
- [x] Temporal decay (60-day half-life) in similarity computation
- [x] Popularity debiasing via lift normalization
- [x] User embeddings (featureVector) in profile updates
- [x] Cosine similarity personalization re-ranking at serving time
- [x] Learned weights applied in content-recommendations + similarity computation
- [x] New cron: /api/cron/learn-weights at 2:15 AM daily
- [ ] Run `npx prisma db push` on production to create ml_learned_weights table
- [ ] Verify weight learning cron runs successfully
- [ ] Verify user embeddings populate after profile update cron
- [ ] Monitor recommendation CTR/CVR improvement after deploy
