/**
 * Intelligent caching system with memory, session, and persistent tiers
 */
export class TieredCache {
  constructor(options = {}) {
    this.maxMemoryItems = options.maxMemoryItems || 100;
    this.memoryTTL = options.memoryTTL || 3600000; // 1 hour
    this.sessionTTL = options.sessionTTL || 3600000; // 1 hour  
    this.persistentTTL = options.persistentTTL || 86400000; // 24 hours
    
    this.memory = new Map();
    this.memoryTimestamps = new Map();
  }

  /**
   * Get value from cache with fallback through tiers
   */
  async get(key, options = {}) {
    const now = Date.now();

    // L1: Memory cache (fastest)
    if (this.memory.has(key)) {
      const timestamp = this.memoryTimestamps.get(key);
      if (now - timestamp < this.memoryTTL) {
        return this.memory.get(key);
      } else {
        // Expired, clean up
        this.memory.delete(key);
        this.memoryTimestamps.delete(key);
      }
    }

    // L2: Session storage
    try {
      const sessionData = sessionStorage.getItem(`cu_${key}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (now - parsed.timestamp < this.sessionTTL) {
          // Promote to memory cache
          this.setMemory(key, parsed.data);
          return parsed.data;
        } else {
          sessionStorage.removeItem(`cu_${key}`);
        }
      }
    } catch (e) {
      // sessionStorage might be disabled
    }

    // L3: Persistent storage (localStorage)
    if (options.allowStale) {
      try {
        const persistentData = localStorage.getItem(`cu_${key}`);
        if (persistentData) {
          const parsed = JSON.parse(persistentData);
          if (now - parsed.timestamp < this.persistentTTL) {
            // Promote to higher tiers
            this.setMemory(key, parsed.data);
            this.setSession(key, parsed.data);
            return parsed.data;
          } else {
            localStorage.removeItem(`cu_${key}`);
          }
        }
      } catch (e) {
        // localStorage might be full or disabled
      }
    }

    return null;
  }

  /**
   * Set value in cache with optional tier specification
   */
  set(key, value, tier = 'all') {
    if (tier === 'all' || tier === 'memory') {
      this.setMemory(key, value);
    }

    if (tier === 'all' || tier === 'session') {
      this.setSession(key, value);
    }

    if (tier === 'all' || tier === 'persistent') {
      this.setPersistent(key, value);
    }
  }

  setMemory(key, value) {
    // Evict oldest if over limit
    if (this.memory.size >= this.maxMemoryItems) {
      const oldestKey = this.memory.keys().next().value;
      this.memory.delete(oldestKey);
      this.memoryTimestamps.delete(oldestKey);
    }

    this.memory.set(key, value);
    this.memoryTimestamps.set(key, Date.now());
  }

  setSession(key, value) {
    try {
      const wrapped = {
        data: value,
        timestamp: Date.now()
      };
      sessionStorage.setItem(`cu_${key}`, JSON.stringify(wrapped));
    } catch (e) {
      // Handle quota exceeded or disabled
      console.warn('Session storage failed:', e.message);
    }
  }

  setPersistent(key, value) {
    try {
      const wrapped = {
        data: value,
        timestamp: Date.now()
      };
      localStorage.setItem(`cu_${key}`, JSON.stringify(wrapped));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        this.clearOldestPersistent();
        // Try again after clearing
        try {
          const wrapped = {
            data: value,
            timestamp: Date.now()
          };
          localStorage.setItem(`cu_${key}`, JSON.stringify(wrapped));
        } catch (e2) {
          console.warn('Persistent storage failed after cleanup:', e2.message);
        }
      }
    }
  }

  /**
   * Clear oldest persistent cache entries when quota exceeded
   */
  clearOldestPersistent() {
    const items = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cu_')) {
        try {
          const item = JSON.parse(localStorage.getItem(key));
          items.push({ key, timestamp: item.timestamp });
        } catch (e) {
          // Invalid JSON, remove it
          localStorage.removeItem(key);
        }
      }
    }

    // Sort by timestamp and remove oldest 25%
    items.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = Math.floor(items.length * 0.25);
    
    for (let i = 0; i < toRemove; i++) {
      localStorage.removeItem(items[i].key);
    }
  }

  /**
   * Check if key exists in any tier
   */
  has(key) {
    const now = Date.now();
    
    // Check memory
    if (this.memory.has(key)) {
      const timestamp = this.memoryTimestamps.get(key);
      if (now - timestamp < this.memoryTTL) {
        return true;
      }
    }

    // Check session
    try {
      const sessionData = sessionStorage.getItem(`cu_${key}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData);
        if (now - parsed.timestamp < this.sessionTTL) {
          return true;
        }
      }
    } catch (e) {
      // Ignore
    }

    // Check persistent
    try {
      const persistentData = localStorage.getItem(`cu_${key}`);
      if (persistentData) {
        const parsed = JSON.parse(persistentData);
        if (now - parsed.timestamp < this.persistentTTL) {
          return true;
        }
      }
    } catch (e) {
      // Ignore
    }

    return false;
  }

  /**
   * Delete from all tiers
   */
  delete(key) {
    this.memory.delete(key);
    this.memoryTimestamps.delete(key);
    
    try {
      sessionStorage.removeItem(`cu_${key}`);
    } catch (e) {
      // Ignore
    }
    
    try {
      localStorage.removeItem(`cu_${key}`);
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Clear all cache tiers
   */
  clear() {
    this.memory.clear();
    this.memoryTimestamps.clear();
    
    // Clear session storage
    try {
      const keysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('cu_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    } catch (e) {
      // Ignore
    }

    // Clear persistent storage
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('cu_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      memorySize: this.memory.size,
      memoryLimit: this.maxMemoryItems,
      sessionKeys: this.getStorageKeyCount(sessionStorage),
      persistentKeys: this.getStorageKeyCount(localStorage)
    };
  }

  getStorageKeyCount(storage) {
    let count = 0;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith('cu_')) {
          count++;
        }
      }
    } catch (e) {
      // Storage might be disabled
    }
    return count;
  }
}
