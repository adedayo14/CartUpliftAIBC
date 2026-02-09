# Deployment Notes

## 2025-10-31 (Latest)
- **Major Fix**: Order counting now only tracks orders using app features
- Changed from counting ALL shop orders to only orders with:
  - AI Recommendations (clicked + purchased)
  - Bundle purchases
- This ensures merchants only pay for orders where Cart Uplift added value
- Functions updated:
  - `processOrderForAttribution()` now returns boolean
  - `processBundlePurchases()` now returns boolean
  - Order count only incremented if either returned true

## 2025-10-31 (Earlier)
- Reverted to commit 4548c2e (fix: add navigation to admin layout)
- Reason: Later commits caused "Unexpected Server Error"
- This is the last known working state
