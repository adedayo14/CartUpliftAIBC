# Logging Migration Guide

**Purpose:** Standardize logging across the CartUplift codebase with structured, production-ready logging.

---

## Why Migrate?

**Current Issues:**
- 413+ console.log statements scattered across 65 files
- No log levels (everything is console.log)
- No request context tracking
- Logs pollute production console
- Hard to filter/search logs

**Benefits of New Logger:**
- ✅ Log levels: DEBUG, INFO, WARN, ERROR
- ✅ Environment-aware filtering (DEBUG_MODE)
- ✅ Request ID tracking
- ✅ Structured JSON format for production
- ✅ Performance measurement
- ✅ Backward compatible

---

## Migration Pattern

### Before (Old Style)
```typescript
console.log('Processing order:', orderId);
console.warn('Rate limit approaching');
console.error('Order processing failed:', error);
```

### After (New Style)
```typescript
import { logger, createRequestLogger } from '~/utils/logger.server';

// Simple logging
logger.debug('Processing order', { orderId });
logger.warn('Rate limit approaching', { shop, usage: 0.8 });
logger.error('Order processing failed', { orderId, error: error.message });

// With request context (automatic request ID)
const reqLogger = createRequestLogger(request, { shop });
reqLogger.info('Order processed', { orderId, revenue: 99.99 });
```

### Performance Logging
```typescript
import { createPerfLogger } from '~/utils/logger.server';

const perf = createPerfLogger('Bundle computation', { shop });
// ... do work ...
perf.end({ bundleCount: 5 }); // Logs duration automatically
```

---

## Log Level Guidelines

| Level | When to Use | Examples | Production? |
|-------|-------------|----------|-------------|
| `debug` | Verbose debugging, internals | "Fetching product IDs", "Cache hit" | ❌ No |
| `info` | General flow, success cases | "Order processed", "Bundle created" | ❌ No |
| `warn` | Recoverable issues, degradation | "Rate limit 80%", "Fallback used" | ✅ Yes |
| `error` | Errors, exceptions | "API failed", "Database error" | ✅ Yes |

**Rule of thumb:**
- **DEBUG**: You'd only need it when debugging a specific issue
- **INFO**: You'd want it in dev logs but not production
- **WARN**: Something unusual happened but app still works
- **ERROR**: Something broke, needs investigation

---

## Migration Priority

### High Priority (Migrate First)
1. **Webhooks** - Critical path, need error tracking
   - `webhooks.orders.create.tsx`
   - `webhooks.app.uninstalled.tsx`

2. **API Routes** - High traffic
   - `api.bundles.tsx`
   - `api.track.tsx`
   - `api.recommendations.tsx`

3. **Jobs** - Background tasks
   - `jobs/similarity-computation.server.ts`
   - `jobs/daily-learning.server.ts`

### Medium Priority
4. **Admin Routes** - Lower traffic, but important
5. **Services** - Shared logic
6. **Utilities** - Helper functions

### Low Priority (Can Skip)
- Comments with console.log
- Development-only debug statements
- One-off diagnostic logs

---

## Step-by-Step Migration

### 1. Import the Logger
```typescript
// At top of file
import { logger, createRequestLogger } from '~/utils/logger.server';
```

### 2. Identify Console Statements
Search for: `console\.(log|warn|error|info)`

### 3. Replace by Type

#### Simple Logs (No Request Context)
```typescript
// BEFORE
console.log('Starting computation');

// AFTER
logger.debug('Starting computation');
```

#### Logs with Data
```typescript
// BEFORE
console.log('Found bundles:', bundles.length, 'for shop:', shop);

// AFTER
logger.debug('Found bundles', { count: bundles.length, shop });
```

#### Route Handlers (Has Request)
```typescript
// BEFORE
export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log('Loading bundles');
  // ...
};

// AFTER
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const reqLogger = createRequestLogger(request);
  reqLogger.info('Loading bundles');
  // ...
};
```

#### Performance Critical Paths
```typescript
// BEFORE
const start = Date.now();
// ... work ...
console.log('Computation took:', Date.now() - start, 'ms');

// AFTER
const perf = createPerfLogger('Computation');
// ... work ...
perf.end();
```

### 4. Clean Up Unnecessary Logs
Many console.log statements can be removed entirely:
- Logs that just echo input parameters (use debugger instead)
- Logs in tight loops (too verbose)
- "Function entered" / "Function exited" logs (use perf logger)

---

## Special Cases

