# Billing Enforcement Fix - Critical Issue Analysis

**Date:** 2025-11-19
**Issue:** Users can exceed order limit without app being disabled
**Severity:** CRITICAL - Revenue loss, Shopify compliance violation

---

## 🚨 Problem Statement

**User Report:**
```
Order limit reached - You've used 19 of your 15 monthly orders.
Upgrade via the Shopify App Store to continue using Cart Uplift.

Bundle is hidden ❌
Cart works ✅ (SHOULD BE DISABLED)
Free shipping works ✅ (SHOULD BE DISABLED)
Recommendations work ✅ (SHOULD BE DISABLED)
```

**Expected Behavior:**
- Free plan: 15 orders limit
- Grace buffer: 10% = 1.5 orders
- Hard limit: Math.floor(15 * 1.10) = **16 orders**
- At 19 orders: **3 orders over hard limit** - app should be completely disabled

---

## 🔍 Root Cause Analysis

### Current Enforcement (Partial)

**File:** `app/routes/apps.proxy.$.tsx`

**Endpoints WITH enforcement:**
1. `/api/recommendations` (line 390) ✅
   ```typescript
   const subscription = await getOrCreateSubscription(shopStr);
   if (subscription.isLimitReached) {
     return json({
       recommendations: [],
       message: 'Order limit reached...',
       limitReached: true
     });
   }
   ```

2. `/api/bundles` (line 1411) ✅
   ```typescript
   const subscription = await getOrCreateSubscription(shopStr);
   if (subscription.isLimitReached) {
     return json({
       bundles: [],
       message: 'Order limit reached...',
       limitReached: true
     });
   }
   ```

**Endpoints WITHOUT enforcement (THE BUG):**
1. `/api/settings` (line 2425) ❌ **← CRITICAL**
   - Returns cart drawer config (free shipping, title, etc.)
   - No billing check at all
   - Allows cart to render even when limit reached

2. `/api/discount` (line 2519) ❌
   - Validates discount codes
   - No billing check

3. `/api/embed-heartbeat` (line 2494) ❌
   - Theme heartbeat to mark enabled
   - No billing check (less critical)

4. `/api/track` / `/api/cart-tracking` (line 2718) ❌
   - Tracking events
   - No billing check (less critical - analytics only)

5. `/api/track-recommendations` (line 2655) ❌
   - Recommendation tracking
   - No billing check

---

## 💥 Impact

### Business Impact
- **Revenue Loss:** Users can continue using app without upgrading
- **Shopify Compliance:** Violates Shopify's billing enforcement requirements
- **Free Plan Abuse:** 19 orders on 15-order plan = 27% overage
- **Unfair to Paying Customers:** Paid plans subsidize free users

### Technical Impact
- Inconsistent enforcement across endpoints
- Cart drawer loads (settings endpoint works)
- Free shipping calculations work
- Only bundles/recommendations are blocked
- **User sees app as "partially working"** instead of "upgrade required"

---

## ✅ Solution

### Approach 1: Early Return (Recommended)

Add billing check at the TOP of each storefront endpoint, before ANY processing:

```typescript
// Check subscription limits FIRST
const subscription = await getOrCreateSubscription(shopStr);
if (subscription.isLimitReached) {
  return json({
    error: 'Order limit reached. Please upgrade your plan.',
    limitReached: true,
    orderCount: subscription.orderCount,
    orderLimit: subscription.orderLimit
  }, { status: 402 }); // 402 Payment Required
}
```

### Approach 2: Centralized Middleware (Better Long-term)

Create a helper function:

```typescript
async function enforceOrderLimit(shop: string) {
  const subscription = await getOrCreateSubscription(shop);
  if (subscription.isLimitReached) {
    throw json({
      error: 'Order limit reached. Please upgrade your plan.',
      limitReached: true
    }, { status: 402 });
  }
  return subscription;
}
```

Then use in every endpoint:
```typescript
const subscription = await enforceOrderLimit(shopStr);
```

---

## 🎯 Endpoints to Fix

