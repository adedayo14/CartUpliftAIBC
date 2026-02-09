/**
 * Enhanced recommendation engine with improved algorithms and caching
 */
import { ApiClient } from '../utils/api-client.js';
import { TieredCache } from '../utils/cache.js';

export class EnhancedRecommendationEngine {
  constructor(cartUplift) {
    this.cartUplift = cartUplift;
    this.apiClient = new ApiClient(3); // Max 3 concurrent requests
    this.cache = new TieredCache();
    this.purchasePatterns = null;
    this.complementRules = new Map();
    this.manualRules = new Map();
    this.initializeEngine();
  }

  async initializeEngine() {
    // Load cached patterns first for instant recommendations
    const cachedPatterns = await this.cache.get('purchase_patterns', { allowStale: true });
    if (cachedPatterns) {
      this.purchasePatterns = cachedPatterns;
    }

    // Initialize complement detection rules
    this.initializeComplementDetection();
    
    // Load manual rules from settings
    this.loadManualRules();

    // Refresh patterns in background
    this.refreshPurchasePatterns().catch(error => 
      console.warn('Background pattern refresh failed:', error)
    );
  }

  /**
   * Main recommendation entry point with multiple strategies
   */
  async getRecommendations() {
    try {
      const cart = this.cartUplift.cart;
      const cacheKey = this.buildCacheKey(cart);
      
      // Check cache first
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }

      let recommendations = [];

      // Strategy 1: Server-side recommendations (best performance + ML)
      if (cart?.items?.length > 0) {
        const serverRecs = await this.getServerRecommendations(cart);
        if (serverRecs.length > 0) {
          recommendations = serverRecs;
        }
      }

      // Strategy 2: Client-side algorithms (fallback)
      if (recommendations.length === 0) {
        recommendations = await this.getClientRecommendations(cart);
      }

      // Strategy 3: Popular products (ultimate fallback)
      if (recommendations.length === 0) {
        recommendations = await this.getPopularProducts();
      }

      // Post-process: diversity, business rules, availability
      const processed = await this.postProcessRecommendations(recommendations);
      
      // 🎯 Track ml_recommendation_served event for attribution
      if (processed.length > 0) {
        this.trackRecommendationsServed(cart, processed).catch(err => 
          console.warn('Failed to track recommendations:', err)
        );
      }
      
      // Cache result
      this.cache.set(cacheKey, processed, 'session');
      
      return processed;

    } catch (error) {
      console.error('Enhanced recommendations failed:', error);
      return this.getFallbackRecommendations();
    }
  }
  
  /**
   * Track ml_recommendation_served for purchase attribution
   */
  async trackRecommendationsServed(cart, recommendations) {
    try {
      const shop = window.Shopify?.shop || '';
      const anchorProducts = cart?.items?.map(item => String(item.product_id)).filter(Boolean) || [];
      const recommendedProducts = recommendations.map(rec => String(rec.id)).filter(Boolean);
      
      await fetch(`/apps/cart-uplift/api/track-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop,
          sessionId: this.cartUplift.sessionId,
          customerId: window.Shopify?.customerId || null,
          anchorProducts,
          recommendedProducts
        })
      });
    } catch (error) {
      // Silently fail - don't break recommendations
      console.warn('Recommendation tracking failed:', error);
    }
  }

  /**
   * Server-side recommendations with better error handling
   */
  async getServerRecommendations(cart) {
    try {
      const desired = Number(this.cartUplift.settings.maxRecommendations) || 4;
      const limit = Math.max(desired, 4);
      const ids = cart.items.map(item => String(item.product_id)).filter(Boolean);
      const productId = ids[0];
      const cartParam = ids.join(',');
      
      const url = `/apps/cart-uplift/api/recommendations?product_id=${encodeURIComponent(productId)}&cart=${encodeURIComponent(cartParam)}&limit=${encodeURIComponent(String(limit))}`;

      // Use AbortController with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s timeout

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) return [];
        
        const data = await response.json();
        const serverRecs = Array.isArray(data.recommendations) ? data.recommendations : [];
        
        if (serverRecs.length === 0) return [];

        // Enrich server recommendations with full product data
        const enriched = await this.enrichServerRecommendations(serverRecs, limit);
        
        return enriched.map(rec => ({
          ...rec,
          score: (rec.score || 0) + 0.9, // Boost server recommendations
          strategy: 'server'
        }));

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.warn('Server recommendations timed out');
        } else {
          console.warn('Server recommendations failed:', fetchError.message);
        }
        return [];
      }

    } catch (error) {
      console.warn('Server recommendations error:', error);
      return [];
    }
  }

  /**
   * Enhanced client-side recommendations
   */
  async getClientRecommendations(cart) {
    const strategies = await Promise.allSettled([
      this.getComplementaryRecommendations(cart),
      this.getFrequentlyBoughtTogether(cart),
      this.getCategoryBasedRecommendations(cart),
      this.getPriceBasedRecommendations(cart)
    ]);

    // Combine results from successful strategies
    const allRecs = strategies
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value || []);

    // Deduplicate and score
    return this.deduplicateAndScore(allRecs);
  }

  /**
   * Improved complementary recommendations
   */
  async getComplementaryRecommendations(cart) {
    if (!cart?.items?.length) return [];
    
    const recommendations = [];
    const complementTypes = new Set();

    // Analyze cart items for complements
    for (const item of cart.items) {
      const productText = `${item.product_title} ${item.product_type || ''}`.toLowerCase();
      
      // Check manual rules first (higher priority)
      for (const [pattern, rule] of this.manualRules) {
        if (pattern.test(productText)) {
          rule.complements.forEach(complement => complementTypes.add({
            keyword: complement,
            confidence: rule.confidence,
            source: 'manual'
          }));
        }
      }

      // Check automatic rules
      for (const [pattern, rule] of this.complementRules) {
        if (pattern.test(productText)) {
          rule.complements.forEach(complement => complementTypes.add({
            keyword: complement,
            confidence: rule.confidence,
            source: 'auto'
          }));
        }
      }
    }

    // Search for complement products (limit to top 6 complement types)
    const topComplements = Array.from(complementTypes)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6);

    for (const complement of topComplements) {
      try {
        const products = await this.searchProductsByKeyword(complement.keyword);
        products.forEach(product => {
          recommendations.push({
            ...product,
            score: complement.confidence,
            strategy: 'complement',
            complementType: complement.keyword,
            source: complement.source
          });
        });
      } catch (error) {
        console.warn(`Failed to search for complement "${complement.keyword}":`, error);
      }
    }

    return recommendations;
  }

  /**
   * Category-based recommendations with improved logic
   */
  async getCategoryBasedRecommendations(cart) {
    if (!cart?.items?.length) return [];

    const categories = new Set();
    const types = new Set();
    
    cart.items.forEach(item => {
      if (item.product_type) types.add(item.product_type);
      // Extract category from collections or tags if available
      if (item.collections) {
        item.collections.forEach(collection => categories.add(collection));
      }
    });

    const recommendations = [];

    // Search by product type
    for (const type of Array.from(types).slice(0, 2)) {
      try {
        const products = await this.searchProductsByKeyword(type);
        products.forEach(product => {
          recommendations.push({
            ...product,
            score: 0.6,
            strategy: 'category',
            categoryType: type
          });
        });
      } catch (error) {
        console.warn(`Category search failed for "${type}":`, error);
      }
    }

    return recommendations;
  }

  /**
   * Price-based recommendations with better targeting
   */
  async getPriceBasedRecommendations(cart) {
    if (!cart?.items?.length) return [];

    const cartValue = cart.total_price || 0;
    const avgItemPrice = cart.items.reduce((sum, item) => sum + (item.price || 0), 0) / cart.items.length;

    // Smart price targeting based on cart analysis
    let targetRange;
    if (cartValue > 15000) { // High-value cart
      targetRange = { min: Math.floor(avgItemPrice * 0.3), max: Math.floor(avgItemPrice * 0.8) };
    } else if (cartValue > 8000) { // Medium cart
      targetRange = { min: Math.floor(avgItemPrice * 0.2), max: Math.floor(avgItemPrice * 0.6) };
    } else { // Budget cart
      targetRange = { min: Math.floor(avgItemPrice * 0.1), max: Math.floor(avgItemPrice * 0.4) };
    }

    const priceBasedProducts = await this.getProductsInPriceRange(targetRange);
    
    return priceBasedProducts.map(product => ({
      ...product,
      score: 0.4,
      strategy: 'price_intelligence',
      targetRange
    }));
  }

  /**
   * Enhanced search with parallel execution and better caching
   */
  async searchProductsByKeyword(keyword) {
    const cacheKey = `search_${keyword}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const desired = Number(this.cartUplift.settings.maxRecommendations) || 4;
      const searchLimit = Math.max(desired, 3);
      const results = [];

      // Try multiple search strategies in parallel
      const searchPromises = [
        this.searchViaAPI(keyword, searchLimit),
        this.searchViaProducts(keyword, searchLimit)
      ];

      const searchResults = await Promise.allSettled(searchPromises);
      
      // Combine results, preferring API results
      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          results.push(...result.value);
        }
      });

      // Deduplicate by product ID
      const uniqueResults = this.deduplicateById(results).slice(0, searchLimit);
      
      // Cache successful searches
      if (uniqueResults.length > 0) {
        this.cache.set(cacheKey, uniqueResults, 'session');
      }

      return uniqueResults;

    } catch (error) {
      console.warn(`Search failed for "${keyword}":`, error);
      return [];
    }
  }

  /**
   * Search via Shopify's suggest API
   */
  async searchViaAPI(keyword, limit) {
    try {
      const response = await fetch(`/search/suggest.json?q=${encodeURIComponent(keyword)}&resources[type]=product&limit=${limit}`);
      if (!response.ok) return [];
      
      const data = await response.json();
      const products = data.resources?.results?.products || [];
      
      return await this.apiClient.enrichProducts(
        products.map(p => this.extractHandle(p)).filter(Boolean),
        { maxConcurrent: 2, timeout: 600 }
      ).then(enriched => 
        enriched
          .filter(e => e.success && e.data)
          .map(e => this.formatProduct(e.data))
          .filter(Boolean)
      );
    } catch (error) {
      console.warn('API search failed:', error);
      return [];
    }
  }

  /**
   * Search via products.json with filtering
   */
  async searchViaProducts(keyword, limit) {
    try {
      const cacheKey = 'all_products';
      let allProducts = await this.cache.get(cacheKey);
      
      if (!allProducts) {
        const response = await fetch('/products.json?limit=250');
        if (!response.ok) return [];
        
        const data = await response.json();
        allProducts = data.products || [];
        
        // Cache for 10 minutes
        this.cache.set(cacheKey, allProducts, 'session');
      }

      const keywordLower = keyword.toLowerCase();
      const filtered = allProducts.filter(product => 
        product.title?.toLowerCase().includes(keywordLower) ||
        product.product_type?.toLowerCase().includes(keywordLower) ||
        product.tags?.some(tag => tag.toLowerCase().includes(keywordLower)) ||
        product.vendor?.toLowerCase().includes(keywordLower)
      );

      return filtered
        .slice(0, limit)
        .map(p => this.formatProduct(p))
        .filter(Boolean);

    } catch (error) {
      console.warn('Products.json search failed:', error);
      return [];
    }
  }

  // ... (continuing with other utility methods)
  // [The rest of the methods would follow the same pattern of enhancement]
}
