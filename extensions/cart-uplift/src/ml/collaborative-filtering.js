/**
 * Collaborative Filtering Recommendation Engine
 * Implements user-based and item-based collaborative filtering with privacy controls
 */
export class CollaborativeFilteringEngine {
  constructor(privacyLevel = 'basic') {
    this.privacyLevel = privacyLevel;
    this.userItemMatrix = new Map();
    this.itemSimilarityMatrix = new Map();
    this.userSimilarityMatrix = new Map();
    this.globalStats = {
      avgRating: 0,
      totalInteractions: 0,
      uniqueUsers: 0,
      uniqueItems: 0
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the collaborative filtering system
   */
  async initialize() {
    if (this.privacyLevel === 'basic') {
      // Basic mode: only use aggregated, anonymous data
      await this.initializeBasicMode();
    } else {
      // Enhanced/Full ML: use collaborative data with privacy controls
      await this.initializeAdvancedMode();
    }
    
    this.initialized = true;
  }

  async initializeBasicMode() {
    // Use only aggregated product affinity data
    try {
      const response = await fetch('/apps/cart-uplift/api/ml/aggregated-affinities');
      const data = await response.json();
      
      this.itemSimilarityMatrix = new Map(data.item_similarities);
      this.globalStats = data.global_stats;
    } catch (error) {
      console.warn('Failed to load aggregated affinities:', error);
      this.initializeFallback();
    }
  }

  async initializeAdvancedMode() {
    // Load collaborative filtering data with privacy controls
    try {
      const response = await fetch('/apps/cart-uplift/api/ml/collaborative-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privacy_level: this.privacyLevel,
          include_user_similarities: this.privacyLevel === 'full_ml'
        })
      });
      
      const data = await response.json();
      
      // Load matrices
      this.loadUserItemMatrix(data.user_item_interactions);
      this.loadItemSimilarityMatrix(data.item_similarities);
      
      if (this.privacyLevel === 'full_ml') {
        this.loadUserSimilarityMatrix(data.user_similarities);
      }
      
      this.globalStats = data.global_stats;
      
    } catch (error) {
      console.warn('Failed to load collaborative data:', error);
      await this.initializeBasicMode();
    }
  }

  initializeFallback() {
    // Fallback to empty state with basic stats
    this.globalStats = {
      avgRating: 3.5,
      totalInteractions: 0,
      uniqueUsers: 0,
      uniqueItems: 0
    };
  }

  loadUserItemMatrix(interactions) {
    this.userItemMatrix.clear();
    
    for (const interaction of interactions) {
      const userId = interaction.user_id;
      const itemId = interaction.product_id;
      const rating = this.calculateImplicitRating(interaction);
      
      if (!this.userItemMatrix.has(userId)) {
        this.userItemMatrix.set(userId, new Map());
      }
      
      this.userItemMatrix.get(userId).set(itemId, rating);
    }
  }

  loadItemSimilarityMatrix(similarities) {
    this.itemSimilarityMatrix.clear();
    
    for (const sim of similarities) {
      const key = `${sim.item1_id}-${sim.item2_id}`;
      this.itemSimilarityMatrix.set(key, sim.similarity);
    }
  }

  loadUserSimilarityMatrix(similarities) {
    this.userSimilarityMatrix.clear();
    
    for (const sim of similarities) {
      const key = `${sim.user1_id}-${sim.user2_id}`;
      this.userSimilarityMatrix.set(key, sim.similarity);
    }
  }

  /**
   * Generate recommendations for a user
   */
  async getRecommendations(userId, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      excludeItems = [],
      maxResults = 10,
      minScore = 0.1,
      strategy = 'hybrid' // 'user_based', 'item_based', 'hybrid'
    } = options;

    let recommendations = [];

    if (this.privacyLevel === 'basic') {
      recommendations = await this.getBasicRecommendations(excludeItems, maxResults);
    } else {
      switch (strategy) {
        case 'user_based':
          recommendations = this.getUserBasedRecommendations(userId, excludeItems, maxResults);
          break;
        case 'item_based':
          recommendations = this.getItemBasedRecommendations(userId, excludeItems, maxResults);
          break;
        case 'hybrid':
        default:
          recommendations = this.getHybridRecommendations(userId, excludeItems, maxResults);
          break;
      }
    }

    // Filter by minimum score and return top results
    return recommendations
      .filter(rec => rec.score >= minScore)
      .slice(0, maxResults)
      .map(rec => ({
        ...rec,
        strategy: 'collaborative_filtering',
        algorithm: strategy,
        privacy_level: this.privacyLevel
      }));
  }

  async getBasicRecommendations(excludeItems, maxResults) {
    // Use item similarities only (no user data)
    const recommendations = [];
    const itemIds = Array.from(this.itemSimilarityMatrix.keys())
      .map(key => key.split('-'))
      .flat()
      .filter((id, index, arr) => arr.indexOf(id) === index);

    for (const itemId of itemIds) {
      if (excludeItems.includes(itemId)) continue;

      const score = this.getItemPopularityScore(itemId);
      
      if (score > 0) {
        recommendations.push({
          product_id: itemId,
          score,
          reason: 'popular_item'
        });
      }
    }

    return recommendations.sort((a, b) => b.score - a.score);
  }

  getUserBasedRecommendations(userId, excludeItems, maxResults) {
    if (!this.userItemMatrix.has(userId)) {
      return this.getItemBasedRecommendations(userId, excludeItems, maxResults);
    }

    const userItems = this.userItemMatrix.get(userId);
    const similarUsers = this.findSimilarUsers(userId);
    const recommendations = new Map();

    // Get items liked by similar users
    for (const { userId: similarUserId, similarity } of similarUsers.slice(0, 50)) {
      const similarUserItems = this.userItemMatrix.get(similarUserId);
      
      if (!similarUserItems) continue;

      for (const [itemId, rating] of similarUserItems) {
        if (excludeItems.includes(itemId) || userItems.has(itemId)) continue;

        const score = similarity * (rating - this.globalStats.avgRating);
        
        if (recommendations.has(itemId)) {
          recommendations.set(itemId, recommendations.get(itemId) + score);
        } else {
          recommendations.set(itemId, score);
        }
      }
    }

    // Normalize scores
    return Array.from(recommendations.entries())
      .map(([itemId, score]) => ({
        product_id: itemId,
        score: this.normalizeScore(score),
        reason: 'similar_users'
      }))
      .sort((a, b) => b.score - a.score);
  }

  getItemBasedRecommendations(userId, excludeItems, maxResults) {
    const userItems = this.userItemMatrix.get(userId);
    const recommendations = new Map();

    if (!userItems) {
      // New user - use popular items
      return this.getPopularItemRecommendations(excludeItems, maxResults);
    }

    // For each item the user has interacted with
    for (const [userItemId, userRating] of userItems) {
      const similarItems = this.findSimilarItems(userItemId);

      for (const { itemId, similarity } of similarItems) {
        if (excludeItems.includes(itemId) || userItems.has(itemId)) continue;

        const score = similarity * userRating;
        
        if (recommendations.has(itemId)) {
          recommendations.set(itemId, recommendations.get(itemId) + score);
        } else {
          recommendations.set(itemId, score);
        }
      }
    }

    return Array.from(recommendations.entries())
      .map(([itemId, score]) => ({
        product_id: itemId,
        score: this.normalizeScore(score),
        reason: 'similar_items'
      }))
      .sort((a, b) => b.score - a.score);
  }

  getHybridRecommendations(userId, excludeItems, maxResults) {
    const userBasedRecs = this.getUserBasedRecommendations(userId, excludeItems, maxResults * 2);
    const itemBasedRecs = this.getItemBasedRecommendations(userId, excludeItems, maxResults * 2);

    // Combine recommendations with weighted scores
    const combined = new Map();
    const userWeight = 0.6;
    const itemWeight = 0.4;

    // Add user-based recommendations
    for (const rec of userBasedRecs) {
      combined.set(rec.product_id, {
        ...rec,
        score: rec.score * userWeight,
        reason: 'hybrid_user_based'
      });
    }

    // Add item-based recommendations
    for (const rec of itemBasedRecs) {
      if (combined.has(rec.product_id)) {
        const existing = combined.get(rec.product_id);
        existing.score += rec.score * itemWeight;
        existing.reason = 'hybrid_combined';
      } else {
        combined.set(rec.product_id, {
          ...rec,
          score: rec.score * itemWeight,
          reason: 'hybrid_item_based'
        });
      }
    }

    return Array.from(combined.values())
      .sort((a, b) => b.score - a.score);
  }

  getPopularItemRecommendations(excludeItems, maxResults) {
    // Fallback for new users
    const popularItems = [];
    
    // Calculate popularity based on interaction frequency
    const itemCounts = new Map();
    
    for (const userItems of this.userItemMatrix.values()) {
      for (const itemId of userItems.keys()) {
        itemCounts.set(itemId, (itemCounts.get(itemId) || 0) + 1);
      }
    }

    for (const [itemId, count] of itemCounts) {
      if (excludeItems.includes(itemId)) continue;
      
      popularItems.push({
        product_id: itemId,
        score: count / this.globalStats.uniqueUsers,
        reason: 'popular_item'
      });
    }

    return popularItems
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  findSimilarUsers(userId) {
    if (this.privacyLevel !== 'full_ml') return [];

    const userItems = this.userItemMatrix.get(userId);
    if (!userItems) return [];

    const similarities = [];

    for (const [otherUserId, otherUserItems] of this.userItemMatrix) {
      if (otherUserId === userId) continue;

      const similarity = this.calculateUserSimilarity(userItems, otherUserItems);
      
      if (similarity > 0.1) {
        similarities.push({ userId: otherUserId, similarity });
      }
    }

    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  findSimilarItems(itemId) {
    const similarities = [];

    // Check precomputed similarities
    for (const [key, similarity] of this.itemSimilarityMatrix) {
      const [item1, item2] = key.split('-');
      
      if (item1 === itemId && similarity > 0.1) {
        similarities.push({ itemId: item2, similarity });
      } else if (item2 === itemId && similarity > 0.1) {
        similarities.push({ itemId: item1, similarity });
      }
    }

    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  calculateUserSimilarity(userItems1, userItems2) {
    // Cosine similarity between user preference vectors
    const commonItems = [];
    const user1Ratings = [];
    const user2Ratings = [];

    for (const [itemId, rating1] of userItems1) {
      if (userItems2.has(itemId)) {
        commonItems.push(itemId);
        user1Ratings.push(rating1);
        user2Ratings.push(userItems2.get(itemId));
      }
    }

    if (commonItems.length < 2) return 0;

    return this.cosineSimilarity(user1Ratings, user2Ratings);
  }

  calculateImplicitRating(interaction) {
    // Convert interaction data to implicit rating (1-5 scale)
    let rating = 1;

    // Base interaction type scores
    const typeScores = {
      view: 1,
      cart_add: 2,
      purchase: 5,
      wishlist: 3,
      share: 2
    };

    rating = typeScores[interaction.interaction_type] || 1;

    // Adjust for interaction strength
    if (interaction.view_duration && interaction.view_duration > 30000) {
      rating += 0.5; // Long view
    }

    if (interaction.repeated_views && interaction.repeated_views > 2) {
      rating += 0.5; // Multiple views
    }

    // Recency boost
    const daysSince = (Date.now() - interaction.timestamp) / (24 * 60 * 60 * 1000);
    if (daysSince < 7) {
      rating += 0.3;
    }

    return Math.min(5, Math.max(1, rating));
  }

  getItemPopularityScore(itemId) {
    // Simple popularity based on interaction count
    let totalInteractions = 0;
    
    for (const userItems of this.userItemMatrix.values()) {
      if (userItems.has(itemId)) {
        totalInteractions += userItems.get(itemId);
      }
    }

    return totalInteractions / Math.max(1, this.globalStats.uniqueUsers);
  }

  cosineSimilarity(vector1, vector2) {
    if (vector1.length !== vector2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      norm1 += vector1[i] * vector1[i];
      norm2 += vector2[i] * vector2[i];
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  normalizeScore(score) {
    // Normalize score to 0-1 range using sigmoid function
    return 1 / (1 + Math.exp(-score));
  }

  /**
   * Update the collaborative filtering model with new interaction
   */
  updateModel(userId, itemId, interactionType, metadata = {}) {
    if (this.privacyLevel === 'basic') return;

    const rating = this.calculateImplicitRating({
      interaction_type: interactionType,
      timestamp: Date.now(),
      ...metadata
    });

    // Update user-item matrix
    if (!this.userItemMatrix.has(userId)) {
      this.userItemMatrix.set(userId, new Map());
    }

    this.userItemMatrix.get(userId).set(itemId, rating);

    // Update global stats
    this.globalStats.totalInteractions++;
    
    if (!this.userItemMatrix.has(userId)) {
      this.globalStats.uniqueUsers++;
    }

    // Recalculate average rating (incremental)
    const totalRating = Array.from(this.userItemMatrix.values())
      .reduce((sum, userItems) => {
        return sum + Array.from(userItems.values()).reduce((userSum, rating) => userSum + rating, 0);
      }, 0);
    
    this.globalStats.avgRating = totalRating / this.globalStats.totalInteractions;

    // Queue model update (async)
    this.queueModelUpdate(userId, itemId, rating);
  }

  async queueModelUpdate(userId, itemId, rating) {
    // Send update to server for batch processing
    try {
      await fetch('/apps/cart-uplift/api/ml/collaborative/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          item_id: itemId,
          rating,
          timestamp: Date.now(),
          privacy_level: this.privacyLevel
        })
      });
    } catch (error) {
      console.warn('Failed to queue model update:', error);
    }
  }

  /**
   * Get explanation for a recommendation
   */
  explainRecommendation(userId, itemId) {
    if (this.privacyLevel === 'basic') {
      return 'Recommended based on popular products';
    }

    const userItems = this.userItemMatrix.get(userId);
    if (!userItems) {
      return 'Recommended as a popular product for new customers';
    }

    // Find the strongest connection
    let bestReason = 'Recommended based on your preferences';
    let bestScore = 0;

    // Check item-based connections
    for (const [userItemId] of userItems) {
      const similarity = this.getItemSimilarity(userItemId, itemId);
      
      if (similarity > bestScore) {
        bestScore = similarity;
        bestReason = `People who liked this product also liked items in your cart`;
      }
    }

    // Check user-based connections (full ML only)
    if (this.privacyLevel === 'full_ml') {
      const similarUsers = this.findSimilarUsers(userId).slice(0, 5);
      
      for (const { similarity } of similarUsers) {
        if (similarity > bestScore) {
          bestScore = similarity;
          bestReason = 'Customers with similar tastes also purchased this';
        }
      }
    }

    return bestReason;
  }

  getItemSimilarity(itemId1, itemId2) {
    const key1 = `${itemId1}-${itemId2}`;
    const key2 = `${itemId2}-${itemId1}`;
    
    return this.itemSimilarityMatrix.get(key1) || this.itemSimilarityMatrix.get(key2) || 0;
  }
}