### Critical (Block All Functionality)
1. **`/api/settings`** (line 2425) - **MOST CRITICAL**
   - Returns cart config
   - Blocking this disables entire cart drawer
   - **Fix:** Add check before returning settings

2. **`/api/discount`** (line 2519)
   - Discount validation
   - **Fix:** Add check before validation

### Medium Priority
3. **`/api/track`** (line 2718)
   - Tracking endpoint
   - Less critical (analytics only)
   - But should be blocked for consistency

4. **`/api/track-recommendations`** (line 2655)
   - Recommendation tracking
   - **Fix:** Add check

5. **`/api/embed-heartbeat`** (line 2494)
   - Theme heartbeat
   - **Fix:** Add check

---

## 📝 Implementation Plan

### Step 1: Fix `/api/settings` (CRITICAL)
```typescript
if (path.includes('/api/settings')) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop;
    if (!shop) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ✅ ADD THIS - Enforce order limit
    const subscription = await getOrCreateSubscription(shop as string);
    if (subscription.isLimitReached) {
      return json({
        error: 'Order limit reached. Please upgrade your plan.',
        limitReached: true,
        orderCount: subscription.orderCount,
        orderLimit: subscription.orderLimit,
        planTier: subscription.planTier
      }, {
        status: 402,
        headers: {
          "Access-Control-Allow-Origin": "*",
        }
      });
    }

    // Existing settings logic...
    const settings = await getSettings(shop as string);
    // ...
  }
}
```

### Step 2: Fix `/api/discount`
Same pattern - add check before discount validation

### Step 3: Fix tracking endpoints
Add check to analytics tracking (less critical but for consistency)

### Step 4: Update frontend
Frontend should handle 402 status and show upgrade prompt

---

## 🧪 Testing Plan

### Test Case 1: Free Plan at Limit
```
Setup: Free plan, 16 orders (at hard limit)
Expected: All endpoints return 402
Verify:
  - Cart drawer doesn't load
  - Free shipping doesn't work
  - Recommendations don't load
  - Bundles don't load
  - Discount validation doesn't work
```

### Test Case 2: Free Plan in Grace Period
```
Setup: Free plan, 15 orders (at soft limit)
Expected: Everything still works
Verify:
  - Warning shown but app functional
  - All features available
```

### Test Case 3: After Upgrade
```
Setup: Upgrade from Free to Starter
Expected: App immediately functional
Verify:
  - All endpoints work
  - No limit errors
  - Counter continues
```

### Test Case 4: 30-Day Reset
```
Setup: Free plan, 16 orders, wait 30 days
Expected: Counter resets to 0
Verify:
  - App becomes functional again
  - Order count = 0
  - New billing period started
```

---

## 🎯 Success Criteria

- [ ] All storefront endpoints check `isLimitReached`
- [ ] At hard limit, NO app functionality works
- [ ] User sees clear "upgrade required" message
- [ ] 402 status code returned (Payment Required)
- [ ] Frontend handles 402 gracefully
- [ ] After upgrade, app works immediately
- [ ] 30-day reset works correctly

---

## 📊 Current vs Fixed Behavior

| Scenario | Current Behavior | Fixed Behavior |
|----------|------------------|----------------|
| **19 orders (over limit)** | | |
| - Cart drawer | ✅ Works | ❌ Blocked |
| - Free shipping | ✅ Works | ❌ Blocked |
| - Recommendations | ❌ Blocked | ❌ Blocked |
| - Bundles | ❌ Blocked | ❌ Blocked |
| - Discount codes | ✅ Works | ❌ Blocked |
| **User sees** | "Partially broken" | "Upgrade required" |
| **Shopify compliance** | ❌ Failed | ✅ Passed |

---

## 🚀 Deployment

**Risk Level:** Low (fail-safe - users who shouldn't be using app will be blocked)

**Rollback Plan:** Revert commit if issues

**Migration:** None needed (enforcement logic already exists, just applying it)

---

**Priority:** CRITICAL
**Estimated Fix Time:** 30 minutes
**Testing Time:** 15 minutes
**Total:** 45 minutes
