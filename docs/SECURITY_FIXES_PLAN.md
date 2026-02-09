# Security Fixes Implementation Plan
**Date:** 2025-11-19
**Based on:** SECURITY_AUDIT_REPORT.md
**Status:** In Progress

---

## ✅ Completed (Commit 1)

### 1. Removed Hardcoded API Key ⚠️ CRITICAL
**File:** `app/routes/app.tsx`
**Change:**
- ❌ Before: `apiKey: process.env.SHOPIFY_API_KEY || "ba2c932cf6717c8fb6207fcc8111fe70"`
- ✅ After: Proper env var check with error if missing
- **Status:** ✅ FIXED

### 2. Added Rate Limiting to Contact Support
**File:** `app/routes/api.contact-support.tsx`
**Change:**
- Added IP-based rate limiting (10 req/min)
- Prevents spam/abuse of support endpoint
- **Status:** ✅ FIXED

### 3. Security Audit Documentation
**File:** `docs/SECURITY_AUDIT_REPORT.md`
**Content:**
- Comprehensive security review
- 10 findings documented
- Action items prioritized
- **Status:** ✅ COMPLETE

---

## 🚧 Remaining Work (Commit 2-3)

### High Priority Routes Needing Rate Limiting

Based on the audit, these routes need rate limiting urgently:

#### Commit 2: Write Operations (Most Critical)

1. **api.settings.tsx** - Settings updates
   - Limit: 50 req/min (write operation)
   - Risk: Data corruption from rapid updates

2. **api.discount.tsx** - Discount code operations
   - Limit: 50 req/min
   - Risk: Bulk discount generation abuse

3. **admin.api.bundle-management.tsx** - Bundle CRUD
   - Limit: 50 req/min
   - Risk: Database overload from bulk operations

#### Commit 3: Read-Heavy & ML Routes

4. **api.products.tsx** - Product listing
   - Limit: 100-200 req/min
   - Risk: Expensive Shopify API calls

5. **api.collections.tsx** - Collection listing
   - Limit: 100-200 req/min
   - Risk: Expensive Shopify API calls

6. **api.upsells.tsx** - Upsell recommendations
   - Limit: 100 req/min
   - Risk: High traffic endpoint

7. **api.cart-tracking.tsx** - Cart events
   - Limit: 200 req/min (high frequency)
   - Risk: Analytics database overload

8. **api.analytics-dashboard.tsx** - Dashboard data
   - Limit: 50 req/min (expensive queries)
   - Risk: Database performance

9. **api.ml.bundle-data.tsx** - ML bundle data
   - Limit: 50 req/min (ML operations)
   - Risk: Compute-intensive

10. **api.ml.popular-recommendations.tsx** - ML recommendations
    - Limit: 50 req/min
    - Risk: Compute-intensive

11. **api.ml.collaborative-data.tsx** - Collaborative filtering
    - Limit: 50 req/min
    - Risk: Compute-intensive

12. **api.ml.content-recommendations.tsx** - Content-based recs
    - Limit: 50 req/min
    - Risk: Compute-intensive

---

### CORS Protection Needed

All public API routes should have CORS validation. Currently only 2 routes protected.

**Template to apply:**
```typescript
import { validateCorsOrigin, getCorsHeaders } from "../services/security.server";

// In loader/action:
const origin = request.headers.get('origin');
const allowedOrigin = await validateCorsOrigin(origin, shop, admin);
const corsHeaders = getCorsHeaders(allowedOrigin);

// In response:
return json(data, { headers: { ...corsHeaders } });
```

**Routes needing CORS (in order of priority):**

1. **Public-facing routes** (browser-accessible):
   - api.bundles.tsx ✅ (already has)
   - api.track.tsx ✅ (already has)
   - api.upsells.tsx ❌
   - api.products.tsx ❌
   - api.collections.tsx ❌
   - api.cart-tracking.tsx ❌
   - api.discount.tsx ❌

2. **Admin routes** (embedded app - lower priority):
   - api.settings.tsx ❌
   - api.analytics-dashboard.tsx ❌
   - admin.api.bundle-management.tsx ❌

**Note:** Admin routes in embedded app context have less CORS risk (Shopify handles security), but adding it doesn't hurt.

---

### Error Boundaries Needed

**Critical user flows without proper error boundaries:**

1. **admin.bundles.new.tsx** - Bundle creation form
   - Risk: Stack trace on validation error
   - Fix: Wrap form in ErrorBoundary

2. **admin.bundles.$id.tsx** - Bundle edit form
   - Risk: Stack trace on save error
   - Fix: Wrap form in ErrorBoundary

3. **admin.settings.tsx** - Settings page
   - Risk: Stack trace on invalid config
   - Fix: Wrap settings form in ErrorBoundary

**Implementation Pattern:**
```typescript
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <Page title="Error">
        <Banner tone="critical">
          <p>Error: {error.data?.message || 'Something went wrong'}</p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Error">
      <Banner tone="critical">
        <p>An unexpected error occurred. Please try again.</p>
      </Banner>
    </Page>
  );
}
```