### Error Logging
```typescript
// BEFORE
try {
  await processOrder(orderId);
} catch (error) {
  console.error('Failed to process order:', error);
}

// AFTER
try {
  await processOrder(orderId);
} catch (error) {
  logger.error('Failed to process order', {
    orderId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}
```

### Conditional Logging
```typescript
// BEFORE
if (DEBUG) {
  console.log('Debug info:', data);
}

// AFTER
logger.debug('Debug info', { data }); // Automatically filtered
```

### Large Objects
```typescript
// BEFORE
console.log('Full product:', JSON.stringify(product));

// AFTER - Only log what you need
logger.debug('Product details', {
  id: product.id,
  title: product.title,
  price: product.price,
  // Don't log entire variants array
});
```

---

## Testing Your Changes

### 1. Build Test
```bash
npm run build
```
Should succeed with no errors.

### 2. Type Check
```bash
npx tsc --noEmit
```
Should have no type errors.

### 3. Runtime Test
```bash
# Development mode - should see debug/info logs
DEBUG_MODE=true npm run dev

# Production mode - should only see warn/error logs
npm run dev
```

### 4. Verify No Functional Changes
- No changes to business logic
- Only console.* calls replaced
- Same functionality, better logging

---

## Examples from Codebase

### Example 1: Webhook Handler
```typescript
// File: webhooks.orders.create.tsx
// BEFORE
console.log("🎯 Order webhook START:", new Date().toISOString());
console.log("✅ Webhook authenticated:", { topic, shop, orderId });

// AFTER
const reqLogger = createRequestLogger(request, { shop, topic });
reqLogger.info("Order webhook started", { orderId: payload.id });
reqLogger.debug("Webhook authenticated", {
  orderNumber: payload.order_number,
  lineItemCount: payload.line_items?.length,
});
```

### Example 2: API Route
```typescript
// File: api.bundles.tsx
// BEFORE
console.log('[Bundles API] Request:', { productId, context });
console.warn('[Bundles API] Invalid product_id:', rawProductId);

// AFTER
const reqLogger = createRequestLogger(request, { productId });
reqLogger.debug('Bundles API request', { context });
reqLogger.warn('Invalid product_id', { raw: rawProductId });
```

### Example 3: Background Job
```typescript
// File: jobs/similarity-computation.server.ts
// BEFORE
console.log(`📊 Found ${pairMap.size} product pairs from ${orderMap.size} orders`);

// AFTER
logger.info('Similarity computation complete', {
  shop,
  pairCount: pairMap.size,
  orderCount: orderMap.size,
});
```

---

## Backward Compatibility

The old `logger.log()` method is preserved for backward compatibility:

```typescript
logger.log('Old style'); // Still works, maps to logger.debug()
```

**However**, new code should use the explicit methods:
- `logger.debug()` - Verbose debugging
- `logger.info()` - Informational
- `logger.warn()` - Warnings
- `logger.error()` - Errors

---

## Environment Variables

### Development
```bash
# .env.development
DEBUG_MODE=true
LOG_FORMAT=text
```

### Production
```bash
# .env.production
DEBUG_MODE=false
LOG_FORMAT=json
```

---

## FAQ

**Q: Should I remove all console.log statements?**
A: No. Keep critical error logging (console.error), but replace debug/info logs with logger.

**Q: What about console.log in client-side code?**
A: Use `app/utils/logger.client.ts` which has similar features.

**Q: Will this affect performance?**
A: No. Disabled log levels have minimal overhead (just a condition check).

**Q: Can I still use console.log for quick debugging?**
A: Yes, but remove before committing. Use `logger.debug()` instead.

**Q: How do I view logs in production?**
A: Set `LOG_FORMAT=json` and pipe to your log aggregator (Datadog, CloudWatch, etc.)

---

## Checklist for Each File

- [ ] Import new logger
- [ ] Replace console.log → logger.debug
- [ ] Replace console.info → logger.info
- [ ] Replace console.warn → logger.warn
- [ ] Replace console.error → logger.error
- [ ] Add request context where available
- [ ] Add structured metadata (not string concatenation)
- [ ] Remove unnecessary logs
- [ ] Test build succeeds
- [ ] Test app runs correctly

---

## Help & Questions

If you're unsure about a migration:
1. Check examples in this guide
2. Look at already-migrated files
3. Ask in code review
4. When in doubt, use `logger.debug()` and let reviewer advise

**Remember:** The goal is better observability, not perfect logging. Start simple, iterate over time.
