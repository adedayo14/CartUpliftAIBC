/**
 * Main ML Recommendation Engine
 * Orchestrates all ML components with privacy controls
 */
import { BehaviorTracker } from './behavior-tracker.js';
import { CustomerProfiler } from './customer-profiler.js';
import { CollaborativeFilteringEngine } from './collaborative-filtering.js';
import { PrivacySettingsManager } from './privacy-settings.js';

export class MLRecommendationEngine {
  constructor() {
    this.privacyManager = new PrivacySettingsManager();
    this.behaviorTracker = null;
    this.customerProfiler = null;
    this.collaborativeEngine = null;
    
    this.initialized = false;
    this.userId = null;
    this.recommendations = new Map();
    this.lastUpdateTime = 0;
    
    this.init();
  }

  async init() {
    // Wait for privacy settings to load
    await this.waitForPrivacySettings();
    
    // Check consent validity
    const consentValid = await this.privacyManager.checkAndRefreshConsent();
    if (!consentValid) {
      console.warn('ML features disabled due to invalid consent');
      return;
    }

    // Initialize components based on privacy level
    const privacyLevel = this.privacyManager.getConsentLevel();
    await this.initializeComponents(privacyLevel);
    
    // Setup event listeners
    this.setupEventListeners();
    
    this.initialized = true;
    
    // Notify that ML engine is ready
    document.dispatchEvent(new CustomEvent('cartuplift:ml_ready', {
      detail: { 
        privacy_level: privacyLevel,
        features_enabled: this.getEnabledFeatures()
      }
    }));
  }

  async waitForPrivacySettings() {
    return new Promise((resolve) => {
      if (this.privacyManager.settings) {
        resolve();
      } else {
        const checkSettings = () => {
          if (this.privacyManager.settings) {
            resolve();
          } else {
            setTimeout(checkSettings, 100);
          }
        };
        checkSettings();
      }
    });
  }

  async initializeComponents(privacyLevel) {
    // Initialize behavior tracker
    this.behaviorTracker = new BehaviorTracker(privacyLevel);
    
    // Request consent for enhanced features
    if (privacyLevel !== 'basic') {
      const consentGranted = await this.behaviorTracker.requestConsent();
      if (!consentGranted) {
        // Fallback to basic mode
        privacyLevel = 'basic';
        this.behaviorTracker = new BehaviorTracker('basic');
      }
    }

    // Initialize other components
    this.customerProfiler = new CustomerProfiler(privacyLevel, this.getUserId());
    this.collaborativeEngine = new CollaborativeFilteringEngine(privacyLevel);
    
    // Initialize engines
    await Promise.all([
      this.collaborativeEngine.initialize()
    ]);
  }

  setupEventListeners() {
    // Privacy settings changes
    document.addEventListener('cartuplift:privacy_settings_updated', (e) => {
      this.handlePrivacyChange(e.detail);
    });

    // Cart events for real-time learning
    document.addEventListener('cartuplift:item_added', (e) => {
      this.trackInteraction('cart_add', e.detail);
    });

    document.addEventListener('cartuplift:item_removed', (e) => {
      this.trackInteraction('cart_remove', e.detail);
    });

    document.addEventListener('cartuplift:checkout_started', (e) => {
      this.trackInteraction('checkout_start', e.detail);
    });

    document.addEventListener('cartuplift:purchase_completed', (e) => {
      this.trackInteraction('purchase', e.detail);
    });

    // Recommendation interactions
    document.addEventListener('cartuplift:recommendation_viewed', (e) => {
      this.trackRecommendationInteraction('viewed', e.detail);
    });

    document.addEventListener('cartuplift:recommendation_clicked', (e) => {
      this.trackRecommendationInteraction('clicked', e.detail);
    });
  }

  async handlePrivacyChange(detail) {
    const { newLevel, previousLevel } = detail;
    
    if (newLevel !== previousLevel) {
      // Reinitialize components with new privacy level
      await this.initializeComponents(newLevel);
      
      // Clear recommendations cache
      this.recommendations.clear();
      
      // Notify about privacy change
      document.dispatchEvent(new CustomEvent('cartuplift:ml_privacy_changed', {
        detail: { 
          old_level: previousLevel,
          new_level: newLevel,
          features_enabled: this.getEnabledFeatures()
        }
      }));
    }
  }

  /**
   * Get personalized recommendations
   */
  async getRecommendations(options = {}) {
    if (!this.initialized) {
      await this.init();
    }

    const {
      context = 'general', // 'cart', 'product', 'checkout', 'general'
      productIds = [],
      excludeIds = [],
      maxResults = 10,
      strategies = ['collaborative', 'content', 'popularity'],
      includeReasons = true
    } = options;

    // Check cache first
    const cacheKey = this.getCacheKey(context, productIds, excludeIds, maxResults);
    if (this.recommendations.has(cacheKey) && this.isCacheValid(cacheKey)) {
      return this.recommendations.get(cacheKey);
    }

    try {
      const recommendations = await this.generateRecommendations({
        context,
        productIds,
        excludeIds,
        maxResults,
        strategies,
        includeReasons
      });

      // Cache results
      this.recommendations.set(cacheKey, {
        data: recommendations,
        timestamp: Date.now()
      });

      return recommendations;
    } catch (error) {
      console.warn('Failed to generate ML recommendations:', error);
      return this.getFallbackRecommendations(options);
    }
  }

