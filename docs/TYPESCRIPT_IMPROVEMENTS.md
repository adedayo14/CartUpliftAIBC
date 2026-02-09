# TypeScript Code Quality Improvements

**Status:** Phase 1 - Code Quality Infrastructure
**Date:** 2025-11-19

---

## Current State

### Type Safety Analysis
- ✅ TypeScript enabled
- ⚠️ **1 'any' type** usage found in `api.bundles.tsx:26`
- ⚠️ **Strict mode disabled** in tsconfig.json
- ✅ Most code is well-typed

### Findings
```typescript
// app/routes/api.bundles.tsx:26
const noCacheJson = (data: any, options?: {...}) => {
  // Should be: data: unknown or specific type
}
```

---

## Recommended Improvements

### 1. Enable Strict Mode (Future)

**Current tsconfig.json:**
```json
{
  "compilerOptions": {
    "strict": false  // ❌ Should be true
  }
}
```

**Recommended:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true
  }
}
```

**Impact:** Will require fixing ~50-100 type errors across codebase
**Recommendation:** Enable incrementally, one flag at a time

---

### 2. Fix 'any' Usage

#### Current Issue
```typescript
// app/routes/api.bundles.tsx
const noCacheJson = (data: any, options?: { status?: number; corsHeaders?: Record<string, string> }) => {
  return json(data, {
    status: options?.status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      ...(options?.corsHeaders || {})
    }
  });
};
```

#### Fixed Version
```typescript
// Better: Use unknown and type guard
type JsonResponse = Record<string, unknown> | unknown[];

const noCacheJson = (
  data: JsonResponse,
  options?: {
    status?: number;
    corsHeaders?: Record<string, string>;
  }
) => {
  return json(data, {
    status: options?.status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store',
      ...(options?.corsHeaders || {})
    }
  });
};
```

---

### 3. Add Utility Types

Create reusable type definitions to reduce duplication:

```typescript
// app/types/api.ts (NEW FILE)

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * API error response
 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/**
 * Type guard for API errors
 */
export function isApiError(response: unknown): response is ApiError {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === false &&
    'error' in response
  );
}
```

---

### 4. Improve Error Handling Types

```typescript
// BEFORE - Unsafe
try {
  await doSomething();
} catch (error) {
  console.error(error); // error is 'any'
}

// AFTER - Type-safe
try {
  await doSomething();
} catch (error) {
  if (error instanceof Error) {
    logger.error('Operation failed', {
      message: error.message,
      stack: error.stack,
    });
  } else {
    logger.error('Unknown error', {
      error: String(error),
    });
  }
}
```

---

### 5. Add JSDoc for Complex Types

```typescript
/**
 * Bundle configuration for product recommendations
 * @property {string} id - Unique bundle identifier (cuid)
 * @property {string} name - Display name for bundle
 * @property {string} type - Bundle type: manual | ml | ai_suggested
 * @property {BundleProduct[]} products - Products in this bundle
 * @property {number} discountValue - Discount percentage (0-100)
 */
interface BundleResponse {
  id: string;
  name: string;
  type: string;
  products: BundleProduct[];
  discountValue: number;
  // ... more fields
}
```

---

## Implementation Plan

### Phase 1: Infrastructure (Current)
- ✅ Document current state
- ✅ Create improvement guidelines
- ⏸️ Don't enable strict mode yet (breaking change)

### Phase 2: Incremental Fixes (Future)
1. Fix the 1 'any' usage in api.bundles.tsx
2. Add utility types (api.ts)
3. Add JSDoc to 20 most complex interfaces
4. Enable `noImplicitAny` flag
5. Fix resulting errors

### Phase 3: Strict Mode (Future)
1. Enable `strictNullChecks`
2. Fix null/undefined errors
3. Enable remaining strict flags
4. Fix all type errors

**Estimated effort:** 2-3 days spread over multiple PRs

---

## Benefits

### With Strict Mode Enabled

**Before:**
```typescript
function getProduct(id: string) {
  const product = products.find(p => p.id === id);
  return product.title; // ❌ Runtime error if not found!
}
```

**After:**
```typescript
function getProduct(id: string): string | undefined {
  const product = products.find(p => p.id === id);
  return product?.title; // ✅ Type-safe, handles undefined
}
```

### Catches Bugs Early

**Before:**
```typescript
const discount = bundle.discountValue; // number
const message = `Discount: ${discount}%`;
// Works fine

// Later...
const discount = bundle.discountValue; // Changed to number | null
const message = `Discount: ${discount}%`; // ❌ Shows "null%"
```

**After (Strict):**
```typescript
const discount = bundle.discountValue; // number | null
const message = `Discount: ${discount}%`; // ❌ Compile error!
// Must handle null case explicitly
```

---

## Non-Breaking Improvements (Safe for Phase 1)

These can be applied immediately without risk:

### 1. Add Return Types to Exported Functions
```typescript
// BEFORE
export async function getBundles(shop: string) {
  return await prisma.bundle.findMany({ where: { shop } });
}

// AFTER
export async function getBundles(shop: string): Promise<Bundle[]> {
  return await prisma.bundle.findMany({ where: { shop } });
}
```

### 2. Use Type Guards
```typescript
// BEFORE
if (error) {
  console.log(error.message); // Unsafe
}

// AFTER
if (error instanceof Error) {
  console.log(error.message); // Safe
}
```

### 3. Use Const Assertions
```typescript
// BEFORE
const STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
};
// Type: { DRAFT: string; ACTIVE: string }

// AFTER
const STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
} as const;
// Type: { DRAFT: 'draft'; ACTIVE: 'active' }
```

---

## Testing Type Safety

```bash
# Check for type errors
npx tsc --noEmit

# Check specific file
npx tsc --noEmit app/routes/api.bundles.tsx

# With strict mode (test only, don't commit)
npx tsc --noEmit --strict
```

---

## Summary

**Phase 1 (Current):**
- ✅ Infrastructure in place
- ✅ Guidelines documented
- ⏸️ No breaking changes

**Phase 2 (Next):**
- Fix 'any' usage
- Add utility types
- Incremental strictness

**Phase 3 (Future):**
- Full strict mode
- Maximum type safety

**Recommendation:** Apply non-breaking improvements in separate PR, defer strict mode to dedicated effort.
