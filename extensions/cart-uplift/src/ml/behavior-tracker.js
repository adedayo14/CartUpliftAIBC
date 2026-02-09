/**
 * Privacy-compliant behavior tracking for ML personalization
 * Implements GDPR-compliant data collection with user consent
 */
export class BehaviorTracker {
  constructor(privacyLevel = 'basic') {
    this.privacyLevel = privacyLevel; // 'basic', 'enhanced', 'full_ml'
    this.sessionId = this.generateSessionId();
    this.userId = null;
    this.events = [];
    this.flushTimer = null;
    this.consentGiven = false;
    
    this.init();
  }

  init() {
    // Check existing consent
    this.checkConsent();
    
    // Start tracking based on privacy level
    if (this.privacyLevel !== 'basic' && this.consentGiven) {
      this.initializeAdvancedTracking();
    } else {
      this.initializeBasicTracking();
    }
    
    // Periodic flush
    this.startFlushTimer();
  }

  checkConsent() {
    try {
      const consent = localStorage.getItem('cu_ml_consent');
      const consentData = consent ? JSON.parse(consent) : null;
      
      if (consentData && consentData.timestamp) {
        // Check if consent is still valid (6 months)
        const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
        this.consentGiven = consentData.timestamp > sixMonthsAgo && consentData.level === this.privacyLevel;
      }
    } catch (error) {
      this.consentGiven = false;
    }
  }

  /**
   * Request user consent for enhanced ML tracking
   */
  async requestConsent() {
    if (this.privacyLevel === 'basic') return true;
    
    const consentText = this.getConsentText();
    const userConsent = await this.showConsentDialog(consentText);
    
    if (userConsent) {
      this.grantConsent();
      this.initializeAdvancedTracking();
    }
    
    return userConsent;
  }

  grantConsent() {
    this.consentGiven = true;
    const consentData = {
      level: this.privacyLevel,
      timestamp: Date.now(),
      version: '1.0'
    };
    
    try {
      localStorage.setItem('cu_ml_consent', JSON.stringify(consentData));
    } catch (error) {
      console.warn('Failed to store consent:', error);
    }
    
    this.track('consent_granted', { level: this.privacyLevel });
  }

  revokeConsent() {
    this.consentGiven = false;
    
    try {
      localStorage.removeItem('cu_ml_consent');
      localStorage.removeItem('cu_user_profile');
      localStorage.removeItem('cu_behavior_history');
      localStorage.removeItem('cu_view_history');
      sessionStorage.clear();
    } catch (error) {
      console.warn('Failed to clear data:', error);
    }
    
    this.track('consent_revoked');
    this.privacyLevel = 'basic';
    this.initializeBasicTracking();
  }

  getConsentText() {
    const texts = {
      enhanced: {
        title: "Enhanced Recommendations",
        description: "Allow CartUplift to remember your preferences to show better product recommendations?",
        details: [
          "• Track products you view and time spent browsing",
          "• Remember your cart history across sessions", 
          "• Personalize recommendations based on your interests",
          "• Data is only used to improve your shopping experience",
          "• You can opt out anytime in settings"
        ],
        dataNote: "Your data stays secure and is never shared with third parties."
      },
      full_ml: {
        title: "AI-Powered Personalization", 
        description: "Enable full AI personalization for the most relevant product recommendations?",
        details: [
          "• Advanced behavior analysis (scroll patterns, click timing)",
          "• Predictive recommendations based on similar customers",
          "• Real-time learning from your shopping patterns",
          "• Seasonal and trend-based recommendations",
          "• Cross-device shopping history sync"
        ],
        dataNote: "All data is processed securely and anonymized. We never store personal information without encryption."
      }
    };
    
    return texts[this.privacyLevel] || texts.enhanced;
  }

