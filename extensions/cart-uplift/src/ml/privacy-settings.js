/**
 * Privacy Settings Manager for ML Features
 * Handles user consent and privacy preferences for ML-powered recommendations
 */
export class PrivacySettingsManager {
  constructor() {
    this.settings = null;
    this.consentLevels = {
      BASIC: 'basic',
      ENHANCED: 'enhanced', 
      FULL_ML: 'full_ml'
    };
    
    this.init();
  }

  init() {
    this.loadSettings();
    this.setupEventListeners();
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem('cu_privacy_settings');
      if (stored) {
        this.settings = JSON.parse(stored);
        
        // Validate settings structure
        if (!this.isValidSettings(this.settings)) {
          this.settings = this.getDefaultSettings();
        }
      } else {
        this.settings = this.getDefaultSettings();
      }
    } catch (error) {
      console.warn('Failed to load privacy settings:', error);
      this.settings = this.getDefaultSettings();
    }
  }

  getDefaultSettings() {
    return {
      consent_level: this.consentLevels.BASIC,
      consent_timestamp: null,
      features: {
        personalized_recommendations: false,
        behavior_tracking: false,
        cross_session_data: false,
        predictive_analytics: false,
        collaborative_filtering: false,
        advanced_profiling: false
      },
      data_retention: {
        session_data: 1, // days
        behavior_data: 0, // days (0 = no retention)
        profile_data: 0 // days
      },
      version: '1.0',
      last_updated: Date.now()
    };
  }

  isValidSettings(settings) {
    return settings && 
           settings.consent_level && 
           settings.features && 
           settings.data_retention &&
           settings.version;
  }

  setupEventListeners() {
    // Listen for privacy setting changes from admin
    document.addEventListener('cartuplift:privacy_updated', (e) => {
      this.handleAdminPrivacyUpdate(e.detail);
    });

    // Listen for GDPR compliance requests
    document.addEventListener('cartuplift:gdpr_request', (e) => {
      this.handleGDPRRequest(e.detail);
    });
  }

  /**
   * Show privacy settings dialog to user
   */
  async showPrivacySettings() {
    return new Promise((resolve) => {
      const dialog = this.createPrivacyDialog();
      document.body.appendChild(dialog);
      
      // Handle dialog interactions
      this.setupDialogHandlers(dialog, resolve);
    });
  }

  createPrivacyDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'cu-privacy-settings-dialog';
    dialog.innerHTML = `
      <div class="cu-privacy-overlay">
        <div class="cu-privacy-modal">
          <div class="cu-privacy-header">
            <h2>Personalization Settings</h2>
            <button class="cu-privacy-close">&times;</button>
          </div>
          
          <div class="cu-privacy-content">
            <p class="cu-privacy-intro">Choose how CartUplift can personalize your shopping experience:</p>
            
            <div class="cu-privacy-options">
              ${this.renderConsentOptions()}
            </div>
            
            <div class="cu-privacy-details">
              <h3>What does each level include?</h3>
              ${this.renderFeatureDetails()}
            </div>
            
            <div class="cu-privacy-controls">
              <h3>Data Controls</h3>
              ${this.renderDataControls()}
            </div>
            
            <div class="cu-privacy-notice">
              <p><strong>Your Privacy Matters:</strong> We only use your data to improve your shopping experience. You can change these settings anytime, and all data is securely encrypted and never shared with third parties.</p>
            </div>
          </div>
          
          <div class="cu-privacy-actions">
            <button class="cu-privacy-cancel">Cancel</button>
            <button class="cu-privacy-save">Save Settings</button>
          </div>
        </div>
      </div>
    `;
    
    this.addPrivacyStyles(dialog);
    return dialog;
  }

  renderConsentOptions() {
    const current = this.settings.consent_level;
    
    return `
      <div class="cu-consent-option ${current === 'basic' ? 'selected' : ''}" data-level="basic">
        <div class="cu-option-header">
          <input type="radio" name="consent_level" value="basic" ${current === 'basic' ? 'checked' : ''}>
          <label>Basic (Anonymous)</label>
          <span class="cu-privacy-badge">Most Private</span>
        </div>
        <div class="cu-option-description">
          <p>General product recommendations based on popularity and categories only.</p>
          <ul>
            <li>No personal data collection</li>
            <li>Anonymous shopping patterns only</li>
            <li>Basic product suggestions</li>
          </ul>
        </div>
      </div>
      
      <div class="cu-consent-option ${current === 'enhanced' ? 'selected' : ''}" data-level="enhanced">
        <div class="cu-option-header">
          <input type="radio" name="consent_level" value="enhanced" ${current === 'enhanced' ? 'checked' : ''}>
          <label>Enhanced Personalization</label>
          <span class="cu-privacy-badge">Balanced</span>
        </div>
        <div class="cu-option-description">
          <p>Personalized recommendations based on your shopping preferences.</p>
          <ul>
            <li>Remember products you view and purchase</li>
            <li>Track cart history across sessions</li>
            <li>Personalized product suggestions</li>
            <li>Basic behavior analysis</li>
          </ul>
        </div>
      </div>
      
      <div class="cu-consent-option ${current === 'full_ml' ? 'selected' : ''}" data-level="full_ml">
        <div class="cu-option-header">
          <input type="radio" name="consent_level" value="full_ml" ${current === 'full_ml' ? 'checked' : ''}>
          <label>AI-Powered Recommendations</label>
          <span class="cu-privacy-badge">Most Personalized</span>
        </div>
        <div class="cu-option-description">
          <p>Advanced AI learns your unique preferences for highly personalized recommendations.</p>
          <ul>
            <li>Advanced behavior pattern analysis</li>
            <li>Predictive recommendations</li>
            <li>Cross-customer similarity analysis</li>
            <li>Seasonal preference learning</li>
          </ul>
        </div>
      </div>
    `;
  }

  renderFeatureDetails() {
    return `
      <div class="cu-feature-grid">
        <div class="cu-feature-item">
          <strong>Personalized Recommendations</strong>
          <p>Show products tailored to your interests</p>
          <span class="cu-feature-levels">Enhanced, AI-Powered</span>
        </div>
        
        <div class="cu-feature-item">
          <strong>Behavior Analysis</strong>
          <p>Learn from how you browse and shop</p>
          <span class="cu-feature-levels">Enhanced, AI-Powered</span>
        </div>
        
        <div class="cu-feature-item">
          <strong>Cross-Session Learning</strong>
          <p>Remember preferences between visits</p>
          <span class="cu-feature-levels">Enhanced, AI-Powered</span>
        </div>
        
        <div class="cu-feature-item">
          <strong>Predictive Suggestions</strong>
          <p>Anticipate what you might like next</p>
          <span class="cu-feature-levels">AI-Powered only</span>
        </div>
        
        <div class="cu-feature-item">
          <strong>Similarity Analysis</strong>
          <p>Learn from customers with similar tastes</p>
          <span class="cu-feature-levels">AI-Powered only</span>
        </div>
      </div>
    `;
  }

  renderDataControls() {
    const retention = this.settings.data_retention;
    
    return `
      <div class="cu-data-controls">
        <div class="cu-control-group">
          <label>Data Retention Period:</label>
          <select class="cu-retention-select" data-type="behavior_data">
            <option value="0" ${retention.behavior_data === 0 ? 'selected' : ''}>Don't store behavior data</option>
            <option value="7" ${retention.behavior_data === 7 ? 'selected' : ''}>7 days</option>
            <option value="30" ${retention.behavior_data === 30 ? 'selected' : ''}>30 days</option>
            <option value="90" ${retention.behavior_data === 90 ? 'selected' : ''}>90 days</option>
            <option value="365" ${retention.behavior_data === 365 ? 'selected' : ''}>1 year</option>
          </select>
        </div>
        
        <div class="cu-control-group">
          <label>
            <input type="checkbox" ${this.settings.features.cross_session_data ? 'checked' : ''} data-feature="cross_session_data">
            Remember preferences across devices
          </label>
        </div>
        
        <div class="cu-control-group">
          <label>
            <input type="checkbox" ${this.settings.features.collaborative_filtering ? 'checked' : ''} data-feature="collaborative_filtering">
            Learn from similar customers (anonymous)
          </label>
        </div>
        
        <div class="cu-data-actions">
          <button class="cu-export-data">Export My Data</button>
          <button class="cu-delete-data">Delete All Data</button>
        </div>
      </div>
    `;
  }

  addPrivacyStyles(dialog) {
    const style = document.createElement('style');
    style.textContent = `
      .cu-privacy-settings-dialog { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 10000; }
      .cu-privacy-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; padding: 20px; }
      .cu-privacy-modal { background: white; border-radius: 12px; max-width: 700px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
      .cu-privacy-header { padding: 20px 20px 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; }
      .cu-privacy-header h2 { margin: 0; color: #333; font-size: 24px; }
      .cu-privacy-close { background: none; border: none; font-size: 28px; cursor: pointer; color: #999; padding: 0; }
      .cu-privacy-content { padding: 20px; }
      .cu-privacy-intro { margin: 0 0 20px; color: #666; font-size: 16px; }
      
      .cu-consent-option { border: 2px solid #e0e0e0; border-radius: 8px; margin: 15px 0; padding: 15px; cursor: pointer; transition: all 0.3s; }
      .cu-consent-option:hover { border-color: #007cba; }
      .cu-consent-option.selected { border-color: #007cba; background: #f8fcff; }
      .cu-option-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .cu-option-header input[type="radio"] { margin: 0; }
      .cu-option-header label { font-weight: 600; color: #333; font-size: 16px; cursor: pointer; }
      .cu-privacy-badge { background: #007cba; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; }
      .cu-option-description p { margin: 5px 0; color: #666; }
      .cu-option-description ul { margin: 10px 0 0 20px; color: #555; }
      .cu-option-description li { margin: 3px 0; }
      
      .cu-privacy-details { margin: 30px 0; padding: 20px; background: #f9f9f9; border-radius: 8px; }
      .cu-privacy-details h3 { margin: 0 0 15px; color: #333; }
      .cu-feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
      .cu-feature-item { padding: 10px; background: white; border-radius: 6px; border: 1px solid #e0e0e0; }
      .cu-feature-item strong { display: block; color: #333; margin-bottom: 5px; }
      .cu-feature-item p { margin: 0 0 5px; color: #666; font-size: 14px; }
      .cu-feature-levels { font-size: 12px; color: #007cba; font-weight: 500; }
      
      .cu-privacy-controls { margin: 30px 0; }
      .cu-privacy-controls h3 { margin: 0 0 15px; color: #333; }
      .cu-data-controls { }
      .cu-control-group { margin: 15px 0; }
      .cu-control-group label { display: flex; align-items: center; gap: 8px; color: #333; }
      .cu-retention-select { padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; }
      .cu-data-actions { margin: 20px 0 0; display: flex; gap: 10px; }
      .cu-export-data, .cu-delete-data { padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 14px; }
      .cu-export-data:hover { background: #f5f5f5; }
      .cu-delete-data { color: #dc3545; border-color: #dc3545; }
      .cu-delete-data:hover { background: #dc3545; color: white; }
      
      .cu-privacy-notice { margin: 20px 0 0; padding: 15px; background: #e8f4f8; border-radius: 6px; border-left: 4px solid #007cba; }
      .cu-privacy-notice p { margin: 0; color: #333; font-size: 14px; }
      
      .cu-privacy-actions { padding: 20px; border-top: 1px solid #eee; display: flex; gap: 10px; justify-content: flex-end; }
      .cu-privacy-cancel, .cu-privacy-save { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; }
      .cu-privacy-cancel { background: #f5f5f5; color: #666; }
      .cu-privacy-save { background: #007cba; color: white; }
      .cu-privacy-cancel:hover { background: #e5e5e5; }
      .cu-privacy-save:hover { background: #005a87; }
    `;
    
    dialog.appendChild(style);
  }

  setupDialogHandlers(dialog, resolve) {
    // Consent level selection
    dialog.querySelectorAll('.cu-consent-option').forEach(option => {
      option.onclick = () => {
        dialog.querySelectorAll('.cu-consent-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        option.querySelector('input[type="radio"]').checked = true;
      };
    });

    // Data export
    dialog.querySelector('.cu-export-data').onclick = () => {
      this.exportUserData();
    };

    // Data deletion
    dialog.querySelector('.cu-delete-data').onclick = () => {
      this.deleteUserData();
    };

    // Save settings
    dialog.querySelector('.cu-privacy-save').onclick = () => {
      const formData = new FormData(dialog.querySelector('.cu-privacy-modal'));
      const newSettings = this.collectSettingsFromDialog(dialog);
      
      this.updateSettings(newSettings);
      document.body.removeChild(dialog);
      resolve(newSettings);
    };

    // Cancel
    const closeDialog = () => {
      document.body.removeChild(dialog);
      resolve(null);
    };

    dialog.querySelector('.cu-privacy-cancel').onclick = closeDialog;
    dialog.querySelector('.cu-privacy-close').onclick = closeDialog;
    
    dialog.querySelector('.cu-privacy-overlay').onclick = (e) => {
      if (e.target === e.currentTarget) closeDialog();
    };
  }

  collectSettingsFromDialog(dialog) {
    const consentLevel = dialog.querySelector('input[name="consent_level"]:checked').value;
    const behaviorRetention = parseInt(dialog.querySelector('.cu-retention-select').value);
    
    const features = {
      personalized_recommendations: consentLevel !== 'basic',
      behavior_tracking: consentLevel !== 'basic',
      cross_session_data: dialog.querySelector('[data-feature="cross_session_data"]').checked,
      predictive_analytics: consentLevel === 'full_ml',
      collaborative_filtering: dialog.querySelector('[data-feature="collaborative_filtering"]').checked && consentLevel === 'full_ml',
      advanced_profiling: consentLevel === 'full_ml'
    };

    return {
      consent_level: consentLevel,
      consent_timestamp: Date.now(),
      features,
      data_retention: {
        ...this.settings.data_retention,
        behavior_data: behaviorRetention
      },
      version: '1.0',
      last_updated: Date.now()
    };
  }

  updateSettings(newSettings) {
    const oldLevel = this.settings.consent_level;
    const newLevel = newSettings.consent_level;
    
    this.settings = newSettings;
    this.saveSettings();
    
    // Handle consent level changes
    if (oldLevel !== newLevel) {
      this.handleConsentLevelChange(oldLevel, newLevel);
    }

    // Notify other components
    document.dispatchEvent(new CustomEvent('cartuplift:privacy_settings_updated', {
      detail: { 
        settings: this.settings,
        previousLevel: oldLevel,
        newLevel: newLevel
      }
    }));
  }

  saveSettings() {
    try {
      localStorage.setItem('cu_privacy_settings', JSON.stringify(this.settings));
    } catch (error) {
      console.warn('Failed to save privacy settings:', error);
    }
  }

  handleConsentLevelChange(oldLevel, newLevel) {
    // If downgrading, clean up data
    if (this.isDowngrade(oldLevel, newLevel)) {
      this.cleanupDataForDowngrade(newLevel);
    }

    // Send analytics about consent change
    this.trackConsentChange(oldLevel, newLevel);
  }

  isDowngrade(oldLevel, newLevel) {
    const levels = ['basic', 'enhanced', 'full_ml'];
    return levels.indexOf(newLevel) < levels.indexOf(oldLevel);
  }

  cleanupDataForDowngrade(newLevel) {
    switch (newLevel) {
      case 'basic':
        // Remove all personal data
        localStorage.removeItem('cu_user_profile');
        localStorage.removeItem('cu_behavior_history');
        localStorage.removeItem('cu_ml_features');
        break;
      case 'enhanced':
        // Remove advanced ML data only
        localStorage.removeItem('cu_ml_features');
        localStorage.removeItem('cu_user_embeddings');
        break;
    }
  }

  async exportUserData() {
    try {
      const response = await fetch('/apps/cart-uplift/api/ml/export-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privacy_level: this.settings.consent_level
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `cartuplift-data-${Date.now()}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.warn('Failed to export data:', error);
      alert('Failed to export data. Please try again later.');
    }
  }

  async deleteUserData() {
    if (!confirm('Are you sure you want to delete all your data? This cannot be undone.')) {
      return;
    }

    try {
      // Clear local storage
      localStorage.removeItem('cu_user_profile');
      localStorage.removeItem('cu_behavior_history');
      localStorage.removeItem('cu_ml_features');
      localStorage.removeItem('cu_user_id');
      localStorage.removeItem('cu_ml_consent');

      // Request server-side deletion
      await fetch('/apps/cart-uplift/api/ml/delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privacy_level: this.settings.consent_level
        })
      });

      // Reset to basic settings
      this.settings = this.getDefaultSettings();
      this.saveSettings();

      alert('All your data has been deleted.');
      
    } catch (error) {
      console.warn('Failed to delete data:', error);
      alert('Failed to delete data. Please contact support.');
    }
  }

  trackConsentChange(oldLevel, newLevel) {
    document.dispatchEvent(new CustomEvent('cartuplift:track_event', {
      detail: {
        event: 'privacy_consent_changed',
        properties: {
          old_level: oldLevel,
          new_level: newLevel,
          timestamp: Date.now()
        }
      }
    }));
  }

  handleAdminPrivacyUpdate(adminSettings) {
    // Handle privacy settings updates from store admin
    if (adminSettings.force_basic_mode) {
      this.settings.consent_level = 'basic';
      this.cleanupDataForDowngrade('basic');
      this.saveSettings();
    }
  }

  handleGDPRRequest(request) {
    // Handle GDPR data requests
    switch (request.type) {
      case 'access':
        this.exportUserData();
        break;
      case 'delete':
        this.deleteUserData();
        break;
      case 'rectify':
        this.showPrivacySettings();
        break;
    }
  }

  /**
   * Public API methods
   */
  getConsentLevel() {
    return this.settings.consent_level;
  }

  hasFeature(featureName) {
    return this.settings.features[featureName] === true;
  }

  getDataRetention(dataType) {
    return this.settings.data_retention[dataType] || 0;
  }

  isConsentValid() {
    if (!this.settings.consent_timestamp) return false;
    
    // Consent expires after 6 months
    const sixMonthsAgo = Date.now() - (6 * 30 * 24 * 60 * 60 * 1000);
    return this.settings.consent_timestamp > sixMonthsAgo;
  }

  async checkAndRefreshConsent() {
    if (!this.isConsentValid() && this.settings.consent_level !== 'basic') {
      // Consent expired, show dialog again
      const newSettings = await this.showPrivacySettings();
      return newSettings !== null;
    }
    
    return true;
  }
}
