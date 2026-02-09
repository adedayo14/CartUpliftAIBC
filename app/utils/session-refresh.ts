/**
 * Session refresh utility for better UX when sessions expire
 */

export interface SessionRefreshOptions {
  enabled: boolean;
  checkInterval: number; // milliseconds
  warningThreshold: number; // minutes before expiry to show warning
}

export class SessionManager {
  private static instance: SessionManager;
  private checkInterval: NodeJS.Timeout | null = null;
  private options: SessionRefreshOptions;
  
  constructor(options: SessionRefreshOptions) {
    this.options = options;
  }
  
  static getInstance(options?: SessionRefreshOptions): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager(options || {
        enabled: true,
        checkInterval: 5 * 60 * 1000, // 5 minutes
        warningThreshold: 10 // 10 minutes before expiry
      });
    }
    return SessionManager.instance;
  }
  
  start() {
    if (!this.options.enabled || this.checkInterval) return;
    
    this.checkInterval = setInterval(() => {
      this.checkSession();
    }, this.options.checkInterval);
    
    // Also check on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkSession();
      }
    });
  }
  
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  private async checkSession() {
    try {
      const response = await fetch('/app/api/session-check', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.status === 401) {
        // Session expired - show user-friendly message and redirect
        this.handleSessionExpiry();
      } else if (response.ok) {
        const data = await response.json();
        if (data.expiresIn && data.expiresIn < this.options.warningThreshold * 60) {
          this.showSessionWarning(data.expiresIn);
        }
      }
    } catch (error) {
      if (typeof process !== 'undefined' && process.env.DEBUG_MODE === 'true') {
        console.warn('Session check failed:', error);
      }
    }
  }
  
  private handleSessionExpiry() {
    // Remove any existing warnings
    this.removeSessionWarning();
    
    // Show user-friendly session expired message
    const banner = document.createElement('div');
    banner.id = 'session-expired-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10000;
      background: #ff6b6b;
      color: white;
      padding: 12px 20px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    banner.innerHTML = `
      <strong>Session Expired</strong> - Your session has expired. 
      <button onclick="window.location.reload()" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 4px 12px;
        margin-left: 12px;
        border-radius: 4px;
        cursor: pointer;
      ">Refresh to Continue</button>
    `;
    document.body.appendChild(banner);
    
    // Auto-refresh after 3 seconds if user doesn't click
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  }
  
  private showSessionWarning(expiresInSeconds: number) {
    // Remove existing warning
    this.removeSessionWarning();
    
    const minutes = Math.ceil(expiresInSeconds / 60);
    const banner = document.createElement('div');
    banner.id = 'session-warning-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: #ffa726;
      color: white;
      padding: 8px 20px;
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    `;
    banner.innerHTML = `
      <strong>Session Warning</strong> - Your session will expire in ${minutes} minute(s). 
      <button onclick="this.parentElement.remove(); fetch('/app/api/session-refresh', {method: 'POST'})" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 2px 8px;
        margin-left: 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
      ">Extend Session</button>
    `;
    document.body.appendChild(banner);
  }
  
  private removeSessionWarning() {
    const existing = document.getElementById('session-warning-banner');
    if (existing) existing.remove();
  }
}

// Auto-start session manager when imported
if (typeof window !== 'undefined') {
  const manager = SessionManager.getInstance();
  manager.start();
}