  async showConsentDialog(consentText) {
    return new Promise((resolve) => {
      // Create consent dialog
      const dialog = document.createElement('div');
      dialog.className = 'cu-consent-dialog';
      dialog.innerHTML = `
        <div class="cu-consent-overlay">
          <div class="cu-consent-modal">
            <div class="cu-consent-header">
              <h3>${consentText.title}</h3>
              <button class="cu-consent-close">&times;</button>
            </div>
            <div class="cu-consent-content">
              <p>${consentText.description}</p>
              <ul class="cu-consent-features">
                ${consentText.details.map(detail => `<li>${detail}</li>`).join('')}
              </ul>
              <p class="cu-consent-note">${consentText.dataNote}</p>
            </div>
            <div class="cu-consent-actions">
              <button class="cu-consent-decline">No Thanks</button>
              <button class="cu-consent-accept">Enable ${consentText.title}</button>
            </div>
          </div>
        </div>
      `;
      
      // Add styles
      const style = document.createElement('style');
      style.textContent = `
        .cu-consent-dialog { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 10000; }
        .cu-consent-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
        .cu-consent-modal { background: white; border-radius: 12px; max-width: 500px; margin: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
        .cu-consent-header { padding: 20px 20px 0; display: flex; justify-content: space-between; align-items: center; }
        .cu-consent-header h3 { margin: 0; color: #333; font-size: 18px; }
        .cu-consent-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #999; }
        .cu-consent-content { padding: 20px; }
        .cu-consent-content p { margin: 0 0 15px; color: #666; line-height: 1.5; }
        .cu-consent-features { margin: 15px 0; padding-left: 20px; }
        .cu-consent-features li { margin: 5px 0; color: #555; }
        .cu-consent-note { font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px; }
        .cu-consent-actions { padding: 0 20px 20px; display: flex; gap: 10px; justify-content: flex-end; }
        .cu-consent-actions button { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
        .cu-consent-decline { background: #f5f5f5; color: #666; }
        .cu-consent-accept { background: #007cba; color: white; }
        .cu-consent-decline:hover { background: #e5e5e5; }
        .cu-consent-accept:hover { background: #005a87; }
      `;
      
      document.head.appendChild(style);
      document.body.appendChild(dialog);
      
      // Event handlers
      const handleResponse = (accepted) => {
        document.body.removeChild(dialog);
        document.head.removeChild(style);
        resolve(accepted);
      };
      
      dialog.querySelector('.cu-consent-accept').onclick = () => handleResponse(true);
      dialog.querySelector('.cu-consent-decline').onclick = () => handleResponse(false);
      dialog.querySelector('.cu-consent-close').onclick = () => handleResponse(false);
      dialog.querySelector('.cu-consent-overlay').onclick = (e) => {
        if (e.target === e.currentTarget) handleResponse(false);
      };
    });
  }

  initializeBasicTracking() {
    // Only anonymous, aggregated tracking
    this.trackBasicEvents();
  }

  initializeAdvancedTracking() {
    if (!this.consentGiven) return;
    
    // Generate or retrieve user ID
    this.userId = this.getOrCreateUserId();
    
    // Track detailed behavior
    this.trackDetailedBehavior();
    this.trackProductViews();
    this.trackScrollBehavior();
    this.trackClickPatterns();
    
    if (this.privacyLevel === 'full_ml') {
      this.trackAdvancedBehavior();
    }
  }

  trackBasicEvents() {
    // Anonymous cart events only
    document.addEventListener('cartuplift:cart_updated', () => {
      this.track('cart_updated', {}, false); // false = no personal data
    });
    
    document.addEventListener('cartuplift:checkout_started', () => {
      this.track('checkout_started', {}, false);
    });
  }

  trackDetailedBehavior() {
    // Product view tracking
    this.observeProductViews();
    
    // Cart interaction tracking
    document.addEventListener('cartuplift:item_added', (e) => {
      this.track('item_added', {
        product_id: e.detail.product_id,
        variant_id: e.detail.variant_id,
        quantity: e.detail.quantity
      });
    });
    
    // Recommendation interactions
    document.addEventListener('click', (e) => {
      if (e.target.closest('.cartuplift-add-recommendation')) {
        const productId = e.target.dataset.productId;
        const position = e.target.dataset.position;
        
        this.track('recommendation_clicked', {
          product_id: productId,
          position: parseInt(position),
          strategy: e.target.dataset.strategy
        });
      }
    });
  }

