# Complete Billing & Bundle Fix Plan

**Date:** 2025-11-19
**Issues:** 2 critical problems
**Branch:** `claude/complete-billing-shutdown-016WQU5Gz34BwB6C4whCGH6M`

---

## 🚨 Issue #1: Cart Still Works When Limit Reached

### Problem
User at 19 orders (over 16 hard limit) reports:
- ✅ Redirect to billing page works
- ✅ Bundles hidden on homepage (good)
- ❌ **Cart drawer still shows** (BAD)
- ❌ **Free shipping still works** (BAD)
- ❌ **Recommendations in cart still work** (BAD)

### Root Cause Found

**Backend (apps.proxy.$.tsx:2434-2451):**
```typescript
// Enforcement IS in place
const subscription = await getOrCreateSubscription(shop);
if (subscription.isLimitReached) {
  return json({
    error: 'Order limit reached...',
    limitReached: true,
    // ...
  }, { status: 402 }); // ← Returns 402 Payment Required
}
```

**Frontend (cart-uplift.js:989-1036):**
```javascript
async refreshSettingsFromAPI() {
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {  // ← PROBLEM: Only checks 200-299
      const newSettings = await response.json();
      // Apply settings
    }
    // ← 402 falls through here, does nothing
  } catch (_error) {}  // ← Silently fails
}
```

**The Issue:**
1. Frontend requests settings
2. Backend returns 402 (not ok)
3. Frontend ignores 402, silently fails
4. **Cart continues using theme-provided initial settings**
5. Cart drawer fully functional!

**Why This Is Bad:**
- Users can game the system by avoiding bundles
- They get free cart functionality after limit
- Shopify compliance failure
- Revenue loss

---

## 🚨 Issue #2: FBT Bundles Show 0 Purchases

### Problem
User reports bundles show:
- Purchases: 0
- Revenue: $0.00

Even though they've purchased bundles.

### Investigation

**Frontend Display (admin.bundles._index.tsx:53-54):**
```typescript
totalPurchases: bundle.totalPurchases,  // From database
totalRevenue: bundle.totalRevenue,      // From database
```

**Database Schema (prisma/schema.prisma):**
```prisma
model Bundle {
  totalPurchases   Int       @default(0)
  totalRevenue     Float     @default(0)
  // ...
}
```

**Need to check:** Are these being updated by the webhook?

---

## ✅ Solution Plan

### Part 1: Complete Cart Shutdown (CRITICAL)

**Fix in:** `extensions/cart-uplift/assets/cart-uplift.js`

**Current code (lines 989-1036):**
```javascript
async refreshSettingsFromAPI() {
  try {
    const response = await fetch(apiUrl);
    if (response.ok) {
      const newSettings = await response.json();
      this.settings = Object.assign(this.settings, newSettings);
      // ...
    }
  } catch (_error) {}
}
```

**New code:**
```javascript
async refreshSettingsFromAPI() {
  try {
    const response = await fetch(apiUrl);

    // CRITICAL: Check for billing limit (402)
    if (response.status === 402) {
      const errorData = await response.json();
      console.warn('🚫 CartUplift: Order limit reached', errorData);

      // COMPLETELY DISABLE THE APP
      this.disableApp(errorData);
      return;
    }

    if (response.ok) {
      const newSettings = await response.json();
      this.settings = Object.assign(this.settings, newSettings);
      // ...
    }
  } catch (_error) {
    console.error('CartUplift settings error:', _error);
  }
}

// NEW METHOD: Completely disable app
disableApp(errorData) {
  // 1. Hide cart drawer completely
  if (this.drawer) {
    this.drawer.style.display = 'none';
  }

  // 2. Remove all CartUplift UI elements
  document.querySelectorAll('[data-cartuplift]').forEach(el => {
    el.remove();
  });

  // 3. Disable all recommendations
  this.settings.enableRecommendations = false;
  this.settings.enableFreeShipping = false;
  window.CartUpliftDisabled = true;

  // 4. Show upgrade modal (optional)
  this.showUpgradeModal(errorData);

  console.warn('🚫 CartUplift completely disabled - order limit reached');
}
```

**Impact:**
- Cart drawer won't render at all
- Free shipping disabled
- Recommendations disabled
- Clean "app is disabled" state

---

### Part 2: Fix Bundle Purchase Tracking

**Need to verify webhook is updating bundles.**

**Check in:** `app/routes/webhooks.orders.create.tsx`

**Expected logic:**
```typescript
// After finding bundle
await prisma.bundle.update({
  where: { id: bundle.id },
  data: {
    totalPurchases: { increment: 1 },
    totalRevenue: { increment: totalRevenue }
  }
});
```

**If missing:** Add this logic to webhook handler.

---

## 📋 Implementation Steps

### Step 1: Fix Frontend Cart Shutdown

**File:** `extensions/cart-uplift/assets/cart-uplift.js`

1. ✅ Add 402 status check
2. ✅ Create `disableApp()` method
3. ✅ Hide cart drawer completely
4. ✅ Disable all features
5. ✅ Set global flag

### Step 2: Verify/Fix Bundle Tracking

**File:** `app/routes/webhooks.orders.create.tsx`

1. Check if `totalPurchases` increment exists
2. Check if `totalRevenue` increment exists
3. Add if missing
4. Test webhook with bundle purchase

### Step 3: Testing

**Test Case 1: Billing Limit**
```
Setup: Free plan, 22 orders (over limit)
Action: Visit storefront
Expected:
  - ❌ Cart drawer: Hidden completely
  - ❌ Free shipping: Disabled
  - ❌ Recommendations: Disabled
  - ✅ Upgrade message: Shown
Result: App appears uninstalled
```

**Test Case 2: Bundle Purchase**
```
Setup: Create bundle, place order
Action: Check FBT page
Expected:
  - Purchases: Shows > 0
  - Revenue: Shows $XX.XX
Result: Tracking works
```

### Step 4: Deploy

1. Build new cart-uplift.js
2. Update CACHE_BUST version
3. Deploy to production
4. Test on live store

---

## 🎯 Success Criteria

### Billing Enforcement
- [ ] Cart drawer completely hidden at limit
- [ ] Free shipping disabled at limit
- [ ] Recommendations disabled at limit
- [ ] Clear "upgrade required" state
- [ ] No partial functionality
- [ ] App behaves like uninstalled

### Bundle Tracking
- [ ] FBT table shows actual purchases
- [ ] Revenue displays correctly
- [ ] Updates in real-time after orders
- [ ] Webhook increments counters

---

## 🚀 Priority

**CRITICAL - REVENUE LOSS**

**Current state:**
- Users can use cart features without upgrading
- Free plan abuse
- Shopify compliance failure

**After fix:**
- Complete app shutdown at limit
- Must upgrade to continue
- Revenue protected

---

## ⚠️ Risk Assessment

**Frontend Changes:**
- **Risk:** Low (fail-safe - disables app)
- **Impact:** High (prevents abuse)
- **Rollback:** Easy (revert JS file)

**Backend Changes:**
- **Risk:** Very low (just adds increment)
- **Impact:** High (fixes tracking)
- **Rollback:** Easy (data already correct, just visibility)

---

**Next:** Investigate webhook, then implement both fixes.
