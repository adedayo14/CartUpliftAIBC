/**
 * Customer profiling and ML feature generation
 * Privacy-compliant customer behavior analysis
 */
export class CustomerProfiler {
  constructor(privacyLevel, userId = null) {
    this.privacyLevel = privacyLevel;
    this.userId = userId;
    this.profile = null;
    this.features = null;
    
    this.loadProfile();
  }

  async loadProfile() {
    if (this.privacyLevel === 'basic') {
      this.profile = this.createAnonymousProfile();
      return;
    }

    try {
      // Load from localStorage first (instant)
      const cached = localStorage.getItem(`cu_profile_${this.userId}`);
      if (cached) {
        const profileData = JSON.parse(cached);
        
        // Check if profile is recent (24 hours)
        if (Date.now() - profileData.lastUpdated < 24 * 60 * 60 * 1000) {
          this.profile = profileData.profile;
          this.features = profileData.features;
        }
      }

      // Fetch fresh profile from server
      if (!this.profile) {
        await this.fetchProfileFromServer();
      }
    } catch (error) {
      console.warn('Failed to load customer profile:', error);
      this.profile = this.createBasicProfile();
    }
  }

  createAnonymousProfile() {
    return {
      type: 'anonymous',
      session_count: 1,
      preferences: this.getBasicPreferences(),
      created_at: Date.now(),
      updated_at: Date.now()
    };
  }

  createBasicProfile() {
    return {
      type: 'basic',
      user_id: this.userId,
      session_count: 1,
      total_cart_value: 0,
      purchase_count: 0,
      preferences: this.getBasicPreferences(),
      segments: ['new_visitor'],
      created_at: Date.now(),
      updated_at: Date.now()
    };
  }