  async generateRecommendations(options) {
    const { context, productIds, excludeIds, maxResults, strategies, includeReasons } = options;
    
    // Get customer profile
    const customerProfile = await this.getCustomerProfile();
    
    // Generate recommendations from different strategies
    const strategyResults = await Promise.all([
      // Collaborative filtering
      strategies.includes('collaborative') ? 
        this.getCollaborativeRecommendations(productIds, excludeIds, customerProfile) : [],
      
      // Content-based (enhanced rule-based)
      strategies.includes('content') ? 
        this.getContentBasedRecommendations(productIds, excludeIds, customerProfile) : [],
      
      // Popularity-based
      strategies.includes('popularity') ? 
        this.getPopularityBasedRecommendations(excludeIds, customerProfile) : []
    ]);

    // Combine and rank recommendations
    const combinedRecommendations = this.combineRecommendationStrategies(
      strategyResults,
      customerProfile,
      context
    );

    // Apply personalization based on customer profile
    const personalizedRecommendations = this.personalizeRecommendations(
      combinedRecommendations,
      customerProfile,
      context
    );

    // Add explanations if requested
    if (includeReasons) {
      personalizedRecommendations.forEach(rec => {
        rec.reason = this.generateRecommendationReason(rec, customerProfile);
      });
    }

    return personalizedRecommendations.slice(0, maxResults);
  }

  async getCollaborativeRecommendations(productIds, excludeIds, customerProfile) {
    if (!this.privacyManager.hasFeature('collaborative_filtering')) {
      return [];
    }

    const userId = this.getUserId();
    
    return await this.collaborativeEngine.getRecommendations(userId, {
      excludeItems: excludeIds,
      maxResults: 20,
      strategy: 'hybrid'
    });
  }

  async getContentBasedRecommendations(productIds, excludeIds, customerProfile) {
    // Use enhanced content-based recommendations with customer preferences
    const preferences = customerProfile?.features || {};
    
    try {
      const response = await fetch('/apps/cart-uplift/api/ml/content-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_ids: productIds,
          exclude_ids: excludeIds,
          customer_preferences: preferences,
          privacy_level: this.privacyManager.getConsentLevel()
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.recommendations || [];
      }
    } catch (error) {
      console.warn('Failed to get content-based recommendations:', error);
    }

    return [];
  }

  async getPopularityBasedRecommendations(excludeIds, customerProfile) {
    // Get popular items with customer preference filtering
    try {
      const response = await fetch('/apps/cart-uplift/api/ml/popular-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exclude_ids: excludeIds,
          customer_preferences: customerProfile?.features,
          privacy_level: this.privacyManager.getConsentLevel()
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.recommendations || [];
      }
    } catch (error) {
      console.warn('Failed to get popularity-based recommendations:', error);
    }

    return [];
  }

  combineRecommendationStrategies(strategyResults, customerProfile, context) {
    const [collaborative, contentBased, popularity] = strategyResults;
    const combined = new Map();

    // Weight strategies based on privacy level and customer data availability
    const weights = this.calculateStrategyWeights(customerProfile, context);

    // Add collaborative filtering results
    collaborative.forEach(rec => {
      this.addToRecommendationMap(combined, rec, weights.collaborative);
    });

    // Add content-based results
    contentBased.forEach(rec => {
      this.addToRecommendationMap(combined, rec, weights.content);
    });

    // Add popularity results
    popularity.forEach(rec => {
      this.addToRecommendationMap(combined, rec, weights.popularity);
    });

    return Array.from(combined.values())
      .sort((a, b) => b.combined_score - a.combined_score);
  }

  calculateStrategyWeights(customerProfile, context) {
    const privacyLevel = this.privacyManager.getConsentLevel();
    const hasProfile = customerProfile && customerProfile.profile;
    
    let weights = {
      collaborative: 0.3,
      content: 0.4,
      popularity: 0.3
    };

    // Adjust weights based on privacy level
    if (privacyLevel === 'basic') {
      weights = { collaborative: 0, content: 0.3, popularity: 0.7 };
    } else if (privacyLevel === 'enhanced') {
      weights = { collaborative: 0.4, content: 0.4, popularity: 0.2 };
    } else if (privacyLevel === 'full_ml') {
      weights = { collaborative: 0.5, content: 0.3, popularity: 0.2 };
    }

    // Adjust based on customer data availability
    if (!hasProfile) {
      weights.collaborative *= 0.5;
      weights.popularity += 0.25;
    }

    // Context-specific adjustments
    if (context === 'cart') {
      weights.collaborative += 0.1;
      weights.content += 0.1;
      weights.popularity -= 0.2;
    }

    return weights;
  }