---

## 📋 Implementation Checklist

### Commit 2: High-Priority Rate Limiting (Est: 1-2 hours)

- [ ] Add rate limiting to api.settings.tsx (50 rpm)
- [ ] Add rate limiting to api.discount.tsx (50 rpm)
- [ ] Add rate limiting to admin.api.bundle-management.tsx (50 rpm)
- [ ] Test: Try rapid requests, verify 429 responses
- [ ] Commit: "feat(security): add rate limiting to write operations"

### Commit 3: Read-Heavy Routes Rate Limiting (Est: 1-2 hours)

- [ ] Add rate limiting to api.products.tsx (100-200 rpm)
- [ ] Add rate limiting to api.collections.tsx (100-200 rpm)
- [ ] Add rate limiting to api.upsells.tsx (100 rpm)
- [ ] Add rate limiting to api.cart-tracking.tsx (200 rpm)
- [ ] Add rate limiting to api.analytics-dashboard.tsx (50 rpm)
- [ ] Add rate limiting to all api.ml.* routes (50 rpm each)
- [ ] Test: Verify limits work correctly
- [ ] Commit: "feat(security): add rate limiting to read-heavy and ML routes"

### Commit 4: CORS Protection (Est: 1-2 hours)

- [ ] Add CORS to api.upsells.tsx
- [ ] Add CORS to api.products.tsx
- [ ] Add CORS to api.collections.tsx
- [ ] Add CORS to api.cart-tracking.tsx
- [ ] Add CORS to api.discount.tsx
- [ ] Add CORS to api.settings.tsx
- [ ] Add CORS to admin routes (lower priority)
- [ ] Test: Verify CORS headers in responses
- [ ] Commit: "feat(security): add CORS protection to all public API routes"

### Commit 5: Error Boundaries (Est: 1 hour)

- [ ] Add ErrorBoundary to admin.bundles.new.tsx
- [ ] Add ErrorBoundary to admin.bundles.$id.tsx
- [ ] Add ErrorBoundary to admin.settings.tsx
- [ ] Test: Trigger errors, verify user-friendly messages
- [ ] Commit: "feat(security): add error boundaries to critical user flows"

### Commit 6: Testing & Verification (Est: 1 hour)

- [ ] Test all rate limits (burst and sustained)
- [ ] Test CORS from different origins
- [ ] Test error boundaries with various errors
- [ ] Run security smoke tests
- [ ] Update SECURITY_AUDIT_REPORT.md with fixes
- [ ] Commit: "docs(security): update audit report with implemented fixes"

---

## 🎯 Estimated Timeline

**Total Effort:** 6-8 hours (1 day of focused work)

**Day 1 Morning (3-4 hours):**
- ✅ Security audit (DONE)
- ✅ Critical fixes (DONE)
- ⏳ Commits 2-3: Rate limiting

**Day 1 Afternoon (3-4 hours):**
- ⏳ Commit 4: CORS protection
- ⏳ Commit 5: Error boundaries
- ⏳ Commit 6: Testing & docs

**Result:** All high-priority security fixes complete by end of Day 1

---

## 🧪 Testing Strategy

### Rate Limiting Tests

```bash
# Test burst limit (should fail on 41st request within 10s)
for i in {1..50}; do curl http://localhost:3000/api/bundles?product_id=123 & done

# Test sustained limit (should fail after limit within 60s)
ab -n 200 -c 1 http://localhost:3000/api/bundles?product_id=123
```

### CORS Tests

```bash
# Test valid origin (should include CORS headers)
curl -H "Origin: https://shop.myshopify.com" http://localhost:3000/api/bundles?product_id=123 -v

# Test invalid origin (should NOT include CORS headers)
curl -H "Origin: https://evil.com" http://localhost:3000/api/bundles?product_id=123 -v
```

### Error Boundary Tests

1. Navigate to bundle creation form
2. Enter invalid data (e.g., negative discount)
3. Verify: User-friendly error message (NOT stack trace)
4. Verify: Can recover from error (form still usable)

---

## 📝 Post-Fix Verification

After all commits, verify:

- [ ] No hardcoded secrets or API keys
- [ ] All public API routes have rate limiting
- [ ] All public API routes have CORS protection
- [ ] All user-facing forms have error boundaries
- [ ] No raw stack traces visible to users
- [ ] Rate limit headers present in responses
- [ ] CORS headers present in valid requests
- [ ] App still functions correctly (no breaking changes)

---

## 🚀 Ready for Launch When

- ✅ All critical fixes applied
- ✅ All high-priority fixes applied
- ✅ Testing complete
- ✅ Documentation updated
- ✅ No security warnings in audit report

**Then proceed to Day 5-7: Pre-launch prep** (App Store listing, privacy policy, final QA)

---

**Status:** Commit 1 complete ✅
**Next:** Continue with Commits 2-6 (rate limiting + CORS + error boundaries)
