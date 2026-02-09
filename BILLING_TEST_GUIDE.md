# Billing Flow Test Guide

## Prerequisites
- Development store installed with Cart Uplift
- Access to Shopify admin

## Test Scenario 1: Free Plan Auto-Creation

**Steps:**
1. Install app on a fresh development store
2. Go to https://cartuplift.com/admin/billing
3. **Expected:** Should see "Free" plan as current
4. **Expected:** Shows "0/50 orders" usage

**Verification:**
- Check database: `SELECT * FROM subscriptions WHERE shop = 'your-store.myshopify.com';`
- Should see: `planTier = "free"`, `planStatus = "active"`

---

## Test Scenario 2: Upgrade Flow (Starter Plan)

**Steps:**
1. From billing page, click **"Upgrade Now"** on Starter plan ($29/mo)
2. **Expected:** Redirects to Shopify charge approval page
3. URL should look like: `https://your-store.myshopify.com/admin/charges/...`
4. Click **"Approve charge"** in Shopify
5. **Expected:** Redirects back to `https://cartuplift.com/admin/billing/confirm?charge_id=...`
6. **Expected:** Shows success banner: "Your subscription has been activated!"
7. **Expected:** Plan badge now shows "Starter" with "0/500"

**Verification:**
- Check database: `planTier = "starter"`, `chargeId` populated
- Check Shopify: Admin → Settings → Apps and sales channels → Cart Uplift → Charges
- Should see active $29/month charge

---

## Test Scenario 3: Order Counting

**Steps:**
1. While on Starter plan, create test orders in your dev store
2. Use Shopify's "Create order" button (Admin → Orders → Create order)
3. After each order, check billing page
4. **Expected:** Order count increments: "5/500", "6/500", etc.

**Verification:**
- Database: `SELECT monthlyOrderCount FROM subscriptions WHERE shop = 'your-store.myshopify.com';`
- Should increment with each order

---

## Test Scenario 4: Limit Warning (90%)

**Steps:**
1. Manually update database to simulate approaching limit:
   ```sql
   UPDATE subscriptions 
   SET monthlyOrderCount = 45 
   WHERE shop = 'your-store.myshopify.com' AND planTier = 'free';
   ```
2. Create one more order in Shopify
3. **Expected:** Console logs show: `📊 Order count updated: 46 (warning: true)`
4. **Expected:** Email sent to merchant (if RESEND_API_KEY configured)

**Email Check:**
- Go to Resend dashboard → Emails
- Should see email with subject: "You're approaching your order limit..."

---

## Test Scenario 5: Grace Period (100-110%)

**Steps:**
1. Update database to 100% of limit:
   ```sql
   UPDATE subscriptions 
   SET monthlyOrderCount = 50 
   WHERE shop = 'your-store.myshopify.com' AND planTier = 'free';
   ```
2. Create orders 51, 52, 53, 54, 55 (grace period)
3. **Expected:** App continues working (grace period active)
4. At order 56 (110%), app should show upgrade prompt

**Verification:**
- Billing page should show warning banner
- App still functions until 110%

---

## Test Scenario 6: Downgrade/Cancel

**Steps:**
1. From Shopify admin → Settings → Apps → Cart Uplift
2. Click "Uninstall"
3. **Expected:** Webhook fires, app uninstalled

**Verification:**
- Database record remains for 90 days (for reinstall)
- Shopify charge automatically cancelled

---

## Test Scenario 7: Trial Period (Paid Plans)

**Important:** Development stores get **14-day trial** for paid plans

**Steps:**
1. Fresh install, upgrade to Starter ($29)
2. Database should show: `trialEndsAt = now() + 14 days`
3. **Expected:** No charge until trial ends
4. After 14 days, Shopify charges automatically

**Manual Test:**
- Update `trialEndsAt` to yesterday in database
- Shopify will charge on next billing cycle check

---

## Common Issues & Fixes

### Issue 1: "Charge not found" error
**Cause:** charge_id missing in URL
**Fix:** Check that billing.server.ts properly sets returnUrl

### Issue 2: Orders not incrementing
**Cause:** Webhook not firing
**Fix:** 
- Check Shopify admin → Settings → Notifications → Webhooks
- Verify ORDERS_CREATE webhook exists
- Check webhook delivery status

### Issue 3: Email not sending
**Cause:** RESEND_API_KEY not set
**Fix:** Add to Vercel environment variables, redeploy

### Issue 4: Database errors
**Cause:** Prisma client out of sync
**Fix:** Run `npx prisma generate && npx prisma db push`

---

## Manual Database Commands (for Testing)

### Reset order count:
```sql
UPDATE subscriptions 
SET monthlyOrderCount = 0, lastOrderCountReset = NOW()
WHERE shop = 'your-store.myshopify.com';
```

### Simulate different plans:
```sql
-- Free plan with high usage
UPDATE subscriptions 
SET planTier = 'free', monthlyOrderCount = 45 
WHERE shop = 'your-store.myshopify.com';

-- Starter plan
UPDATE subscriptions 
SET planTier = 'starter', monthlyOrderCount = 250 
WHERE shop = 'your-store.myshopify.com';
```

### Check subscription status:
```sql
SELECT 
  shop,
  planTier,
  planStatus,
  monthlyOrderCount,
  billingPeriodStart,
  trialEndsAt,
  chargeId
FROM subscriptions 
WHERE shop = 'your-store.myshopify.com';
```

---

## Expected Console Logs

### Successful upgrade:
```
✅ Subscription charge created for shop: your-store.myshopify.com
🔗 Redirecting to: https://your-store.myshopify.com/admin/charges/...
✅ Subscription confirmed: charge_id_123
📧 Subscription confirmation email sent to merchant@store.com
```

### Order counting:
```
🎯 Order webhook START: 2025-10-30T...
✅ Webhook authenticated: { topic: 'ORDERS_CREATE', shop: '...', orderId: 123 }
📊 Order count updated: 46 (limit reached: false, warning: true)
📧 Order limit warning email sent to merchant@store.com
✅ Order webhook complete in 245ms
```

---

## Checklist Before Shopify Submission

- [ ] Tested free plan auto-creation
- [ ] Tested upgrade to paid plan
- [ ] Verified charge appears in Shopify admin
- [ ] Tested order counting increments
- [ ] Verified 90% warning triggers
- [ ] Tested grace period (100-110%)
- [ ] Confirmed emails send (if Resend configured)
- [ ] Tested on mobile device
- [ ] Verified in multiple browsers
- [ ] No console errors in browser
- [ ] No errors in Vercel logs

---

## Quick Test Script

Run this in development store to simulate full flow:

1. **Install app** → Check free plan created
2. **Upgrade to Starter** → Approve charge
3. **Create 5 orders** → Verify count increments
4. **Set count to 45** (SQL) → Create order → Check warning
5. **Uninstall app** → Verify clean removal

**Total test time: ~10 minutes**

---

## Production Testing (After Launch)

1. Install on real store (not dev store)
2. Upgrade to Starter plan with real card
3. Verify actual billing occurs after trial
4. Monitor Vercel logs for webhook errors
5. Check Resend for email delivery rates

---

## Support Contact for Issues

If billing fails during testing:
- Check Vercel logs: https://vercel.com/your-project/logs
- Check Shopify webhook delivery: Admin → Settings → Notifications
- Database access via Neon dashboard
- Contact: support@cartuplift.com (that's you!)