  addToRecommendationMap(map, recommendation, weight) {
    const productId = recommendation.product_id;
    
    if (map.has(productId)) {
      const existing = map.get(productId);
      existing.combined_score += recommendation.score * weight;
      existing.strategies.push(recommendation.strategy || 'unknown');
    } else {
      map.set(productId, {
        ...recommendation,
        combined_score: recommendation.score * weight,
        strategies: [recommendation.strategy || 'unknown']
      });
    }
  }

  personalizeRecommendations(recommendations, customerProfile, context) {
    if (!customerProfile || !customerProfile.features) {
      return recommendations;
    }

    const features = customerProfile.features;
    
    return recommendations.map(rec => {
      let personalizedScore = rec.combined_score;
      
      // Price sensitivity adjustment
      if (features.monetary) {
        const priceTier = features.monetary.price_tier;
        // This would require product price data to be meaningful
        // For now, keep original score
      }

      // Category affinity boost
      if (features.category_affinity && features.category_affinity.primary) {
        // This would require product category data
        // For now, keep original score
      }

      // Temporal pattern adjustment
      if (features.time_patterns) {
        const currentHour = new Date().getHours();
        const preferredHours = features.time_patterns.preferred_hours || [];
        
        if (preferredHours.includes(currentHour.toString())) {
          personalizedScore *= 1.1; // Small boost for preferred time
        }
      }

      // Recency boost
      if (features.recency && features.recency.score > 3) {
        personalizedScore *= 1.05; // Active customers get slight boost
      }

      return {
        ...rec,
        personalized_score: personalizedScore,
        personalization_applied: true
      };
    }).sort((a, b) => b.personalized_score - a.personalized_score);
  }

  generateRecommendationReason(recommendation, customerProfile) {
    const strategies = recommendation.strategies || [];
    
    if (strategies.includes('collaborative_filtering')) {
      return this.collaborativeEngine.explainRecommendation(
        this.getUserId(), 
        recommendation.product_id
      );
    }
    
    if (strategies.includes('content_based')) {
      return 'Recommended based on similar products you\'ve viewed';
    }
    
    if (strategies.includes('popularity')) {
      return 'Popular choice among other customers';
    }
    
    return 'Hand picked for you';
  }

  /**
   * Track user interactions for learning
   */
  trackInteraction(type, data) {
    if (!this.initialized || !this.behaviorTracker) return;

    // Track with behavior tracker
    this.behaviorTracker.track(type, data);
    
    // Update customer profile
    if (this.customerProfiler) {
      this.customerProfiler.updateProfile({
        type,
        ...data,
        timestamp: Date.now()
      });
    }

    // Update collaborative filtering model
    if (this.collaborativeEngine && data.product_id) {
      this.collaborativeEngine.updateModel(
        this.getUserId(),
        data.product_id,
        type,
        data
      );
    }
  }

  trackRecommendationInteraction(action, data) {
    if (!this.initialized) return;

    // Track recommendation performance
    this.behaviorTracker?.track(`recommendation_${action}`, {
      product_id: data.product_id,
      position: data.position,
      strategy: data.strategy,
      context: data.context
    });
  }

  /**
   * Utility methods
   */
  async getCustomerProfile() {
    if (!this.customerProfiler) return null;
    
    return this.customerProfiler.getMLProfile();
  }

  getUserId() {
    if (!this.userId) {
      // Try to get from various sources
      this.userId = window.ShopifyAnalytics?.meta?.page?.customerId ||
                   localStorage.getItem('cu_user_id') ||
                   this.generateAnonymousId();
    }
    return this.userId;
  }

  generateAnonymousId() {
    const id = 'anon_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
    localStorage.setItem('cu_user_id', id);
    return id;
  }

  getEnabledFeatures() {
    return {
      personalized_recommendations: this.privacyManager.hasFeature('personalized_recommendations'),
      behavior_tracking: this.privacyManager.hasFeature('behavior_tracking'),
      collaborative_filtering: this.privacyManager.hasFeature('collaborative_filtering'),
      advanced_profiling: this.privacyManager.hasFeature('advanced_profiling')
    };
  }

  getCacheKey(context, productIds, excludeIds, maxResults) {
    return `${context}-${productIds.sort().join(',')}-${excludeIds.sort().join(',')}-${maxResults}`;
  }

  isCacheValid(cacheKey) {
    const cached = this.recommendations.get(cacheKey);
    if (!cached) return false;
    
    // Cache valid for 5 minutes
    return (Date.now() - cached.timestamp) < 5 * 60 * 1000;
  }

  async getFallbackRecommendations(options) {
    // Fallback to basic recommendations without ML
    try {
      const response = await fetch('/apps/cart-uplift/api/upsells', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_ids: options.productIds || [],
          max_results: options.maxResults || 10
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.recommendations || [];
      }
    } catch (error) {
      console.warn('Fallback recommendations failed:', error);
    }

    return [];
  }

  /**
   * Public API for integration
   */
  isReady() {
    return this.initialized;
  }

  getPrivacyLevel() {
    return this.privacyManager.getConsentLevel();
  }

  async showPrivacySettings() {
    return await this.privacyManager.showPrivacySettings();
  }

  // Cleanup
  destroy() {
    if (this.behaviorTracker) {
      this.behaviorTracker.destroy();
    }
    
    this.recommendations.clear();
  }
}
