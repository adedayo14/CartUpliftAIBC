# GDPR Webhook Testing Guide

## Overview

This guide explains how to test the GDPR compliance webhooks (`customers/data_request` and `customers/redact`) before submitting your app to Shopify.

## Privacy Levels & Data Storage

Your app has **3 privacy levels** that determine what customer data is stored:

| Privacy Level | Customer ID Stored? | Data Stored |
|--------------|-------------------|-------------|
| **Basic** | ❌ No | Only sessionId/anonymousId |
| **Balanced** | ❌ No | Only sessionId (no customer linking) |
| **Advanced** | ✅ Yes | Full customerId + behavioral data |

**Important**: Only apps with **Advanced** privacy level will have customer data to export/delete.

---

## What Data We Store (Advanced Privacy Only)

When privacy level = **Advanced**, we store customerId in:

1. **MLUserProfile** - Behavioral profiles (viewed/carted/purchased products)
2. **AnalyticsEvent** - Cart and purchase events
3. **TrackingEvent** - Product impressions and clicks
4. **CustomerBundle** - Bundle interaction history
5. **RecommendationAttribution** - Purchase attribution data

---

## Testing Prerequisites

1. Development store with your app installed
2. Shopify CLI installed (`npm install -g @shopify/cli @shopify/theme`)
3. App must be running locally or deployed

---

## Step 1: Set Privacy Level to Advanced

Before testing, ensure your dev store has **Advanced** privacy level enabled:

1. Open your app in the dev store
2. Go to Settings
3. Set **ML Privacy Level** to **Advanced**
4. Save settings

---

## Step 2: Generate Test Customer Data

To test the webhooks, you need a customer with data in your database:

### Option A: Use a Real Customer

1. Log in as a customer in your dev store
2. Browse products (generates impressions)
3. Add products to cart (generates cart events)
4. Complete a purchase (generates purchase data)
5. Note the customer ID from Shopify Admin

### Option B: Manually Insert Test Data

```sql
-- Insert test customer profile (replace with your shop and customer ID)
INSERT INTO "MLUserProfile" (id, shop, "customerId", "sessionId", "privacyLevel", "lastActivity", "createdAt", "updatedAt")
VALUES ('test123', 'your-store.myshopify.com', 'gid://shopify/Customer/123456', 'session_abc', 'advanced', NOW(), NOW(), NOW());

-- Insert test tracking event
INSERT INTO "TrackingEvent" (id, shop, event, "productId", "customerId", "sessionId", source, "createdAt")
VALUES ('track123', 'your-store.myshopify.com', 'impression', '12345', 'gid://shopify/Customer/123456', 'session_abc', 'cart_drawer', NOW());
```

---

## Step 3: Test `customers/data_request` Webhook

This webhook **exports** all customer data when requested.

### Using Shopify CLI

```bash
# Trigger the webhook
shopify app webhook trigger \
  --topic customers/data_request \
  --delivery-method http \
  --address https://your-app.com/webhooks/customers/data_request
```

### Using cURL

```bash
# Replace with your actual values
curl -X POST https://your-app.com/webhooks/customers/data_request \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: customers/data_request" \
  -H "X-Shopify-Hmac-Sha256: YOUR_HMAC" \
  -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
  -d '{
    "customer": {
      "id": 123456,
      "email": "test@example.com"
    }
  }'
```

### Expected Response (Advanced Privacy)

```json
{
  "customer_id": "123456",
  "customer_email": "test@example.com",
  "shop": "your-store.myshopify.com",
  "privacy_level": "advanced",
  "data_export_date": "2025-01-15T12:00:00.000Z",
  "data_collected": {
    "ml_profiles": [...],
    "analytics_events": [...],
    "tracking_events": [...],
    "bundle_interactions": [...],
    "recommendation_attributions": [...]
  },
  "summary": {
    "total_ml_profiles": 5,
    "total_analytics_events": 120,
    "total_tracking_events": 450,
    "total_bundle_interactions": 12,
    "total_attributions": 3
  }
}
```

### Expected Response (Basic/Balanced Privacy)

```json
{
  "customer_id": "123456",
  "shop": "your-store.myshopify.com",
  "privacy_level": "basic",
  "message": "No customer-identifying data stored (privacy level: basic)",
  "data_collected": {}
}
```

---

## Step 4: Test `customers/redact` Webhook

This webhook **deletes** all customer data (right to be forgotten).

### Using Shopify CLI

```bash
# Trigger the webhook
shopify app webhook trigger \
  --topic customers/redact \
  --delivery-method http \
  --address https://your-app.com/webhooks/customers/redact
```

### Using cURL

