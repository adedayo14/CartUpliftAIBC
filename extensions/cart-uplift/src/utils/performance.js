/**
 * Performance monitoring with Core Web Vitals and custom metrics
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.observers = [];
    this.isReporting = false;
    this.init();
  }

  init() {
    // Only init if performance APIs are available
    if (typeof performance === 'undefined') return;

    this.initCoreWebVitals();
    this.initCustomMetrics();
    
    // Report metrics on page unload
    addEventListener('beforeunload', () => {
      this.report('page_unload');
    });

    // Report metrics periodically
    setInterval(() => {
      this.report('periodic');
    }, 30000); // Every 30 seconds
  }

  initCoreWebVitals() {
    if (!('PerformanceObserver' in window)) return;

    try {
      // Largest Contentful Paint (LCP)
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.metrics.set('lcp', {
          value: lastEntry.renderTime || lastEntry.loadTime,
          timestamp: Date.now(),
          rating: this.rateLCP(lastEntry.renderTime || lastEntry.loadTime)
        });
      });
      lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
      this.observers.push(lcpObserver);

      // First Input Delay (FID)
      const fidObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach(entry => {
          const fidValue = entry.processingStart - entry.startTime;
          this.metrics.set('fid', {
            value: fidValue,
            timestamp: Date.now(),
            rating: this.rateFID(fidValue)
          });
        });
      });
      fidObserver.observe({ entryTypes: ['first-input'] });
      this.observers.push(fidObserver);

      // Cumulative Layout Shift (CLS)
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
            this.metrics.set('cls', {
              value: clsValue,
              timestamp: Date.now(),
              rating: this.rateCLS(clsValue)
            });
          }
        }
      });
      clsObserver.observe({ entryTypes: ['layout-shift'] });
      this.observers.push(clsObserver);

    } catch (error) {
      console.warn('Failed to initialize Core Web Vitals:', error);
    }
  }

  initCustomMetrics() {
    // Navigation timing
    if (performance.navigation && performance.timing) {
      const timing = performance.timing;
      this.metrics.set('page_load_time', {
        value: timing.loadEventEnd - timing.navigationStart,
        timestamp: Date.now()
      });
      this.metrics.set('dom_ready_time', {
        value: timing.domContentLoadedEventEnd - timing.navigationStart,
        timestamp: Date.now()
      });
    }

    // Resource timing for critical assets
    if (performance.getEntriesByType) {
      const resources = performance.getEntriesByType('resource');
      const cartAssets = resources.filter(r => 
        r.name.includes('cart-uplift') || r.name.includes('cartuplift')
      );
      
      if (cartAssets.length > 0) {
        const totalSize = cartAssets.reduce((sum, asset) => sum + (asset.transferSize || 0), 0);
        const totalTime = cartAssets.reduce((sum, asset) => sum + asset.duration, 0);
        
        this.metrics.set('asset_load_time', {
          value: totalTime,
          timestamp: Date.now()
        });
        this.metrics.set('asset_size', {
          value: totalSize,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Measure execution time of a function
   */
  measure(name, fn) {
    const start = performance.now();
    
    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result.finally(() => {
          this.recordMetric(name, performance.now() - start);
        });
      } else {
        this.recordMetric(name, performance.now() - start);
        return result;
      }
    } catch (error) {
      this.recordMetric(name, performance.now() - start, { error: error.message });
      throw error;
    }
  }

  /**
   * Record a custom metric
   */
  recordMetric(name, value, metadata = {}) {
    this.metrics.set(name, {
      value,
      timestamp: Date.now(),
      ...metadata
    });
  }

  /**
   * Start timing an operation
   */
  startTimer(name) {
    this.metrics.set(`${name}_start`, {
      value: performance.now(),
      timestamp: Date.now()
    });
  }

  /**
   * End timing an operation
   */
  endTimer(name) {
    const startMetric = this.metrics.get(`${name}_start`);
    if (startMetric) {
      const duration = performance.now() - startMetric.value;
      this.recordMetric(name, duration);
      this.metrics.delete(`${name}_start`);
      return duration;
    }
    return null;
  }

  /**
   * Rating functions for Core Web Vitals
   */
  rateLCP(value) {
    if (value <= 2500) return 'good';
    if (value <= 4000) return 'needs-improvement';
    return 'poor';
  }

  rateFID(value) {
    if (value <= 100) return 'good';
    if (value <= 300) return 'needs-improvement';
    return 'poor';
  }

  rateCLS(value) {
    if (value <= 0.1) return 'good';
    if (value <= 0.25) return 'needs-improvement';
    return 'poor';
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics() {
    const snapshot = {};
    this.metrics.forEach((value, key) => {
      snapshot[key] = value;
    });
    return snapshot;
  }

  /**
   * Report metrics to analytics endpoint
   */
  async report(trigger = 'manual') {
    if (this.isReporting || this.metrics.size === 0) return;

    this.isReporting = true;
    
    try {
      const metrics = this.getMetrics();
      const payload = {
        metrics,
        trigger,
        timestamp: Date.now(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      };

      // Send to multiple endpoints for reliability
      const promises = [
        // Send to App Proxy
        fetch('/apps/cart-uplift/api/performance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => null),
        
        // Send to analytics (if available)
        this.sendToAnalytics(payload).catch(() => null)
      ];

      await Promise.allSettled(promises);
      
      // Clear reported metrics (keep Core Web Vitals)
      const keysToKeep = ['lcp', 'fid', 'cls'];
      const newMetrics = new Map();
      keysToKeep.forEach(key => {
        if (this.metrics.has(key)) {
          newMetrics.set(key, this.metrics.get(key));
        }
      });
      this.metrics = newMetrics;

    } catch (error) {
      console.warn('Performance reporting failed:', error);
    } finally {
      this.isReporting = false;
    }
  }

  async sendToAnalytics(payload) {
    // Send to Google Analytics 4 if available
    if (typeof window.gtag !== 'undefined') {
      Object.entries(payload.metrics).forEach(([name, metric]) => {
        window.gtag('event', 'performance_metric', {
          metric_name: name,
          metric_value: metric.value,
          metric_rating: metric.rating || 'unknown'
        });
      });
    }

    // Send to other analytics platforms as needed
    if (window.analytics && typeof window.analytics.track === 'function') {
      window.analytics.track('Performance Metrics', payload);
    }
  }

  /**
   * Get performance score (0-100)
   */
  getPerformanceScore() {
    const lcp = this.metrics.get('lcp');
    const fid = this.metrics.get('fid');
    const cls = this.metrics.get('cls');

    if (!lcp || !fid || !cls) return null;

    // Simple scoring based on Core Web Vitals
    let score = 100;
    
    if (lcp.rating === 'poor') score -= 30;
    else if (lcp.rating === 'needs-improvement') score -= 15;
    
    if (fid.rating === 'poor') score -= 30;
    else if (fid.rating === 'needs-improvement') score -= 15;
    
    if (cls.rating === 'poor') score -= 40;
    else if (cls.rating === 'needs-improvement') score -= 20;

    return Math.max(0, score);
  }

  /**
   * Cleanup observers
   */
  destroy() {
    this.observers.forEach(observer => {
      try {
        observer.disconnect();
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    this.observers = [];
    this.metrics.clear();
  }
}