  async fetchProfileFromServer() {
    const response = await fetch('/apps/cart-uplift/api/ml/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: this.userId,
        privacy_level: this.privacyLevel
      })
    });

    if (response.ok) {
      const data = await response.json();
      this.profile = data.profile;
      this.features = data.features;
      
      // Cache in localStorage
      this.cacheProfile();
    } else {
      this.profile = this.createBasicProfile();
    }
  }

  cacheProfile() {
    if (this.privacyLevel === 'basic') return;

    try {
      const cacheData = {
        profile: this.profile,
        features: this.features,
        lastUpdated: Date.now()
      };
      
      localStorage.setItem(`cu_profile_${this.userId}`, JSON.stringify(cacheData));
    } catch (error) {
      console.warn('Failed to cache profile:', error);
    }
  }

  /**
   * Generate ML features for recommendation algorithms
   */
  generateFeatures() {
    if (!this.profile) return null;

    const features = {
      // Behavioral features
      recency: this.calculateRecency(),
      frequency: this.calculateFrequency(), 
      monetary: this.calculateMonetary(),
      
      // Preference features
      category_affinity: this.calculateCategoryAffinity(),
      price_sensitivity: this.calculatePriceSensitivity(),
      brand_loyalty: this.calculateBrandLoyalty(),
      
      // Temporal features
      time_patterns: this.calculateTimePatterns(),
      seasonality: this.calculateSeasonality(),
      
      // Contextual features
      device_preference: this.getDevicePreference(),
      session_context: this.getSessionContext(),
      
      // Advanced features (full ML only)
      ...(this.privacyLevel === 'full_ml' ? this.generateAdvancedFeatures() : {})
    };

    this.features = features;
    return features;
  }

  calculateRecency() {
    if (!this.profile.last_purchase_date) {
      return { score: 0, days_since: null };
    }

    const daysSince = (Date.now() - this.profile.last_purchase_date) / (24 * 60 * 60 * 1000);
    
    // Recency score (higher = more recent)
    let score = 0;
    if (daysSince <= 7) score = 5;
    else if (daysSince <= 30) score = 4;
    else if (daysSince <= 90) score = 3;
    else if (daysSince <= 180) score = 2;
    else score = 1;

    return { score, days_since: Math.floor(daysSince) };
  }

  calculateFrequency() {
    const purchases = this.profile.purchase_count || 0;
    const sessions = this.profile.session_count || 1;
    
    // Frequency scores
    let purchaseFreq = 0;
    if (purchases >= 10) purchaseFreq = 5;
    else if (purchases >= 5) purchaseFreq = 4;
    else if (purchases >= 3) purchaseFreq = 3;
    else if (purchases >= 1) purchaseFreq = 2;
    else purchaseFreq = 1;

    return {
      purchase_frequency: purchaseFreq,
      session_frequency: Math.min(5, Math.floor(sessions / 10) + 1),
      conversion_rate: purchases / sessions
    };
  }

  calculateMonetary() {
    const totalValue = this.profile.total_purchase_value || 0;
    const avgOrderValue = this.profile.average_order_value || 0;
    
    // Monetary scores
    let monetaryScore = 0;
    if (totalValue >= 1000) monetaryScore = 5;
    else if (totalValue >= 500) monetaryScore = 4;
    else if (totalValue >= 200) monetaryScore = 3;
    else if (totalValue >= 50) monetaryScore = 2;
    else monetaryScore = 1;

    return {
      total_value: totalValue,
      average_order_value: avgOrderValue,
      monetary_score: monetaryScore,
      price_tier: this.getPriceTier(avgOrderValue)
    };
  }

  calculateCategoryAffinity() {
    const categoryPrefs = this.profile.category_preferences || {};
    const totalInteractions = Object.values(categoryPrefs).reduce((sum, count) => sum + count, 0);
    
    if (totalInteractions === 0) {
      return { primary: null, secondary: null, distribution: {} };
    }

    // Normalize to percentages
    const distribution = {};
    let primary = null;
    let secondary = null;
    let maxScore = 0;
    let secondMaxScore = 0;

    for (const [category, count] of Object.entries(categoryPrefs)) {
      const score = count / totalInteractions;
      distribution[category] = score;
      
      if (score > maxScore) {
        secondary = primary;
        secondMaxScore = maxScore;
        primary = category;
        maxScore = score;
      } else if (score > secondMaxScore) {
        secondary = category;
        secondMaxScore = score;
      }
    }

    return { primary, secondary, distribution };
  }

  calculatePriceSensitivity() {
    const priceHistory = this.profile.price_interactions || [];
    
    if (priceHistory.length === 0) {
      return { sensitivity: 'unknown', preference: 'mid_range' };
    }

    // Analyze price patterns
    const avgPrice = priceHistory.reduce((sum, p) => sum + p, 0) / priceHistory.length;
    const priceVariance = this.calculateVariance(priceHistory);
    
    let sensitivity = 'medium';
    let preference = 'mid_range';

    if (avgPrice < 25) {
      sensitivity = 'high';
      preference = 'budget';
    } else if (avgPrice > 100) {
      sensitivity = 'low';
      preference = 'premium';
    }

    // High variance suggests price shopping
    if (priceVariance > avgPrice * 0.5) {
      sensitivity = 'high';
    }

    return {
      sensitivity,
      preference,
      average_price: avgPrice,
      price_variance: priceVariance
    };
  }

  calculateBrandLoyalty() {
    const brandPrefs = this.profile.brand_preferences || {};
    const totalBrands = Object.keys(brandPrefs).length;
    const totalInteractions = Object.values(brandPrefs).reduce((sum, count) => sum + count, 0);

    if (totalInteractions === 0) {
      return { loyalty_score: 0, top_brands: [], diversity: 0 };
    }

    // Brand concentration (loyalty vs exploration)
    const brandScores = Object.entries(brandPrefs)
      .map(([brand, count]) => ({ brand, score: count / totalInteractions }))
      .sort((a, b) => b.score - a.score);

    const topBrandScore = brandScores[0]?.score || 0;
    const loyaltyScore = topBrandScore * 5; // 0-5 scale

    return {
      loyalty_score: loyaltyScore,
      top_brands: brandScores.slice(0, 3).map(b => b.brand),
      diversity: totalBrands / Math.max(1, totalInteractions / 5)
    };
  }

  calculateTimePatterns() {
    const timeData = this.profile.time_patterns || {};
    
    return {
      preferred_hours: this.getTopTimeSlots(timeData.hourly || {}),
      preferred_days: this.getTopTimeSlots(timeData.daily || {}),
      session_duration_avg: timeData.avg_session_duration || 0,
      peak_activity: this.getPeakActivity(timeData)
    };
  }

  calculateSeasonality() {
    const seasonalData = this.profile.seasonal_patterns || {};
    
    return {
      seasonal_preferences: seasonalData,
      current_season_activity: this.getCurrentSeasonActivity(seasonalData),
      holiday_behavior: seasonalData.holidays || 'unknown'
    };
  }

  getDevicePreference() {
    return {
      primary_device: this.profile.device_usage?.primary || 'unknown',
      mobile_usage: this.profile.device_usage?.mobile_percentage || 0,
      cross_device: this.profile.device_usage?.cross_device || false
    };
  }

  getSessionContext() {
    return {
      current_session_length: Date.now() - (this.profile.session_start || Date.now()),
      pages_viewed: this.profile.current_session?.pages_viewed || 0,
      cart_interactions: this.profile.current_session?.cart_interactions || 0,
      search_queries: this.profile.current_session?.search_queries || []
    };
  }

  generateAdvancedFeatures() {
    return {
      // Clustering features
      cluster_id: this.profile.cluster_id || null,
      similarity_scores: this.profile.similarity_scores || {},
      
      // Sequence features
      purchase_sequence: this.profile.purchase_sequences || [],
      cart_abandon_patterns: this.profile.abandon_patterns || {},
      
      // Predictive features
      churn_risk: this.calculateChurnRisk(),
      lifetime_value_prediction: this.profile.predicted_ltv || 0,
      next_purchase_probability: this.profile.next_purchase_prob || 0,
      
      // Behavioral embeddings
      user_embedding: this.profile.user_embedding || null,
      product_affinities: this.profile.product_affinities || {}
    };
  }

  calculateChurnRisk() {
    if (this.privacyLevel !== 'full_ml') return 0;
    
    const recency = this.calculateRecency();
    const frequency = this.calculateFrequency();
    
    // Simple churn risk calculation
    let riskScore = 0;
    
    if (recency.days_since > 90) riskScore += 0.4;
    if (frequency.conversion_rate < 0.1) riskScore += 0.3;
    if ((this.profile.session_count || 0) < 3) riskScore += 0.2;
    if ((this.profile.total_cart_value || 0) < 50) riskScore += 0.1;
    
    return Math.min(1, riskScore);
  }

  // Utility methods
  getBasicPreferences() {
    // Extract preferences from current session/context
    return {
      category: null,
      price_range: 'mid',
      brand: null,
      last_updated: Date.now()
    };
  }

  getPriceTier(avgOrderValue) {
    if (avgOrderValue < 25) return 'budget';
    if (avgOrderValue < 75) return 'mid_range';
    if (avgOrderValue < 150) return 'premium';
    return 'luxury';
  }

  calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  getTopTimeSlots(timeData) {
    return Object.entries(timeData)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([slot]) => slot);
  }

  getPeakActivity(timeData) {
    // Find the hour and day with highest activity
    const hourly = timeData.hourly || {};
    const daily = timeData.daily || {};
    
    const peakHour = Object.entries(hourly).reduce((peak, [hour, count]) => 
      count > (hourly[peak] || 0) ? hour : peak, '12');
    
    const peakDay = Object.entries(daily).reduce((peak, [day, count]) => 
      count > (daily[peak] || 0) ? day : peak, 'monday');

    return { hour: parseInt(peakHour), day: peakDay };
  }

  getCurrentSeasonActivity(seasonalData) {
    const month = new Date().getMonth();
    let season = 'spring';
    
    if (month >= 2 && month <= 4) season = 'spring';
    else if (month >= 5 && month <= 7) season = 'summer';
    else if (month >= 8 && month <= 10) season = 'fall';
    else season = 'winter';

    return seasonalData[season] || 0;
  }

  /**
   * Update profile with new behavior data
   */
  async updateProfile(behaviorData) {
    if (this.privacyLevel === 'basic') return;

    // Update local profile
    this.incrementalUpdate(behaviorData);
    
    // Cache updated profile
    this.cacheProfile();
    
    // Send to server for ML processing (async)
    this.sendProfileUpdate(behaviorData);
  }

  incrementalUpdate(behaviorData) {
    if (!this.profile) return;

    this.profile.updated_at = Date.now();
    
    // Update basic counters
    if (behaviorData.type === 'session_start') {
      this.profile.session_count = (this.profile.session_count || 0) + 1;
    }
    
    if (behaviorData.type === 'purchase') {
      this.profile.purchase_count = (this.profile.purchase_count || 0) + 1;
      this.profile.total_purchase_value = (this.profile.total_purchase_value || 0) + behaviorData.value;
      this.profile.last_purchase_date = Date.now();
    }
    
    // Update preferences
    if (behaviorData.category) {
      this.profile.category_preferences = this.profile.category_preferences || {};
      this.profile.category_preferences[behaviorData.category] = 
        (this.profile.category_preferences[behaviorData.category] || 0) + 1;
    }
  }

  async sendProfileUpdate(behaviorData) {
    try {
      await fetch('/apps/cart-uplift/api/ml/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: this.userId,
          behavior_data: behaviorData,
          privacy_level: this.privacyLevel
        })
      });
    } catch (error) {
      console.warn('Failed to send profile update:', error);
    }
  }

  /**
   * Get profile for ML algorithms
   */
  getMLProfile() {
    return {
      profile: this.profile,
      features: this.features || this.generateFeatures(),
      privacy_level: this.privacyLevel
    };
  }
}
