/**
 * Enhanced API client with parallel fetching and intelligent caching
 */
export class ApiClient {
  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
    this.cache = new Map();
    this.pendingRequests = new Map();
  }

  /**
   * Fetch multiple product handles in parallel with concurrency control
   */
  async enrichProducts(handles, options = {}) {
    const { maxConcurrent = this.maxConcurrent, timeout = 800 } = options;
    const results = [];
    const queue = [...handles];
    const inFlight = new Set();

    while (queue.length > 0 || inFlight.size > 0) {
      // Start new requests up to concurrency limit
      while (inFlight.size < maxConcurrent && queue.length > 0) {
        const handle = queue.shift();
        const request = this.fetchProductWithCache(handle, timeout);
        inFlight.add(request);
        
        request.finally(() => {
          inFlight.delete(request);
        });
      }

      // Wait for at least one to complete
      if (inFlight.size > 0) {
        const completed = await Promise.race(Array.from(inFlight));
        if (completed) {
          results.push(completed);
        }
      }
    }

    return results.filter(Boolean);
  }

  /**
   * Fetch single product with caching and deduplication
   */
  async fetchProductWithCache(handle, timeout = 800) {
    // Check cache first
    const cacheKey = `product_${handle}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 min cache
      return cached.data;
    }

    // Dedupe concurrent requests
    if (this.pendingRequests.has(handle)) {
      return this.pendingRequests.get(handle);
    }

    const request = this.doFetchProduct(handle, timeout);
    this.pendingRequests.set(handle, request);

    try {
      const result = await request;
      if (result) {
        this.cache.set(cacheKey, {
          data: result,
          timestamp: Date.now()
        });
      }
      return result;
    } finally {
      this.pendingRequests.delete(handle);
    }
  }

  async doFetchProduct(handle, timeout) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`/products/${handle}.js`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return {
          handle,
          data,
          success: true
        };
      }
    } catch (error) {
      console.warn(`Failed to fetch product ${handle}:`, error.message);
    }
    
    return {
      handle,
      data: null,
      success: false
    };
  }

  /**
   * Batch fetch with retry and fallback
   */
  async batchFetch(urls, options = {}) {
    const { timeout = 1000, retries = 1 } = options;
    const results = [];

    for (let attempt = 0; attempt <= retries; attempt++) {
      const pending = urls.filter((_, i) => !results[i]);
      
      if (pending.length === 0) break;

      const promises = pending.map(async (url, originalIndex) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            return { index: originalIndex, data, success: true };
          }
        } catch (error) {
          // Silent fail for batch operations
        }
        return { index: originalIndex, data: null, success: false };
      });

      const batchResults = await Promise.allSettled(promises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          results[result.value.index] = result.value.data;
        }
      });
    }

    return results;
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}