  trackAdvancedBehavior() {
    // Advanced ML tracking
    this.trackMouseMovement();
    this.trackKeyboardInteraction();
    this.trackSessionFlow();
    this.trackTemporalPatterns();
  }

  observeProductViews() {
    // Intersection Observer for product view tracking
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const productElement = entry.target;
          const productId = productElement.dataset.productId;
          
          if (productId) {
            this.startViewTimer(productId, productElement);
          }
        }
      });
    }, { threshold: 0.5 });

    // Observe product elements
    document.querySelectorAll('[data-product-id]').forEach(el => {
      observer.observe(el);
    });
  }

  startViewTimer(productId, element) {
    const startTime = Date.now();
    const viewData = { productId, startTime, element };
    
    // Track when user stops viewing
    const stopTracking = () => {
      const viewDuration = Date.now() - startTime;
      
      if (viewDuration > 1000) { // Only track views > 1 second
        this.track('product_viewed', {
          product_id: productId,
          view_duration: viewDuration,
          scroll_depth: this.getScrollDepth(element),
          viewport_percentage: this.getViewportPercentage(element)
        });
      }
    };
    
    // Stop tracking on scroll away or page unload
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          stopTracking();
          observer.disconnect();
        }
      });
    });
    
    observer.observe(element);
    
    // Also stop on page unload
    window.addEventListener('beforeunload', stopTracking, { once: true });
  }

  track(event, properties = {}, includePersonalData = true) {
    const eventData = {
      event,
      timestamp: Date.now(),
      session_id: this.sessionId,
      properties: {
        ...properties,
        privacy_level: this.privacyLevel,
        consent_given: this.consentGiven
      }
    };

    // Add user context based on privacy level
    if (includePersonalData && this.consentGiven) {
      eventData.user_id = this.userId;
      eventData.properties.url = window.location.href;
      eventData.properties.referrer = document.referrer;
      eventData.properties.viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };
    }

    this.events.push(eventData);
    
    // Immediate flush for critical events
    if (['checkout_started', 'purchase_completed', 'consent_revoked'].includes(event)) {
      this.flush();
    }
  }

  async flush() {
    if (this.events.length === 0) return;
    
    const eventsToSend = [...this.events];
    this.events = [];
    
    try {
      // Send to your App Proxy for ML processing
      await fetch('/apps/cart-uplift/api/ml/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: eventsToSend,
          privacy_level: this.privacyLevel,
          consent_timestamp: this.consentGiven ? Date.now() : null
        })
      });
    } catch (error) {
      // Re-add events on failure (with limit)
      if (this.events.length < 100) {
        this.events.unshift(...eventsToSend);
      }
      console.warn('Failed to send tracking events:', error);
    }
  }

  startFlushTimer() {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, 10000); // Flush every 10 seconds
  }

  // Utility methods
  generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getOrCreateUserId() {
    let userId = localStorage.getItem('cu_user_id');
    
    if (!userId) {
      // Try to get Shopify customer ID
      userId = window.ShopifyAnalytics?.meta?.page?.customerId;
      
      if (!userId) {
        // Generate anonymous but persistent ID
        userId = 'user_' + this.generateSessionId();
      }
      
      localStorage.setItem('cu_user_id', userId);
    }
    
    return userId;
  }

  getScrollDepth(element) {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const elementHeight = rect.height;
    
    const visibleHeight = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
    return Math.max(0, visibleHeight / elementHeight);
  }

  getViewportPercentage(element) {
    const rect = element.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const elementArea = rect.width * rect.height;
    const visibleArea = Math.max(0, 
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
    ) * Math.max(0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    );
    
    return visibleArea / viewportArea;
  }

  // Cleanup
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flush(); // Final flush
  }
}