```bash
curl -X POST https://your-app.com/webhooks/customers/redact \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: customers/redact" \
  -H "X-Shopify-Hmac-Sha256: YOUR_HMAC" \
  -H "X-Shopify-Shop-Domain: your-store.myshopify.com" \
  -d '{
    "customer": {
      "id": 123456,
      "email": "test@example.com"
    }
  }'
```

### Verify Deletion

After triggering `customers/redact`, verify the data was deleted:

```sql
-- Check if customer data still exists (should return 0 rows)
SELECT COUNT(*) FROM "MLUserProfile" WHERE "customerId" = 'gid://shopify/Customer/123456';
SELECT COUNT(*) FROM "AnalyticsEvent" WHERE "customerId" = 'gid://shopify/Customer/123456';
SELECT COUNT(*) FROM "TrackingEvent" WHERE "customerId" = 'gid://shopify/Customer/123456';
SELECT COUNT(*) FROM "CustomerBundle" WHERE "customerId" = 'gid://shopify/Customer/123456';
SELECT COUNT(*) FROM "RecommendationAttribution" WHERE "customerId" = 'gid://shopify/Customer/123456';
```

All queries should return **0 rows** after the webhook runs.

---

## Step 5: Monitor Logs

Check your application logs for webhook execution:

```bash
# Watch logs in real-time
tail -f /var/log/your-app.log

# Or check Sentry/logging service
```

**Expected log entries:**

### For customers/data_request:
```
✅ Customer data request webhook received (shop: your-store.myshopify.com, customerId: 123456)
✅ Customer data request - collecting advanced privacy data
✅ Customer data request completed (duration: 234ms, totalRecords: 590)
```

### For customers/redact:
```
✅ Customer redact webhook received (shop: your-store.myshopify.com, customerId: 123456)
✅ Customer redact - deleting advanced privacy data
✅ Customer redact completed successfully (duration: 156ms, totalDeleted: 590)
```

---

## Common Issues & Troubleshooting

### Issue: "No data returned" for Advanced Privacy

**Cause**: Customer data doesn't exist in database
**Solution**: Generate test data using Step 2

### Issue: Webhook returns 401/403 error

**Cause**: HMAC validation failing
**Solution**: Use Shopify CLI instead of manual cURL (it handles HMAC automatically)

### Issue: Data still exists after customers/redact

**Cause**: Privacy level is not "advanced" OR database query failing
**Solution**:
1. Check logs for errors
2. Verify privacy level is "advanced" in Settings
3. Check customerId format (should be `gid://shopify/Customer/123456`)

### Issue: Webhook timeout

**Cause**: Too much data to process (>30 seconds)
**Solution**: We use `take: 1000` limits for large tables, so this shouldn't happen. If it does, reduce the limits.

---

## Shopify App Review Checklist

Before submitting your app, ensure:

- [x] ✅ **customers/data_request** webhook returns JSON with customer data (when privacy = advanced)
- [x] ✅ **customers/data_request** webhook returns empty data (when privacy = basic/balanced)
- [x] ✅ **customers/redact** webhook deletes all customer data (when privacy = advanced)
- [x] ✅ **customers/redact** webhook responds with 200 within 5 seconds
- [x] ✅ **shop/redact** webhook deletes all shop data (already implemented correctly)
- [x] ✅ Webhooks are registered in `shopify.app.toml` (already done)
- [x] ✅ Privacy levels are documented and clearly explained to merchants

---

## Privacy Level Warning for Merchants

**Add this to your app's Settings UI** to warn merchants about Advanced privacy:

```
⚠️ **Privacy Level: Advanced**

Enabling Advanced privacy allows us to store customer IDs for personalized
recommendations. This provides better ML-powered suggestions but requires
compliance with GDPR data export and deletion requests.

If a customer requests their data or deletion:
- We will export/delete all tracked behavior (views, carts, purchases)
- This is handled automatically via GDPR webhooks
- Data is deleted within 48 hours of request

For privacy-conscious merchants, use "Basic" or "Balanced" modes instead.
```

---

## Final Test Before Submission

1. Install app in fresh development store
2. Set privacy to **Advanced**
3. Generate customer data (browse, add to cart, purchase)
4. Trigger both GDPR webhooks using Shopify CLI
5. Verify data is exported correctly
6. Verify data is deleted completely
7. Check logs for any errors

If all tests pass, you're ready to submit! ✅

---

## Need Help?

If you encounter issues during testing:

1. Check application logs for error details
2. Verify webhook URLs are publicly accessible
3. Test with Shopify CLI (it handles authentication automatically)
4. Check database to confirm data existence before testing

Good luck with your submission! 🚀
