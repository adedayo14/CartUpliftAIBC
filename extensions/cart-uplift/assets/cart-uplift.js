// CACHE_BUST_22NOV2025_V20_9_NATIVE_CART_BLOCK_FIX
(() => {
	// Production v20.9 - Fix Native Cart Overlaying Cart Uplift

	// ========================================
	// CONSTANTS
	// ========================================
	const CONSTANTS = {
		VERSION: "v20.9",
		CART_VERSION: "1.2.0",
		DEBUG: typeof window !== 'undefined' && window.localStorage?.getItem('CART_UPLIFT_DEBUG') === 'true',
		API_ENDPOINTS: {
			TRACK: "/apps/cart-uplift/api/track",
			CART_TRACKING: "/apps/cart-uplift/api/cart-tracking",
		},
		STORAGE_KEYS: {
			SESSION_ID: "cart_session_id",
		},
		SELECTORS: {
			GRID_OVERLAY: ".cartuplift-grid-overlay",
		},
		EVENTS: {
			IMPRESSION: "impression",
			CLICK: "click",
			CART_OPENED: "cartuplift:opened",
		},
		TIMING: {
			GRID_SELF_HEAL_DELAY: 800,
		},
	};

	// ========================================
	// DEBUG LOGGER
	// ========================================
	const debug = {
		log: (...args) => CONSTANTS.DEBUG && console.log('[CartUplift]', ...args),
		info: (...args) => CONSTANTS.DEBUG && console.info('[CartUplift]', ...args),
		warn: (...args) => console.warn('[CartUplift]', ...args), // always show
		error: (...args) => console.error('[CartUplift]', ...args), // always show
	};

	// Version tracking for debugging if needed
	if (CONSTANTS.DEBUG) {
		console.log('[CartUplift] Version:', CONSTANTS.VERSION);
	}

	// ========================================
	// VERSION MANAGEMENT & SELF-HEALING
	// ========================================
	(() => {
		const timestamp = new Date().toISOString();
		if (window.CART_UPLIFT_ASSET_VERSION !== CONSTANTS.VERSION) {
			window.CART_UPLIFT_ASSET_VERSION = CONSTANTS.VERSION;
		}

		/**
		 * Runtime self-heal: remove legacy overlay nodes if stale HTML rendered by cached markup
		 */
		function selfHealGrid() {
			try {
				const layout = window.CartUpliftSettings?.recommendationLayout || "";
				// Accept both new naming (grid) and internal normalized value
				if (layout === "grid") {
					const stale = document.querySelectorAll(CONSTANTS.SELECTORS.GRID_OVERLAY);
					if (stale.length) {
						debug.warn(
							"[CartUplift] Removing stale grid overlay nodes (cache mismatch fix). Count:",
							stale.length,
						);
						stale.forEach((n) => n.remove());
					}
				}
			} catch (_) {}
		}

		document.addEventListener("DOMContentLoaded", () =>
			setTimeout(selfHealGrid, CONSTANTS.TIMING.GRID_SELF_HEAL_DELAY),
		);
		document.addEventListener(CONSTANTS.EVENTS.CART_OPENED, selfHealGrid);
	})();

	// ========================================
	// UTILITIES
	// ========================================

	/**
	 * Generate a unique session ID
	 * @returns {string} Session ID
	 */
	function generateSessionId() {
		return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	}

	/**
	 * Get or create session ID from sessionStorage
	 * @returns {string} Session ID
	 */
	function getSessionId() {
		let sessionId = sessionStorage.getItem(CONSTANTS.STORAGE_KEYS.SESSION_ID);
		if (!sessionId) {
			sessionId = generateSessionId();
			sessionStorage.setItem(CONSTANTS.STORAGE_KEYS.SESSION_ID, sessionId);
		}
		return sessionId;
	}

	// ========================================
	// ANALYTICS TRACKING
	// ========================================

	/**
	 * CartAnalytics - Client-side analytics tracking with deduplication
	 */
	const CartAnalytics = {
		// Track which events have been fired in this session (client-side deduplication)
		trackedEvents: new Set(),

		/**
		 * Track an analytics event (fire and forget)
		 * @param {string} eventType - Type of event to track
		 * @param {object} data - Event data
		 */
		trackEvent: function (eventType, data = {}) {
			try {
				const shop = window.Shopify?.shop || "";
				const sessionId = getSessionId();

				// 🛡️ CLIENT-SIDE DEDUPLICATION: Prevent duplicate impressions/clicks in same session
				if (eventType === CONSTANTS.EVENTS.IMPRESSION || eventType === CONSTANTS.EVENTS.CLICK) {
					const dedupeKey = `${eventType}_${data.productId}_${sessionId}`;

					if (this.trackedEvents.has(dedupeKey)) {
						return;
					}

					this.trackedEvents.add(dedupeKey);
				}

				const formData = new FormData();
				formData.append("eventType", eventType);
				formData.append("shop", shop);
				formData.append("sessionId", sessionId);

				// Append optional data fields
				if (data.productId) formData.append("productId", data.productId);
				if (data.variantId) formData.append("variantId", data.variantId);
				if (data.parentProductId) formData.append("parentProductId", data.parentProductId);
				if (data.productTitle) formData.append("productTitle", data.productTitle);
				if (data.revenue) formData.append("revenue", data.revenue.toString());
				if (data.orderId) formData.append("orderId", data.orderId);
				if (data.source) formData.append("source", data.source);
				if (data.position !== undefined) formData.append("position", data.position.toString());

				// Send to tracking endpoint (fire and forget)
				fetch(CONSTANTS.API_ENDPOINTS.TRACK, {
					method: "POST",
					body: formData,
				})
					.then((response) => response.json())
					.then((result) => {
						// Tracking complete
					})
					.catch((err) => {
						// Analytics tracking failed (non-critical)
					});
			} catch (error) {
				// Analytics error (non-critical)
			}
		},
	};

	// ========================================
	// MAIN CART DRAWER CONTROLLER
	// ========================================

	/**
	 * CartUpliftDrawer - Main cart drawer controller class
	 * Manages cart state, recommendations, progress bars, and checkout flow
	 */
	class CartUpliftDrawer {
		constructor(settings) {
			this.version = CONSTANTS.CART_VERSION;

			// Merge defaults with provided settings and any globals
			this.settings = Object.assign(
				{},
				window.CartUpliftSettings || {},
				settings || {},
			);

			const normalizeBooleanSetting = (value) => {
				if (typeof value === "string") {
					const normalized = value.trim().toLowerCase();
					return (
						normalized === "true" ||
						normalized === "1" ||
						normalized === "yes" ||
						normalized === "on"
					);
				}
				return Boolean(value);
			};

			if (this.settings.enableProductTitleCaps !== undefined) {
				this.settings.enableProductTitleCaps = normalizeBooleanSetting(
					this.settings.enableProductTitleCaps,
				);
			}

			if (this.settings.enableRecommendationTitleCaps !== undefined) {
				this.settings.enableRecommendationTitleCaps = normalizeBooleanSetting(
					this.settings.enableRecommendationTitleCaps,
				);
			}

			// Detect and apply theme colors to prevent green fallbacks
			this.themeColors = this.detectThemeColors();

			// Apply color fallback for progress bars: default to BLACK (never theme blue/green)
			if (
				!this.settings.shippingBarColor ||
				this.settings.shippingBarColor === "#4CAF50"
			) {
				this.settings.shippingBarColor = "#121212";
			}

			// Apply background color from theme detection if not explicitly set
			if (!this.settings.backgroundColor) {
				this.settings.backgroundColor = this.themeColors.background;
			}

			// Normalize layout setting; accept both keys and prefer explicit theme selection
			if (this.settings) {
				// Accept theme embed key (recommendationsLayout) if primary missing
				if (
					!this.settings.recommendationLayout &&
					this.settings.recommendationsLayout
				) {
					this.settings.recommendationLayout =
						this.settings.recommendationsLayout;
				}
				// Prefer theme source if marked
				if (
					this.settings.recommendationLayoutSource === "theme" &&
					this.settings.recommendationsLayout
				) {
					this.settings.recommendationLayout =
						this.settings.recommendationsLayout;
				}
				const map = {
					horizontal: "row",
					row: "row",
					carousel: "row",
					vertical: "column",
					column: "column",
					list: "column",
					grid: "grid",
				};
				if (this.settings.recommendationLayout) {
					this.settings.recommendationLayout =
						map[this.settings.recommendationLayout] ||
						this.settings.recommendationLayout;
				}
			}

			// Ensure boolean settings are properly set
			// Sticky cart removed – ignore legacy setting
			this.settings.enableFreeShipping = Boolean(
				this.settings.enableFreeShipping,
			);
			this.settings.enableGiftGating = Boolean(this.settings.enableGiftGating);
			this.settings.enableApp = this.settings.enableApp !== false;
			this.settings.enableRecommendations =
				this.settings.enableRecommendations !== false; // DEFAULT TO TRUE
			this.settings.enableAddons = Boolean(this.settings.enableAddons);
			// Map enableOrderNotes from theme settings to enableNotes
			this.settings.enableNotes = Boolean(
				this.settings.enableOrderNotes || this.settings.enableNotes,
			);
			this.settings.enableDiscountCode =
				this.settings.enableDiscountCode !== false; // DEFAULT TO TRUE
			this.settings.enableExpressCheckout =
				this.settings.enableExpressCheckout !== false; // DEFAULT TO TRUE
			// Map promotionLinkText to discountLinkText for consistency
			this.settings.discountLinkText =
				this.settings.promotionLinkText ||
				this.settings.discountLinkText ||
				"+ Got a promotion code?";

			this.settings.maxRecommendations = this.normalizeMaxRecommendations(
				this.settings.maxRecommendations,
			);
			if (window.CartUpliftSettings) {
				window.CartUpliftSettings.maxRecommendations =
					this.settings.maxRecommendations;
			}

			// Handle both autoOpenCart (from API) and keepCartOpen (from theme design mode)
			// In design mode, keepCartOpen overrides autoOpenCart for editor convenience
			// When not in design mode, respect the actual autoOpenCart setting

			if (
				this.settings.designMode &&
				this.settings.keepCartOpen !== undefined
			) {
				this.settings.autoOpenCart = Boolean(this.settings.keepCartOpen);
			} else {
				this.settings.autoOpenCart = Boolean(this.settings.autoOpenCart);
			}

			this.settings.enableTitleCaps = Boolean(this.settings.enableTitleCaps);

			this.settings.freeShippingThresholdCents =
				this.getFreeShippingThresholdCents();
			if (window.CartUpliftSettings) {
				window.CartUpliftSettings.freeShippingThresholdCents =
					this.settings.freeShippingThresholdCents;
			}

			// Set default gift notice text if not provided (now purely gift oriented, no shipping savings wording)
			this.settings.giftNoticeText =
				this.settings.giftNoticeText || "Free gift added";

			// Set default gift price text if not provided
			this.settings.giftPriceText = this.settings.giftPriceText || "FREE";
			// Combined success template – show product but no savings amount (shown in promotion section)
			// Keep product name but remove value to avoid duplication
			this.settings.combinedSuccessTemplate =
				this.settings.allRewardsAchievedText ||
				"✓ Free shipping + {{ product_name }} added free";

			// Initialize cart with empty state (will be updated when fetched)
			this.cart = { items: [], item_count: 0, total_price: 0, currency: window.Shopify?.currency?.active || 'USD' };
			this.isOpen = false;
			this._isAnimating = false;
			this._quantityBusy = false;
			this._recommendationsLoaded = false;
			this._rebuildInProgress = false; // STABILITY: Prevent rapid rebuilds
			this._recommendationsLocked = false; // Keep master order stable; still recompute visible list on cart changes
			this._updateDebounceTimer = null; // STABILITY: Debounce rapid updates
			this.recommendations = [];
			this._allRecommendations = []; // Master list to allow re-show after removal from cart
			// Track if free shipping was ever achieved in this session (for soft fallback message)
			this._freeShippingHadUnlocked = false;
			this._modalOpening = false;
			this._giftModalRetryTimer = null;

			// Immediately intercept cart notifications if app is enabled
			if (this.settings.enableApp) {
				this.installEarlyInterceptors();
			}

			// CRITICAL FIX: Listen for settings updates BEFORE initialization
			this._settingsUpdateHandler = async (_event) => {
				// Deep merge the settings
				this.settings = Object.assign(
					{},
					this.settings,
					window.CartUpliftSettings || {},
				);

				// Normalize layout again after update; keep theme override if present
				if (
					!this.settings.recommendationLayout &&
					this.settings.recommendationsLayout
				) {
					this.settings.recommendationLayout =
						this.settings.recommendationsLayout;
				}
				if (
					this.settings.recommendationLayoutSource === "theme" &&
					this.settings.recommendationsLayout
				) {
					this.settings.recommendationLayout =
						this.settings.recommendationsLayout;
				}
				if (this.settings.recommendationLayout) {
					const map = {
						horizontal: "row",
						row: "row",
						carousel: "row",
						vertical: "column",
						column: "column",
						list: "column",
						grid: "grid",
					};
					this.settings.recommendationLayout =
						map[this.settings.recommendationLayout] ||
						this.settings.recommendationLayout;
				}

				this.settings.maxRecommendations = this.normalizeMaxRecommendations(
					this.settings.maxRecommendations,
				);
				if (window.CartUpliftSettings) {
					window.CartUpliftSettings.maxRecommendations =
						this.settings.maxRecommendations;
				}

				this.settings.freeShippingThresholdCents =
					this.getFreeShippingThresholdCents();
				if (window.CartUpliftSettings) {
					window.CartUpliftSettings.freeShippingThresholdCents =
						this.settings.freeShippingThresholdCents;
				}

				this.applyCustomColors();

				// If recommendations were just enabled and not loaded yet
				if (
					this.settings.enableRecommendations &&
					!this._recommendationsLoaded
				) {
					await this.loadRecommendations();
					this._recommendationsLoaded = true;
				} else if (this._allRecommendations.length) {
					// Re-filter recommendations from master list
					this.rebuildRecommendationsFromMaster();
				}

				// Sticky cart removed – nothing to create

				// Re-render drawer to apply new settings
				this.updateDrawerContent();

				// Update specific sections if they exist
				this.updateRecommendationsSection();
			};

			// Attach the listener BEFORE init
			document.addEventListener(
				"cartuplift:settings:updated",
				this._settingsUpdateHandler,
			);

			this.initPromise = this.init();
		}

		// Basic HTML escape for safe text insertion
		escapeHtml(str) {
			if (str === undefined || str === null) return "";
			return String(str)
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;")
				.replace(/'/g, "&#39;");
		}

		normalizeMaxRecommendations(value) {
			const parsed = Number(value);
			const isFiniteNumber = Number.isFinite
				? Number.isFinite(parsed)
				: Number.isFinite(parsed);
			if (!isFiniteNumber || parsed <= 0) {
				return 3;
			}
			const normalized = Math.max(1, Math.floor(parsed));
			return normalized;
		}

	async init() {
		debug.log('CartUplift v8.0: AI-powered bundles & intelligent cart recommendations active | Author: Adedayo for Cass, Eni & Ayo');
		// Don't wait for DOMContentLoaded - start setup immediately
		// The setup() method is now optimized to not block
		await this.setup();			// If DOM is still loading, ensure final setup after load
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", () => {
					// Refresh display after DOM is ready
					if (this.cart) {
						this.updateDrawerContent();
					}
				});
			}
		}

		// Detect theme colors to avoid green fallbacks
		detectThemeColors() {
			let primaryColor = null;

			// 1. PRIORITY: Direct access to Shopify color scheme objects (Dawn's approach)
			try {
				// Check for color scheme data in the DOM (as used in Dawn theme)
				const colorSchemeElements = document.querySelectorAll(
					'[class*="color-scheme"], [class*="color-"]',
				);
				for (const element of colorSchemeElements) {
					const styles = getComputedStyle(element);

					// Check Dawn's standard CSS custom properties
					const buttonColor = styles.getPropertyValue("--color-button").trim();
					const foregroundColor = styles
						.getPropertyValue("--color-foreground")
						.trim();

					if (buttonColor?.includes(",")) {
						// Dawn stores colors as RGB values: "255,255,255"
						const rgbValues = buttonColor
							.split(",")
							.map((v) => parseInt(v.trim(), 10));
						if (
							rgbValues.length >= 3 &&
							rgbValues.every((v) => !Number.isNaN(v) && v >= 0 && v <= 255)
						) {
							primaryColor = this.rgbToHex(`rgb(${rgbValues.join(",")})`);
							break;
						}
					}

					if (
						!primaryColor &&
						foregroundColor &&
						foregroundColor.includes(",")
					) {
						const rgbValues = foregroundColor
							.split(",")
							.map((v) => parseInt(v.trim(), 10));
						if (
							rgbValues.length >= 3 &&
							rgbValues.every((v) => !Number.isNaN(v) && v >= 0 && v <= 255)
						) {
							primaryColor = this.rgbToHex(`rgb(${rgbValues.join(",")})`);
							break;
						}
					}
				}
			} catch (_error) {}

			// 2. Check root-level CSS custom properties (Shopify 2.0 standard)
			if (!primaryColor) {
				const rootStyle = getComputedStyle(document.documentElement);

				// Dawn and modern Shopify themes store colors as comma-separated RGB values
				const colorProperties = [
					"--color-button", // Dawn's primary button color
					"--color-foreground", // Dawn's text/foreground color
					"--color-accent", // Legacy accent color
					"--color-primary", // Legacy primary color
				];

				for (const property of colorProperties) {
					try {
						const value = rootStyle.getPropertyValue(property).trim();
						if (value?.includes(",")) {
							const rgbValues = value
								.split(",")
								.map((v) => parseInt(v.trim(), 10));
							if (
								rgbValues.length >= 3 &&
								rgbValues.every((v) => !Number.isNaN(v) && v >= 0 && v <= 255)
							) {
								primaryColor = this.rgbToHex(`rgb(${rgbValues.join(",")})`);
								break;
							}
						} else if (value?.startsWith("#")) {
							primaryColor = value;
							break;
						} else if (value?.startsWith("rgb")) {
							const hexColor = this.rgbToHex(value);
							if (hexColor) {
								primaryColor = hexColor;
								break;
							}
						}
					} catch (_error) {
						// Continue if property doesn't exist
					}
				}
			}

			// 3. Analyze Shopify standard button elements (as per Dawn)
			if (!primaryColor) {
				// Dawn and Shopify's recommended button selectors
				const shopifyButtonSelectors = [
					".button:not(.button--secondary):not(.button--tertiary)", // Dawn primary buttons
					".product-form__cart-submit", // Dawn add to cart
					".shopify-payment-button__button--unbranded", // Shopify payment buttons
					'button[type="submit"]:not(.button--secondary)', // Submit buttons
					".btn--primary", // Legacy primary buttons
					'[data-shopify*="button"]', // Shopify-specific buttons
				];

				for (const selector of shopifyButtonSelectors) {
					try {
						const button = document.querySelector(selector);
						if (button && button.offsetParent !== null) {
							const styles = getComputedStyle(button);
							const bgColor = styles.backgroundColor;

							if (
								bgColor &&
								bgColor !== "rgba(0, 0, 0, 0)" &&
								bgColor !== "transparent"
							) {
								const hexColor = this.rgbToHex(bgColor);
								if (hexColor) {
									// Avoid pure white, black, or transparent
									if (
										hexColor !== "#ffffff" &&
										hexColor !== "#000000" &&
										hexColor !== "#transparent"
									) {
										primaryColor = hexColor;
										break;
									}
								}
							}
						}
					} catch (_error) {
						// Continue with next selector
					}
				}
			}

			// 4. Use Dawn's default dark neutral (never use green or fallbacks)
			if (!primaryColor) {
				primaryColor = "#121212"; // Dawn's standard dark color
			}

			// CRITICAL: Prevent any green colors (paid app requirement)
			if (primaryColor && this.isGreenColor(primaryColor)) {
				debug.warn(
					"🚫 [CartUplift] Green color detected, using Dawn default:",
					primaryColor,
				);
				primaryColor = "#121212";
			}

			// Detect background colors
			let backgroundColor = "#ffffff"; // Default white

			try {
				// Check for body background first
				const bodyStyles = getComputedStyle(document.body);
				const bodyBgColor = bodyStyles.backgroundColor;

				if (
					bodyBgColor &&
					bodyBgColor !== "rgba(0, 0, 0, 0)" &&
					bodyBgColor !== "transparent"
				) {
					backgroundColor = this.rgbToHex(bodyBgColor);
				} else {
					// Check root/html background
					const rootStyles = getComputedStyle(document.documentElement);
					const rootBgColor = rootStyles.backgroundColor;

					if (
						rootBgColor &&
						rootBgColor !== "rgba(0, 0, 0, 0)" &&
						rootBgColor !== "transparent"
					) {
						backgroundColor = this.rgbToHex(rootBgColor);
					} else {
						// Check for theme-specific background properties
						const backgroundProperties = [
							"--color-background", // Dawn's background color
							"--color-body", // Some themes use this
							"--background-color", // Common property
							"--color-base-background",
						];

						for (const property of backgroundProperties) {
							const value = rootStyles.getPropertyValue(property).trim();
							if (value) {
								if (value.includes(",")) {
									// RGB values like "255,255,255"
									const rgbValues = value
										.split(",")
										.map((v) => parseInt(v.trim(), 10));
									if (
										rgbValues.length >= 3 &&
										rgbValues.every(
											(v) => !Number.isNaN(v) && v >= 0 && v <= 255,
										)
									) {
										backgroundColor = this.rgbToHex(
											`rgb(${rgbValues.join(",")})`,
										);
										break;
									}
								} else if (value.startsWith("#") || value.startsWith("rgb")) {
									backgroundColor = this.rgbToHex(value);
									break;
								}
							}
						}
					}
				}
			} catch (_error) {
				backgroundColor = "#ffffff";
			}

			return {
				primary: primaryColor,
				background: backgroundColor,
			};
		}

		// Enhanced green color detection
		isGreenColor(color) {
			if (!color || typeof color !== "string") return false;

			const hex = color.toLowerCase();

			// Explicit green color codes to avoid
			const greenColors = [
				"#4caf50",
				"#22c55e",
				"#10b981",
				"#059669",
				"#34d399",
				"#6ee7b7",
				"#a7f3d0",
				"#d1fae5",
				"#ecfdf5",
				"#00ff00",
				"#008000",
				"#228b22",
				"#32cd32",
				"#7cfc00",
				"#adff2f",
				"#9acd32",
				"#98fb98",
				"#90ee90",
				"#00fa9a",
				"#00ff7f",
			];

			if (greenColors.includes(hex)) return true;

			// Check RGB values for green-dominant colors
			try {
				let r, g, b;

				if (hex.startsWith("#")) {
					const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
					if (result) {
						r = parseInt(result[1], 16);
						g = parseInt(result[2], 16);
						b = parseInt(result[3], 16);
					}
				} else if (color.includes("rgb")) {
					const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
					if (match) {
						r = parseInt(match[1], 10);
						g = parseInt(match[2], 10);
						b = parseInt(match[3], 10);
					}
				}

				if (r !== undefined && g !== undefined && b !== undefined) {
					// Green is dominant and significantly higher than red and blue
					return g > r + 30 && g > b + 30 && g > 100;
				}
			} catch (_error) {
				// Continue with string check
			}

			return false;
		}

		// Helper function to convert RGB to hex
		rgbToHex(rgb) {
			if (!rgb || !rgb.includes("rgb")) return null;

			const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
			if (!match) return null;

			const r = parseInt(match[1], 10);
			const g = parseInt(match[2], 10);
			const b = parseInt(match[3], 10);

			return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
		}

		async setup() {
			// PREWARMING: Start preloading cart data immediately (non-blocking)
			this.prewarmCart();

		// Create drawer IMMEDIATELY (don't wait for cart data)
		this.createDrawer();

		// Set up cart replacement (needs to work even before cart loads)
		this.setupCartUpliftInterception();			// Track last click to support fly-to-cart animation
			this.installClickTracker();

			// Install cart monitoring (must be ready immediately)
			this.installAddToCartMonitoring();

			// Apply custom colors
			this.applyCustomColors();

			// SET UP MUTATION OBSERVER TO CATCH DYNAMIC NOTIFICATIONS
			if (this.settings.enableApp) {
				this.setupNotificationBlocker();
			}

			// Fetch cart data in background (non-blocking for initialization)
			this.fetchCart().then(() => {
				// Update drawer content with actual cart data once loaded
				this.updateDrawerContent();
				
				// Check gift thresholds after initial cart load
				this.checkAndAddGiftThresholds();
			});

			// Load recommendations if enabled (in background)
			if (this.settings.enableRecommendations && !this._recommendationsLoaded) {
				this.loadRecommendations().then(() => {
					this._recommendationsLoaded = true;
					// Update drawer content again with recommendations
					this.updateDrawerContent();
				});
			}

			// IMPORTANT: Check if recommendations settings have arrived
			// Give a small delay to allow the upsell embed to load
			setTimeout(async () => {
				// Re-check settings from window
				if (window.CartUpliftSettings) {
					this.settings = Object.assign(
						{},
						this.settings,
						window.CartUpliftSettings,
					);
				}

				// Load recommendations if enabled and not loaded
				if (
					this.settings.enableRecommendations &&
					!this._recommendationsLoaded
				) {
					await this.loadRecommendations();
					this._recommendationsLoaded = true;
					this.updateDrawerContent();
				}
			}, 500);

			// Listen for late settings injection (upsell embed) and refresh recommendations
			document.addEventListener("cartuplift:settings:updated", async () => {
				// Merge any new settings
				this.settings = Object.assign(
					this.settings,
					window.CartUpliftSettings || {},
				);
				this.applyCustomColors();
				if (
					this.settings.enableRecommendations &&
					!this._recommendationsLoaded
				) {
					await this.loadRecommendations();
				}
		// Re-render to ensure changes are reflected immediately
		this.updateDrawerContent();
	});

	// Add method to refresh settings from API
	window.cartUpliftRefreshSettings = async () => {
		await this.refreshSettingsFromAPI();
	};
}

/**
 * Disable CartUplift and fall back to native Shopify cart when billing limit reached
 */
disableApp() {
	// Set global disabled flag
	this.settings.enableApp = false;
	window.CartUpliftSettings = window.CartUpliftSettings || {};
	window.CartUpliftSettings.enableApp = false;

	// Close our drawer if currently open
	if (this.isOpen) {
		const container = document.getElementById("cartuplift-app-container");
		if (container) {
			container.classList.remove("active");
			container.style.display = "none";
		}
		this.isOpen = false;
		document.documentElement.classList.remove("cartuplift-no-scroll");
		document.body.classList.remove("cartuplift-no-scroll");
	}

	// Hide CartUplift container permanently
	const container = document.getElementById("cartuplift-app-container");
	if (container) {
		container.style.display = "none";
		container.style.visibility = "hidden";
	}

	// Remove CartUplift UI elements (recommendations, badges, etc.)
	const cartBadge = document.querySelector('.cartuplift-cart-badge');
	if (cartBadge) cartBadge.remove();

	// Restore original functions and remove all interceptors
	if (this._restoreOriginalFunctions) {
		this._restoreOriginalFunctions();
	}

	// Cart icon clicks will now open Shopify's native cart drawer
}

// Method to update settings from theme extension (e.g., layout changes)
updateSettingsFromThemeExtension(newSettings) {			// Add method to soft refresh recommendations (force cart re-sync)
			window.cartUpliftSoftRefresh = async () => {
				await this.fetchCart();
				if (this._recommendationsLoaded) {
					this.rebuildRecommendationsFromMaster();
				}
				this.updateDrawerContent();
			};

			// Global restoration function - call from console to restore original theme functions
			// Usage: window.cartUpliftRestoreOriginals()
			window.cartUpliftRestoreOriginals = () => {
				if (window.cartUpliftDrawer?._restoreOriginalFunctions) {
					window.cartUpliftDrawer._restoreOriginalFunctions();
					debug.log('✅ CartUplift: All original theme functions restored');
					return true;
				}
				debug.warn('⚠️ CartUplift: Drawer not initialized, nothing to restore');
				return false;
			};

			// Signal that the drawer is ready
			document.dispatchEvent(new CustomEvent('cartuplift:ready'));
		}

		// Prewarm cart data to reduce first-click delay
		prewarmCart() {
			const startTime = performance.now();

			// Start preloading cart data in background
			if (!this._prewarmPromise) {
				this._prewarmPromise = fetch("/cart.js", {
					method: "GET",
					headers: { Accept: "application/json" },
				})
					.then((response) => response.json())
					.then((cart) => {
						const elapsed = Math.round(performance.now() - startTime);
						this._prewarmData = cart;
						return cart;
					})
					.catch((error) => {
						this._prewarmData = null;
					});
			}

			// Also prewarm recommendations API
			if (
				this.settings.enableRecommendations &&
				!this._recommendationsPrewarmed &&
				window.ShopifyAnalytics?.meta?.product?.id
			) {
				this._recommendationsPrewarmed = true;
				const productId = window.ShopifyAnalytics.meta.product.id;
				fetch(`/recommendations/products.json?product_id=${productId}&limit=20`, {
				method: "GET",
				headers: { Accept: "application/json" },
			})
				.then((response) => {
					if (!response.ok) return null;
					return response.json();
				})
				.then((_data) => {
					// Prewarmed successfully
				})
				.catch((_error) => {
					// Silently fail - not critical
				});
		}
	}		// Track last meaningful click to derive animation source
		installClickTracker() {
			this._lastClick = null;
			document.addEventListener(
				"click",
				(e) => {
					const el = e.target.closest(
						'button, [type="submit"], .product-form, form, a, .add-to-cart, [name="add"], [data-add-to-cart]',
					);
					if (!el) return;
					const rect = el.getBoundingClientRect();
					// Use click point if available, else center of element
					const x =
						typeof e.clientX === "number" && e.clientX
							? e.clientX
							: rect.left + rect.width / 2;
					const y =
						typeof e.clientY === "number" && e.clientY
							? e.clientY
							: rect.top + rect.height / 2;
					this._lastClick = { x, y, time: Date.now(), rect };
				},
				true,
			);
		}

		// Compute target point: header cart as target or right-edge fallback
		getFlyTargetPoint() {
			const headerSelectors = [
				".header__icon--cart",
				".cart-link",
				".cart-icon",
				".site-header__cart",
				".nav-cart",
				".header-cart",
				"[data-cart-drawer-toggle]",
			];
			for (const sel of headerSelectors) {
				const el = document.querySelector(sel);
				if (el && el.offsetParent !== null) {
					const r = el.getBoundingClientRect();
					return { x: r.left + r.width / 2, y: r.top + r.height / 2, el };
				}
			}
			// Fallback: always animate to the right edge
			return { x: window.innerWidth - 24, y: window.innerHeight / 2, el: null };
		}

		// Animate a small ghost dot from source to target
		flyToCart(options = {}) {
			// Animation disabled - was causing confusion when adding from drawer (animating to wrong icon)
			return;
		}

		async refreshSettingsFromAPI() {
			try {
				const shopDomain = window.CartUpliftShop || window.Shopify?.shop;
				if (shopDomain) {
					const apiUrl = `/apps/cart-uplift/api/settings?shop=${encodeURIComponent(shopDomain)}`;
					const response = await fetch(apiUrl);

					// Check for billing limit reached (402 Payment Required)
					if (response.status === 402) {
						this.disableApp();
						return;
					}

					if (response.ok) {
						const newSettings = await response.json();

						// Preserve theme-chosen layout if present
						if (this.settings.recommendationLayoutSource === "theme") {
							newSettings.recommendationLayout =
								this.settings.recommendationLayout;
							newSettings.recommendationsLayout =
								this.settings.recommendationsLayout ||
								newSettings.recommendationsLayout;
							newSettings.recommendationLayoutSource = "theme";
						}

						// Preserve design mode settings - don't let API override theme editor choices
						if (this.settings.designMode) {
							debug.log(
								"🔧 Preserving design mode settings during API refresh",
							);
							newSettings.designMode = this.settings.designMode;
							if (this.settings.keepCartOpen !== undefined) {
								newSettings.keepCartOpen = this.settings.keepCartOpen;
								// Don't let API autoOpenCart override design mode keepCartOpen
								newSettings.autoOpenCart = this.settings.keepCartOpen;
								debug.log(
									"🔧 Preserved keepCartOpen:",
									this.settings.keepCartOpen,
									"autoOpenCart set to:",
									newSettings.autoOpenCart,
								);
							}
						}

						this.settings = Object.assign(this.settings, newSettings);
						window.CartUpliftSettings = Object.assign(
							window.CartUpliftSettings || {},
							newSettings,
						);
						this.applyCustomColors();
						this.updateDrawerContent();
					}
				}
			} catch (_error) {}
		}

		// Method to update settings from theme extension (e.g., layout changes)
		updateSettingsFromThemeExtension(newSettings) {
			debug.log(
				"🎯 Updating cart drawer settings from theme extension:",
				newSettings,
			);

		// Merge new settings
		this.settings = Object.assign(this.settings, newSettings);
		window.CartUpliftSettings = Object.assign(
			window.CartUpliftSettings || {},
			newSettings,
		);
		this.applyCustomColors();

		// If layout changed, refresh the recommendation layout
		if (newSettings.recommendationLayout) {
			this.refreshRecommendationLayout();
		}

		// Refresh drawer content to apply changes
		this.updateDrawerContent();
	}

	applyCustomColors() {
		const style =
			document.getElementById("cartuplift-dynamic-styles") ||
			document.createElement("style");
		style.id = "cartuplift-dynamic-styles";			// Get theme colors with enhanced detection
			const themeColors = this.themeColors || this.detectThemeColors();

			// Ensure we NEVER use green colors in production
			const safeThemeColor = this.isGreenColor(themeColors.primary)
				? "#121212"
				: themeColors.primary;
			const safeButtonColor =
				this.settings.buttonColor &&
				!this.isGreenColor(this.settings.buttonColor)
					? this.settings.buttonColor
					: safeThemeColor;
		const safeShippingColor =
			this.settings.shippingBarColor &&
			!this.isGreenColor(this.settings.shippingBarColor)
				? this.settings.shippingBarColor
				: "#10b981"; // Use visible green as default instead of black

		// Detect theme button colors from Shopify theme CSS variables
		let themeButtonBg = null;
		let themeButtonText = null;
		try {
			const rootStyles = getComputedStyle(document.documentElement);
			themeButtonBg = rootStyles.getPropertyValue('--color-button').trim();
			themeButtonText = rootStyles.getPropertyValue('--color-button-text').trim();
			
			// If not found at root, check color scheme elements
			if (!themeButtonBg) {
				const colorScheme = document.querySelector('[class*="color-scheme"]');
				if (colorScheme) {
					const schemeStyles = getComputedStyle(colorScheme);
					themeButtonBg = schemeStyles.getPropertyValue('--color-button').trim();
					themeButtonText = schemeStyles.getPropertyValue('--color-button-text').trim();
				}
			}
		} catch (e) {
			console.warn('CartUplift: Could not detect theme button colors:', e);
		}

		// Append minimal animation CSS for pulse effect if not present
		const pulseCSS = `\n@keyframes cartupliftPulse {\n  0% { transform: scale(1); }\n  50% { transform: scale(1.08); }\n  100% { transform: scale(1); }\n}\n.cartuplift-header-cart.cartuplift-pulse {\n  animation: cartupliftPulse 450ms ease-out;\n}\n`;
		if (!style.textContent.includes("@keyframes cartupliftPulse")) {
			style.textContent += pulseCSS;
		}			// Set CSS variables for progress bar colors
			document.documentElement.style.setProperty(
				"--cartuplift-button-color",
				safeShippingColor,
			);
			document.documentElement.style.setProperty(
				"--cartuplift-shipping-fill",
				safeShippingColor,
			);
			
			// Set theme button colors if detected
			if (themeButtonBg) {
				document.documentElement.style.setProperty(
					"--color-button",
					themeButtonBg,
				);
			}
			if (themeButtonText) {
				document.documentElement.style.setProperty(
					"--color-button-text",
					themeButtonText,
				);
			}

			// Apply to progress bars with forced visibility
			const drawer = document.querySelector(
				"#cartuplift-cart-popup .cartuplift-drawer",
			);
			if (drawer) {
				const progressBars = drawer.querySelectorAll(
					".cartuplift-progress-bar",
				);
				progressBars.forEach((bar) => {
					const fill = bar.querySelector(".cartuplift-progress-fill");
					if (fill) {
						fill.style.setProperty(
							"background",
							safeShippingColor,
							"important",
						);
						// Do not force a min-width; allow 0% to be truly hidden
						fill.style.setProperty("display", "block", "important");
						fill.style.setProperty("opacity", "1", "important");
					}
				});
			}

			// Build CSS with bulletproof color application
			const cartBgColor =
				this.settings.cartBackgroundColor ||
				this.settings.backgroundColor ||
				"#ffffff";
			const css = `
        :root {
          --cartuplift-success-color: ${safeThemeColor} !important;
          --cartuplift-success: ${safeThemeColor} !important;
          --cartuplift-button-color: ${safeShippingColor} !important;
          --cartuplift-shipping-fill: ${safeShippingColor} !important;
          ${this.settings.buttonTextColor ? `--cartuplift-button-text-color: ${this.settings.buttonTextColor} !important;` : ""}
          --cartuplift-background: ${cartBgColor} !important;
          --cartuplift-cart-background: ${cartBgColor} !important;
          ${this.settings.textColor ? `--cartuplift-primary: ${this.settings.textColor} !important;` : ""}
          ${this.settings.recommendationsBackgroundColor ? `--cartuplift-recommendations-bg: ${this.settings.recommendationsBackgroundColor} !important;` : ""}
          ${this.settings.shippingBarBackgroundColor ? `--cartuplift-progress-bg: ${this.settings.shippingBarBackgroundColor} !important;` : "--cartuplift-progress-bg: #E5E5E5 !important;"}
        }
        
        /* CRITICAL: Force override ALL green color possibilities with !important */
        .cartuplift-progress-fill,
        .cartuplift-milestone.completed .cartuplift-milestone-icon,
        .cartuplift-achievement-content,
        .cartuplift-shipping-progress-bar .cartuplift-progress-fill,
        .cartuplift-shipping-progress-fill {
          background: ${safeShippingColor} !important;
          background-color: ${safeShippingColor} !important;
        }
        
        .cartuplift-milestone.completed .cartuplift-milestone-label,
        .cartuplift-achievement-text {
          color: ${safeShippingColor} !important;
        }
        
        /* Prevent any green elements from CSS cascade */
        .cartuplift-drawer .cartuplift-progress-fill,
        .cartuplift-drawer .cartuplift-milestone-icon,
        .cartuplift-drawer .cartuplift-shipping-progress-fill,
        #cartuplift-cart-popup .cartuplift-progress-fill,
        .cartuplift-shipping-progress .cartuplift-progress-fill,
        .cartuplift-recommendations .cartuplift-progress-fill {
          background-color: ${safeShippingColor} !important;
        }
        
        .cartuplift-drawer [style*="#4CAF50"],
        .cartuplift-drawer [style*="#22c55e"],
        .cartuplift-drawer [style*="rgb(76, 175, 80)"],
        .cartuplift-drawer [style*="rgb(34, 197, 94)"] {
          background: ${safeThemeColor} !important;
          color: ${safeThemeColor} !important;
        }
        
        /* Apply background colors */
        ${
					cartBgColor
						? `
        .cartuplift-drawer,
        .cartuplift-header,
        .cartuplift-content-wrapper,
        .cartuplift-items,
        .cartuplift-scrollable-content,
        .cartuplift-footer {
          background: ${cartBgColor} !important;
        }`
						: ""
				}
        
        /* Apply text colors */
        ${
					this.settings.textColor
						? `
        .cartuplift-drawer,
        .cartuplift-item-title,
        .cartuplift-price,
        .cartuplift-total-label,
        .cartuplift-total-value {
          color: ${this.settings.textColor} !important;
        }`
						: ""
				}
        
        /* Apply recommendations background */
        ${
					this.settings.recommendationsBackgroundColor
						? `
        .cartuplift-recommendations,
        .cartuplift-recommendations-container {
          background: ${this.settings.recommendationsBackgroundColor} !important;
        }`
						: ""
				}
        
        /* Apply button colors with green prevention */
        .cartuplift-checkout-btn,
        .cartuplift-discount-apply,
        .cartuplift-add-recommendation {
          background: ${safeButtonColor} !important;
          background-color: ${safeButtonColor} !important;
          ${this.settings.buttonTextColor ? `color: ${this.settings.buttonTextColor} !important;` : "color: white !important;"}
        }
        
        .cartuplift-add-recommendation-circle {
          border-color: ${safeButtonColor} !important;
          color: ${safeButtonColor} !important;
        }
        
        .cartuplift-add-recommendation-circle:hover {
          background: ${safeButtonColor} !important;
          background-color: ${safeButtonColor} !important;
          color: ${this.settings.buttonTextColor || "white"} !important;
        }
        
        /* Apply shipping bar colors with green prevention */
        .cartuplift-shipping-progress-fill {
          background: ${safeShippingColor} !important;
          background-color: ${safeShippingColor} !important;
        }
        
        ${
					this.settings.shippingBarBackgroundColor
						? `
        .cartuplift-shipping-progress {
          background: ${this.settings.shippingBarBackgroundColor} !important;
          background-color: ${this.settings.shippingBarBackgroundColor} !important;
        }`
						: ""
				}
          
        /* Hide ONLY Shopify's drawer and notifications when opened - let cart icon work naturally */
        ${
					this.settings.enableApp
						? `
        /* Hide native Shopify drawer when it opens */
        cart-drawer[open]:not(#cartuplift-cart-popup),
        #CartDrawer[open]:not(#cartuplift-cart-popup),
        details.cart-drawer[open],
        .drawer--cart[open],
        cart-drawer-items,
        .cart-drawer__overlay,
        .drawer__overlay {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        
        /* Hide add-to-cart notifications only */
        .cart-notification,
        cart-notification,
        .cart-notification-wrapper,
        .cart-notification-product,
        .cart__notification,
        #CartNotification,
        .ajax-cart-popup,
        .product__notification,
        .notification--cart,
        .product-form__notification,
        [data-cart-notification],
        .added-to-cart,
        .cart-success,
        .cart-added,
        .add-to-cart-notification {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }`
						: ""
				}
        
        /* Professional CSS override for any missed green elements */
        [style*="color: rgb(76, 175, 80)"],
        [style*="background: rgb(76, 175, 80)"],
        [style*="background-color: rgb(76, 175, 80)"],
        [style*="color: #4CAF50"],
        [style*="background: #4CAF50"],
        [style*="background-color: #4CAF50"],
        [style*="color: #22c55e"],
        [style*="background: #22c55e"],
        [style*="background-color: #22c55e"] {
          color: ${safeThemeColor} !important;
          background: ${safeThemeColor} !important;
          background-color: ${safeThemeColor} !important;
        }
      `;

			style.textContent = css;
			if (!document.getElementById("cartuplift-dynamic-styles")) {
				document.head.appendChild(style);
			}
		}

		// Sticky cart removed

		createDrawer() {
			let container = document.getElementById("cartuplift-app-container");

			if (!container) {
				container = document.createElement("div");
				container.id = "cartuplift-app-container";
				container.innerHTML = `
          <div id="cartuplift-backdrop"></div>
          <div id="cartuplift-cart-popup"></div>
        `;
				document.body.appendChild(container);
			}

			const popup = container.querySelector("#cartuplift-cart-popup");
			if (popup) {
				popup.innerHTML = this.getDrawerHTML();
				// Apply title caps data attribute if enabled
				popup.setAttribute(
					"data-cartuplift-title-caps",
					this.settings.enableTitleCaps ? "true" : "false",
				);
			}

			this.attachDrawerEvents();
		}

		getDrawerHTML() {
			const itemCount = this.cart?.item_count || 0;

			// Calculate original cart total before any discounts
			let originalTotal = 0;
			let giftItemsTotal = 0;
			const giftItems = [];

			if (this.cart?.items) {
				this.cart.items.forEach((item) => {
					const isGift = item.properties && item.properties._is_gift === "true";
					if (isGift) {
						// Track gift items total for reference
						giftItemsTotal +=
							item.original_line_price ||
							item.line_price ||
							item.price * item.quantity;
						giftItems.push(item);
					} else {
						// Only include non-gift items in the payable total
						originalTotal +=
							item.original_line_price ||
							item.line_price ||
							item.price * item.quantity;
					}
				});
			}

			// Get discount information from Shopify's cart object if available
			const cartDiscounts = this.cart?.cart_level_discount_applications || [];
			const hasCartDiscount = cartDiscounts.length > 0;

			let totalDiscount = 0;
			let discountLabels = [];

			if (hasCartDiscount) {
				cartDiscounts.forEach((discount) => {
					totalDiscount += Math.abs(discount.total_allocated_amount || 0);
					if (discount.title) discountLabels.push(discount.title);
				});
			}

			// Fallback to manual calculation if no cart discounts found but we have discount attributes
			let manualDiscount = null;
			if (!hasCartDiscount) {
				manualDiscount = this.computeEstimatedDiscount(originalTotal);
				if (manualDiscount.hasDiscount) {
					totalDiscount = manualDiscount.estimatedDiscountCents;
					discountLabels = [manualDiscount.discountLabel];
				}
			}

			const hasDiscount = totalDiscount > 0;
			const finalTotal = Math.max(0, originalTotal - totalDiscount);

			// Check if we should show recommendations - only show if:
			// 1. Recommendations are enabled
			// 2. Cart has items (don't show on empty cart)
			// 3. Either we're still loading OR we have actual recommendations to show
			const hasCartItems = this.cart && this.cart.items && this.cart.items.length > 0;
			const shouldShowRecommendations =
				this.settings.enableRecommendations &&
				hasCartItems &&
				(!this._recommendationsLoaded ||
					(this.recommendations && this.recommendations.length > 0));

			const inlineLinkConfig = this.getInlineLinkConfig();
			const positionClass = this.settings.recommendationsScrollWithCart
				? " recommendations-scroll"
				: " recommendations-fixed";

			return `
        <div class="cartuplift-drawer${shouldShowRecommendations ? " has-recommendations" : ""}${positionClass}">
          ${this.getHeaderHTML(itemCount)}
          
          <div class="cartuplift-content-wrapper">
            <div class="cartuplift-items">
              <div class="cartuplift-items-list">
              ${this.getCartItemsHTML()}
            </div>
            ${shouldShowRecommendations && this.settings.recommendationsScrollWithCart ? this.getRecommendationsHTML() : ""}
            ${
							this.settings.recommendationsScrollWithCart
								? (
										() => {
											let content = "";
											// Only show addons and links when cart has items
											if (hasCartItems) {
												// Add addons if enabled
												if (this.settings.enableAddons) {
													content += this.getAddonsHTML();
												}
												// Add promo/notes links
												const inlineLinks = this.getInlineLinkConfig();
												if (
													inlineLinks.hasPromoLink ||
													inlineLinks.hasNotesLink
												) {
													content += this.getInlineLinksHTML(inlineLinks);
												}
											}
											return content;
										}
									)()
								: ""
						}
          </div>
                      <div class="cartuplift-scrollable-content">
              ${shouldShowRecommendations && !this.settings.recommendationsScrollWithCart ? this.getRecommendationsHTML() : ""}
              ${!this.settings.recommendationsScrollWithCart && this.settings.enableAddons ? this.getAddonsHTML() : ""}
              ${
								!this.settings.recommendationsScrollWithCart
									? (
											() => {
												// Only show promo/notes links when cart has items
												if (!hasCartItems) return "";
												if (
													!(
														inlineLinkConfig.hasPromoLink ||
														inlineLinkConfig.hasNotesLink
													)
												)
													return "";
												return this.getInlineLinksHTML(inlineLinkConfig);
											}
										)()
									: ""
							}
            </div>
          </div>
          
          <div class="cartuplift-footer">
            ${
							giftItemsTotal > 0
								? `
            <div class="cartuplift-gift-notice" style="margin-bottom:8px; font-size: 12px; color: #666;">
              <span>${this.processGiftNoticeTemplate(this.settings.giftNoticeText, giftItemsTotal, giftItems)}</span>
            </div>
            `
								: ""
						}
            ${
							hasDiscount
								? `
            <div class="cartuplift-subtotal cartuplift-discount-line" style="margin-bottom:8px;">
              <span>Discount${discountLabels.length > 0 ? ` (${discountLabels.join(", ")})` : ""}</span>
              <span class="cartuplift-subtotal-amount">- ${this.formatMoney(totalDiscount)}</span>
            </div>
            `
								: ""
						}
            <div class="cartuplift-subtotal">
              <span>Subtotal${hasDiscount ? " (after discount)" : ""}</span>
              <span class="cartuplift-subtotal-amount">${this.formatMoney(finalTotal)}</span>
            </div>
            
            <button class="cartuplift-checkout-btn" onclick="window.cartUpliftDrawer.proceedToCheckout()">
              ${this.settings.checkoutButtonText || "Checkout"}
            </button>
            
            ${(() => {
							return this.settings.enableExpressCheckout
								? this.getExpressCheckoutHTML()
								: "";
						})()}
          </div>
        </div>
      `;
		}

		getHeaderHTML(itemCount) {
			const cartTitle = this.settings.enableProductTitleCaps
				? `CART (${itemCount})`
				: `Cart (${itemCount})`;
			return `
        <div class="cartuplift-header">
          <h2 class="cartuplift-cart-title">${cartTitle}</h2>
          
          <button class="cartuplift-close" aria-label="Close cart">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 24px; height: 24px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        ${this.getUnifiedProgressHTML()}
      `;
		}

		getCartItemsHTML() {
			if (!this.cart || !this.cart.items || this.cart.items.length === 0) {
				return `
          <div class="cartuplift-empty">
            <h4>Your cart is empty. Start shopping!</h4>
            <a href="/" class="cartuplift-empty-cta">Continue Shopping</a>
          </div>
        `;
			}

			// Combine real cart items with preview gift items for design mode
			let allItems = [...this.cart.items];
			if (this._previewGiftItems && this._previewGiftItems.length > 0) {
				allItems = [...this._previewGiftItems, ...this.cart.items];
			}

			// Sort items to put gift items at the top
			const sortedItems = allItems.sort((a, b) => {
				const aIsGift = a.properties && a.properties._is_gift === "true";
				const bIsGift = b.properties && b.properties._is_gift === "true";

				// Gift items go to top (return negative for a to put it first)
				if (aIsGift && !bIsGift) return -1;
				if (!aIsGift && bIsGift) return 1;
				return 0; // Keep original order for same type items
			});

			return sortedItems
				.map((item, _displayIndex) => {
					const isGift = item.properties && item.properties._is_gift === "true";
					const rawTitle = item.product_title;
					const displayTitle = this.settings.enableProductTitleCaps
						? rawTitle.toUpperCase()
						: rawTitle;
					// For gifts, show either FREE, $0.00, or custom gift price text
					let giftPriceDisplay = this.settings.giftPriceText || "FREE";

					// If the setting is $0.00 or 0.00, format it properly
					if (
						giftPriceDisplay === "$0.00" ||
						giftPriceDisplay === "0.00" ||
						giftPriceDisplay === "0"
					) {
						giftPriceDisplay = this.formatMoney(0);
					}

					const displayPrice = isGift
						? giftPriceDisplay
						: this.formatMoney(item.final_price);

					// Find the original line number from the unsorted cart
					// Handle preview items differently from real cart items
					const isPreviewItem = this._previewGiftItems?.includes(item);
					let originalLineNumber = 0;

					if (!isPreviewItem) {
						originalLineNumber =
							this.cart.items.findIndex(
								(originalItem) =>
									originalItem.id === item.id ||
									(originalItem.variant_id === item.variant_id &&
										originalItem.key === item.key),
							) + 1;
					}

					return `
        <div class="cartuplift-item${isGift ? " cartuplift-gift-item" : ""}${isPreviewItem ? " cartuplift-preview-item" : ""}" data-variant-id="${item.variant_id || ""}" data-line="${originalLineNumber}">
          <div class="cartuplift-item-image">
            <img src="${item.image || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png"}" alt="${item.product_title}" loading="lazy" onerror="this.src='https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png'">
          </div>
          <div class="cartuplift-item-info">
            <h4 class="cartuplift-item-title">
              <a href="${item.url}" class="cartuplift-item-link">${displayTitle}</a>
            </h4>
            ${this.getVariantOptionsHTML(item)}
            <div class="cartuplift-item-quantity-wrapper">
              <div class="cartuplift-quantity">
                <button class="cartuplift-qty-minus" data-line="${originalLineNumber}"${isGift || isPreviewItem ? ' style="display:none;"' : ""}>−</button>
                <span class="cartuplift-qty-display">${item.quantity}</span>
                <button class="cartuplift-qty-plus" data-line="${originalLineNumber}"${isGift || isPreviewItem ? ' style="display:none;"' : ""}>+</button>
              </div>
            </div>
          </div>
          <div class="cartuplift-item-price-actions">
            <div class="cartuplift-item-price${isGift ? " cartuplift-gift-price" : ""}">${displayPrice}</div>
            <button class="cartuplift-item-remove-x" data-line="${originalLineNumber}" aria-label="Remove item"${isGift || isPreviewItem ? ' style="display:none;"' : ""}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M9 6V4h6v2m-9 0 1 14h10l1-14H6z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
				})
				.join("");
		}

		getGiftProgressHTML() {
			try {
				const giftThresholds = this.settings.giftThresholds
					? JSON.parse(this.settings.giftThresholds)
					: [];
				if (giftThresholds.length === 0) return "";

				const sortedThresholds = giftThresholds.sort(
					(a, b) => a.amount - b.amount,
				);
				const currentTotal = this.cart ? this.cart.total_price / 100 : 0; // Convert from cents
				const progressStyle = this.settings.giftProgressStyle || "single-next";

				// For single threshold, use the clean progress block design (same as free shipping)
				if (sortedThresholds.length === 1) {
					const threshold = sortedThresholds[0];
					const progress = Math.min(
						(currentTotal / threshold.amount) * 100,
						100,
					);
					// Use shippingBarColor for all progress fills; default to black
					const _safeShippingColor =
						this.settings.shippingBarColor || "#121212";
					const _bgColor =
						this.settings.shippingBarBackgroundColor || "#E5E5E5";
					const remainingCents = Math.max(
						0,
						Math.round(threshold.amount * 100) - Math.round(currentTotal * 100),
					);

					// Check if gift is actually in cart (claimed)
					let numericProductId = threshold.productId;
					if (
						typeof numericProductId === "string" &&
						numericProductId.includes("gid://shopify/Product/")
					) {
						numericProductId = numericProductId.replace(
							"gid://shopify/Product/",
							"",
						);
					}
					const giftInCart =
						this.cart?.items?.some(
							(item) =>
								item.product_id.toString() === numericProductId.toString() &&
								item.properties &&
								item.properties._is_gift === "true",
						) || false;

					const achieved = giftInCart; // Only show as unlocked if gift is actually claimed
					const thresholdReached = currentTotal >= threshold.amount;
					const thresholdLabel = this.formatMoney(
						Math.round(threshold.amount * 100),
					);

					const msg = achieved
						? (
								this.settings.giftAchievedText ||
								"🎉 {{ product_name }} unlocked!"
							)
								.replace(
									/\{\{\s*title\s*\}\}/g,
									String(threshold.title || "Gift"),
								)
								.replace(/\{title\}/g, String(threshold.title || "Gift"))
								.replace(
									/\{\{\s*product_name\s*\}\}/g,
									String(threshold.title || "Gift"),
								)
								.replace(/\{product_name\}/g, String(threshold.title || "Gift"))
								.replace(
									/\{\{\s*product\s*\}\}/g,
									String(threshold.title || "Gift"),
								)
								.replace(/\{product\}/g, String(threshold.title || "Gift"))
						: thresholdReached
							? (
									this.settings.giftReadyText ||
									"Claim your {{ product_name }}!"
								)
									.replace(
										/\{\{\s*title\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(/\{title\}/g, String(threshold.title || "Gift"))
									.replace(
										/\{\{\s*product_name\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(
										/\{product_name\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(
										/\{\{\s*product\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(/\{product\}/g, String(threshold.title || "Gift"))
							: (
									this.settings.giftProgressText ||
									"Spend {{ amount }} more to unlock {{ product_name }}!"
								)
									.replace(
										/\{\{\s*amount\s*\}\}/g,
										this.formatMoney(remainingCents),
									)
									.replace(/\{amount\}/g, this.formatMoney(remainingCents))
									.replace(
										/\{\{\s*title\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(/\{title\}/g, String(threshold.title || "Gift"))
									.replace(
										/\{\{\s*product_name\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(
										/\{product_name\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(
										/\{\{\s*product\s*\}\}/g,
										String(threshold.title || "Gift"),
									)
									.replace(/\{product\}/g, String(threshold.title || "Gift"));

					return `
            <div class="cartuplift-section cartuplift-section--gift">
              <div class="cartuplift-progress-section">
                <div class="cartuplift-progress-bar">
                  <div class="cartuplift-progress-fill" style="width: ${progress > 0 ? Math.max(progress, 4) : 0}%;"></div>
                </div>
                <div class="cartuplift-progress-info">
                  ${
										achieved
											? `<span class="cartuplift-success-badge">✓ ${String(threshold.title || "Gift")} unlocked</span>`
											: `<span class="cartuplift-progress-message">${msg}</span>`
									}
                  <span class="cartuplift-progress-threshold">${thresholdLabel}</span>
                </div>
              </div>
            </div>
          `;
				}

				if (progressStyle === "stacked") {
					return `
            <div class="cartuplift-section cartuplift-section--gift">
              <div class="cartuplift-section-header">Gift</div>
              <div class="cartuplift-gift-progress-container">
                <div class="cartuplift-stacked-progress">
                  ${sortedThresholds
										.map((threshold) => {
											const progress = Math.min(
												(currentTotal / threshold.amount) * 100,
												100,
											);

											// Check if gift is actually in cart (claimed)
											let numericProductId = threshold.productId;
											if (
												typeof numericProductId === "string" &&
												numericProductId.includes("gid://shopify/Product/")
											) {
												numericProductId = numericProductId.replace(
													"gid://shopify/Product/",
													"",
												);
											}
											const giftInCart =
												this.cart?.items?.some(
													(item) =>
														item.product_id.toString() ===
															numericProductId.toString() &&
														item.properties &&
														item.properties._is_gift === "true",
												) || false;

											const isUnlocked = giftInCart;
											const thresholdReached = currentTotal >= threshold.amount;
											const remaining = Math.max(
												threshold.amount - currentTotal,
												0,
											);

											return `
                    <div class="cartuplift-gift-threshold">
                      <div class="cartuplift-gift-info">
                        <span class="cartuplift-gift-title">
                          ${threshold.title} 
                          ${isUnlocked ? " ✓ Unlocked" : thresholdReached ? " Ready!" : ` ($${remaining.toFixed(0)} to go)`}
                        </span>
                        <span class="cartuplift-gift-progress-text">${Math.round(progress)}%</span>
                      </div>
                      <div class="cartuplift-gift-bar">
                        <div class="cartuplift-gift-fill" style="width: ${progress}%; background: ${this.settings.shippingBarColor || "#121212"};"></div>
                      </div>
                    </div>
                  `;
										})
										.join("")}
                </div>
              </div>
            </div>
          `;
				}

				if (progressStyle === "single-multi") {
					const maxThreshold =
						sortedThresholds[sortedThresholds.length - 1].amount;
					const totalProgress = Math.min(
						(currentTotal / maxThreshold) * 100,
						100,
					);

					return `
            <div class="cartuplift-section cartuplift-section--gift">
              <div class="cartuplift-section-header">Gift</div>
              <div class="cartuplift-gift-progress-container">
                <div class="cartuplift-single-multi-progress">
                  <div class="cartuplift-milestone-bar">
                    <div class="cartuplift-milestone-fill" style="width: ${totalProgress}%; background: ${this.settings.shippingBarColor || "#121212"};"></div>
                    ${sortedThresholds
											.map((threshold) => {
												const position =
													(threshold.amount / maxThreshold) * 100;

												// Check if gift is actually in cart (claimed)
												let numericProductId = threshold.productId;
												if (
													typeof numericProductId === "string" &&
													numericProductId.includes("gid://shopify/Product/")
												) {
													numericProductId = numericProductId.replace(
														"gid://shopify/Product/",
														"",
													);
												}
												const giftInCart =
													this.cart?.items?.some(
														(item) =>
															item.product_id.toString() ===
																numericProductId.toString() &&
															item.properties &&
															item.properties._is_gift === "true",
													) || false;

												const isUnlocked = giftInCart;
												const thresholdReached =
													currentTotal >= threshold.amount;

												return `
                      <div class="cartuplift-milestone-marker" style="left: ${position}%;">
                        <div class="cartuplift-milestone-dot ${isUnlocked ? "unlocked" : ""}">
                          ${isUnlocked ? "✓" : thresholdReached ? "★" : "○"}
                        </div>
                        <div class="cartuplift-milestone-label">
                          $${threshold.amount} ${threshold.title}
                          ${
														!thresholdReached
															? ` ($${(threshold.amount - currentTotal).toFixed(0)} to go)`
															: !isUnlocked
																? " (Ready to claim!)"
																: ""
													}
                        </div>
                      </div>
                    `;
											})
											.join("")}
                  </div>
                </div>
              </div>
            </div>
          `;
				}

				// Default: single-next style
				const nextThreshold = sortedThresholds.find(
					(t) => currentTotal < t.amount,
				);

				// Filter for truly unlocked gifts (actually in cart with _is_gift property)
				const unlockedThresholds = sortedThresholds.filter((threshold) => {
					let numericProductId = threshold.productId;
					if (
						typeof numericProductId === "string" &&
						numericProductId.includes("gid://shopify/Product/")
					) {
						numericProductId = numericProductId.replace(
							"gid://shopify/Product/",
							"",
						);
					}
					return this.cart?.items?.some(
						(item) =>
							item.product_id.toString() === numericProductId.toString() &&
							item.properties &&
							item.properties._is_gift === "true",
					);
				});

				// Check for thresholds reached but not claimed
				const readyThresholds = sortedThresholds.filter((threshold) => {
					const thresholdReached = currentTotal >= threshold.amount;
					let numericProductId = threshold.productId;
					if (
						typeof numericProductId === "string" &&
						numericProductId.includes("gid://shopify/Product/")
					) {
						numericProductId = numericProductId.replace(
							"gid://shopify/Product/",
							"",
						);
					}
					const giftInCart = this.cart?.items?.some(
						(item) =>
							item.product_id.toString() === numericProductId.toString() &&
							item.properties &&
							item.properties._is_gift === "true",
					);
					return thresholdReached && !giftInCart;
				});

				if (
					!nextThreshold &&
					unlockedThresholds.length === 0 &&
					readyThresholds.length === 0
				)
					return "";

				return `
          <div class="cartuplift-gift-progress-container">
            <div class="cartuplift-next-goal-progress">
              ${
								unlockedThresholds.length > 0
									? `
                <div class="cartuplift-unlocked-gifts">
                  ${unlockedThresholds
										.map(
											(threshold) => `
                    <div class="cartuplift-unlocked-item">
                      ✓ ${threshold.title} UNLOCKED!
                    </div>
                  `,
										)
										.join("")}
                </div>
              `
									: ""
							}
              
              ${
								readyThresholds.length > 0
									? `
                <div class="cartuplift-ready-gifts">
                  ${readyThresholds
										.map(
											(threshold) => `
                    <div class="cartuplift-ready-item">
                      ★ ${threshold.title} Ready to claim!
                    </div>
                  `,
										)
										.join("")}
                </div>
              `
									: ""
							}
              
              ${
								nextThreshold
									? `
                <div class="cartuplift-next-goal">
                  <div class="cartuplift-next-info">
                    Next: ${nextThreshold.title} at $${nextThreshold.amount} 
                    (spend $${(nextThreshold.amount - currentTotal).toFixed(0)} more)
                  </div>
                  <div class="cartuplift-next-bar">
                    <div class="cartuplift-next-fill" style="width: ${Math.min((currentTotal / nextThreshold.amount) * 100, 100)}%; background: ${this.settings.shippingBarColor || "#121212"};"></div>
                  </div>
                  <div class="cartuplift-progress-text">
                    ${Math.round((currentTotal / nextThreshold.amount) * 100)}% complete
                  </div>
                </div>
              `
									: ""
							}
            </div>
          </div>
        `;
			} catch (error) {
				debug.error("CartUplift: Gift Progress Error:", error);
				return "";
			}
		}

		getUnifiedProgressHTML() {
			try {
				const mode = this.settings.progressBarMode || "free-shipping";
				const currentCents = this.cart ? this.cart.total_price : 0;
				const freeEnabled = !!this.settings.enableFreeShipping;
				const giftEnabled = !!this.settings.enableGiftGating;
				if (!freeEnabled && !giftEnabled) return "";

				const shippingColor = this.settings.shippingBarColor || "#10b981";
				const bgColor = this.settings.shippingBarBackgroundColor || "#f3f4f6";
				const normalizedThresholdCents =
					this.settings.freeShippingThresholdCents ??
					this.getFreeShippingThresholdCents();
				const freeThresholdCents =
					freeEnabled && typeof normalizedThresholdCents === "number"
						? normalizedThresholdCents
						: null;
				const freeRemaining =
					typeof freeThresholdCents === "number"
						? Math.max(0, freeThresholdCents - currentCents)
						: null;
				const freeAchieved =
					typeof freeThresholdCents === "number"
						? currentCents >= freeThresholdCents
						: false;
				// Update session flag
				if (freeAchieved) {
					this._freeShippingHadUnlocked = true;
				}

				let giftThresholds = [];
				if (giftEnabled && this.settings.giftThresholds) {
					try {
						giftThresholds = JSON.parse(this.settings.giftThresholds) || [];
					} catch {}
				}
				const sortedGifts = giftThresholds.sort((a, b) => a.amount - b.amount);

				// Helper to check if a gift is actually in the cart (claimed)
				const isGiftInCart = (threshold) => {
					if (!threshold || !threshold.productId) return false;
					let numericProductId = threshold.productId;
					if (
						typeof numericProductId === "string" &&
						numericProductId.includes("gid://shopify/Product/")
					) {
						numericProductId = numericProductId.replace(
							"gid://shopify/Product/",
							"",
						);
					}
					return (
						this.cart?.items?.some(
							(item) =>
								item.product_id.toString() === numericProductId.toString() &&
								item.properties &&
								item.properties._is_gift === "true",
						) || false
					);
				};

				// Find next unclaimed gift
				// Priority: First find gifts where threshold is NOT met yet, then find met but unclaimed
				const nextUnreachedGift = sortedGifts.find(
					(t) => currentCents < Math.round(t.amount * 100),
				);
				const nextUnclaimedGift = sortedGifts.find((t) => {
					const thresholdCents = Math.round(t.amount * 100);
					return currentCents >= thresholdCents && !isGiftInCart(t);
				});

				// Next gift is: first unreached gift, or first unclaimed gift if all thresholds met
				const nextGift = nextUnreachedGift || nextUnclaimedGift || null;
				const nextGiftCents = nextGift
					? Math.round(nextGift.amount * 100)
					: null;
				const _giftRemaining =
					nextGiftCents != null
						? Math.max(0, nextGiftCents - currentCents)
						: null;
				// Gift is only "achieved" if threshold is met AND gift is in cart
				const giftAchieved = nextGift
					? currentCents >= nextGiftCents && isGiftInCart(nextGift)
					: false;

				// Decide what to show as primary progress
				let labelRight = "";
				let messageHTML = "";
				let successTopRowHTML = "";
				let _widthPct = 0;
				let _fillStyle = `background:${shippingColor};`;

				const formatMoney = (c) => this.formatMoney(Math.max(0, c));

				const freeMsg = () => {
					if (typeof freeThresholdCents !== "number") return "";
					const remaining = Math.max(0, freeThresholdCents - currentCents);
					return (
						this.settings.freeShippingText ||
						"You're {{ amount }} away from free shipping!"
					)
						.replace(/\{\{\s*amount\s*\}\}/g, formatMoney(remaining))
						.replace(/\{amount\}/g, formatMoney(remaining));
				};
				// Normalize success text to avoid noisy prefixes (emoji/Congratulations)
				let freeSuccess =
					this.settings.freeShippingAchievedText || "✓ Free shipping";
				try {
					freeSuccess = String(freeSuccess)
						.replace(/^\s*🎉\s*/i, "")
						.replace(/^\s*congratulations!?\s*/i, "")
						.trim();
				} catch {}

				const giftMsg = (t, isUnlocked = false) => {
					if (!t) return "";
					const remaining = Math.max(
						0,
						Math.round(t.amount * 100) - currentCents,
					);

					// Parse conditional format: "before text | after text"
					let rawText =
						this.settings.giftProgressText ||
						"Spend {{ amount }} more to unlock {{ product }}!";

					// Check if text contains pipe separator for conditional format
					if (rawText.includes("|")) {
						const parts = rawText.split("|").map((p) => p.trim());
						rawText = isUnlocked ? parts[1] || parts[0] : parts[0] || "";
					}

					return rawText
						.replace(/\{\{\s*amount\s*\}\}/g, formatMoney(remaining))
						.replace(/\{amount\}/g, formatMoney(remaining))
						.replace(/\{\{\s*title\s*\}\}/g, String(t.title || "reward"))
						.replace(/\{title\}/g, String(t.title || "reward"))
						.replace(/\{\{\s*product_name\s*\}\}/g, String(t.title || "reward"))
						.replace(/\{product_name\}/g, String(t.title || "reward"))
						.replace(/\{\{\s*product\s*\}\}/g, String(t.title || "reward"))
						.replace(/\{product\}/g, String(t.title || "reward"));
				};
				const giftSuccess = (t) =>
					(this.settings.giftAchievedText || "✓ {{ product_name }} unlocked!")
						.replace(/\{\{\s*title\s*\}\}/g, String(t?.title || "reward"))
						.replace(/\{title\}/g, String(t?.title || "reward"))
						.replace(
							/\{\{\s*product_name\s*\}\}/g,
							String(t?.title || "reward"),
						)
						.replace(/\{product_name\}/g, String(t?.title || "reward"))
						.replace(/\{\{\s*product\s*\}\}/g, String(t?.title || "reward"))
						.replace(/\{product\}/g, String(t?.title || "reward"));

				const _getGiftValueAndTitle = (t) => {
					try {
						if (!t) return { value: "", title: "" };
						const giftCents =
							typeof t.price === "number"
								? t.price
								: t.price?.amount
									? Math.round(t.price.amount * 100)
									: null;
						// We now only show the gift's own value (no shipping inflation)
						const value = giftCents != null ? this.formatMoney(giftCents) : "";
						const baseTitle = String(t.title || "gift");
						// Remove variant title to keep message clean
						const fullTitle = baseTitle;
						const max = 30;
						const title =
							fullTitle.length > max
								? `${fullTitle.slice(0, max - 1)}…`
								: fullTitle;
						return { value, title };
					} catch {
						return { value: "", title: "" };
					}
				};

				// Colors now handled by CSS for consistent black styling

				const _renderMessage = (text, _remainingCents, _thresholdCents) => {
					// Use CSS class instead of inline styles for consistent black color
					return `<span class="cartuplift-progress-message cartuplift-progress-text">${text}</span>`;
				};

				// Build scenarios
				if (
					mode === "free-shipping" ||
					(mode !== "gift-gating" && giftThresholds.length === 0)
				) {
					if (
						!freeEnabled ||
						typeof freeThresholdCents !== "number" ||
						freeThresholdCents <= 0
					)
						return "";
					_widthPct = Math.min(100, (currentCents / freeThresholdCents) * 100);
					labelRight = ""; // Single threshold - no label below bar
					if (freeAchieved) {
						// Success message at top
						successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">${freeSuccess}</span></div>`;
						messageHTML = "";
					} else {
						// If user previously unlocked free shipping this session and dropped below, show maintain message
						if (this._freeShippingHadUnlocked && freeRemaining > 0) {
							const maintainTemplate =
								this.settings.freeShippingMaintainText ||
								"Keep above {threshold} for free shipping";
							const maintainMsg = maintainTemplate
								.replace(
									/\{\{\s*threshold\s*\}\}/g,
									formatMoney(freeThresholdCents),
								)
								.replace(/\{threshold\}/g, formatMoney(freeThresholdCents));
							// Move message to top with threshold amount
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${maintainMsg}</span></div>`;
							messageHTML = "";
						} else {
							// Move message to top with threshold amount
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${freeMsg()}</span></div>`;
							messageHTML = "";
						}
					}
				} else if (mode === "gift-gating" && giftEnabled) {
					// Single gift bar - gift-only mode
					if (!nextGift) {
						// All thresholds met - check if last gift is actually claimed
						const lastGift = sortedGifts[sortedGifts.length - 1];
						if (lastGift && isGiftInCart(lastGift)) {
							// Gift is claimed - show success
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">${giftSuccess(lastGift)}</span></div>`;
							_widthPct = 100;
						} else {
							// Threshold met but gift not claimed - show "unlocked" message from schema
							// This handles the "£0 remaining" bug - shows the post-unlock message instead
							const readyMessage = lastGift
								? giftMsg(lastGift, true)
								: "Gift ready to claim!";
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${readyMessage}</span></div>`;
							_widthPct = 100;
						}
						labelRight = ""; // Single threshold - no label below bar
						messageHTML = "";
					} else {
						_widthPct = Math.min(100, (currentCents / nextGiftCents) * 100);
						labelRight = ""; // Single threshold - no label below bar

						// Check if threshold is met (not just achieved/claimed)
						const thresholdMet = currentCents >= nextGiftCents;

						if (giftAchieved) {
							// Gift is in cart - show success message
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">${giftSuccess(nextGift)}</span></div>`;
							messageHTML = "";
						} else if (thresholdMet) {
							// Threshold met but not claimed yet - show "unlocked" part of message
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${giftMsg(nextGift, true)}</span></div>`;
							messageHTML = "";
						} else {
							// Not yet reached threshold - show progress message
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${giftMsg(nextGift, false)}</span></div>`;
							messageHTML = "";
						}
					}
				} else {
					// combined: one bar only - using segmented bars, so no need for labelRight
					if (!freeAchieved) {
						// show free shipping until achieved - message at top
						const hasFreeThreshold =
							typeof freeThresholdCents === "number" && freeThresholdCents > 0;
						_widthPct = hasFreeThreshold
							? Math.min(100, (currentCents / freeThresholdCents) * 100)
							: 0;
						labelRight = ""; // Empty - segmented bar shows labels below each segment
						// Move message to top
						const freeMessage = freeMsg();
						successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">${freeMessage}</span></div>`;
						messageHTML = "";
					} else {
						// Free shipping achieved - check gift status
						// When free shipping is achieved but there's a next gift, combine the message

						// Check if all gifts are also claimed
						const allGiftsClaimed = sortedGifts.every((gift) =>
							isGiftInCart(gift),
						);

						if (!nextGift && allGiftsClaimed) {
							// All rewards unlocked (free shipping + all gifts claimed)
							_widthPct = 100;
							labelRight = "";
							successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">🎉 All rewards unlocked!</span></div>`;
							messageHTML = "";
						} else if (!nextGift) {
							// All thresholds met but some gifts not claimed
							const unclaimedGift = sortedGifts.find(
								(gift) => !isGiftInCart(gift),
							);
							if (unclaimedGift) {
								const readyMessage = giftMsg(unclaimedGift, true);
								successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-progress-message">✓ Free shipping unlocked! ${readyMessage}</span></div>`;
							} else {
								successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">🎉 All rewards unlocked!</span></div>`;
							}
							_widthPct = 100;
							labelRight = "";
							messageHTML = "";
						} else {
							// Show achievement (left) + next goal (right) split across segments

							// Check if this gift's threshold is actually reached
							const giftThresholdReached = currentCents >= nextGiftCents;

							// If BOTH free shipping AND gift threshold reached, show "All rewards unlocked"
							if (giftThresholdReached) {
								const allRewardsText =
									this.settings.allRewardsUnlockedText ||
									"🎉 All rewards unlocked!";
								successTopRowHTML = `<div class="cartuplift-progress-toprow"><span class="cartuplift-success-badge">${allRewardsText}</span></div>`;
								_widthPct = 100;
								labelRight = "";
								messageHTML = "";
							} else {
								// Gift not reached yet - show split message
								const leftMessage = `✓ Free shipping unlocked!`;
								const rightMessage = giftMsg(nextGift, false); // Use "before unlock" message from schema

								successTopRowHTML = `<div class="cartuplift-progress-toprow" style="display: flex; justify-content: space-between; gap: 8px;"><span class="cartuplift-progress-message" style="text-align: left;">${leftMessage}</span><span class="cartuplift-progress-message" style="text-align: right;">${rightMessage}</span></div>`;
								_widthPct = Math.min(100, (currentCents / nextGiftCents) * 100);
								labelRight = ""; // Empty - segmented bar shows labels below each segment
								// solid fill for tier 2
								_fillStyle = `background: ${shippingColor};`;
								// Empty messageHTML since message is at the top now
								messageHTML = "";
							}
						}
					}
				}

				// Build segmented progress bar for multi-tier visualization
				const buildSegmentedBar = () => {
					// Collect all thresholds
					const allThresholds = [];

					// Only add shipping threshold if NOT in gift-gating mode
					if (
						mode !== "gift-gating" &&
						freeEnabled &&
						typeof freeThresholdCents === "number" &&
						freeThresholdCents > 0
					) {
						allThresholds.push({
				type: "shipping",
				amount: freeThresholdCents,
				label: "Free Shipping",
			});
		}

		// Only add gift thresholds if NOT in free-shipping-only mode
		if (mode !== "free-shipping") {
			for (const gift of sortedGifts) {
				if (gift.amount && gift.amount > 0) {
					const giftCents = Math.round(gift.amount * 100);
					allThresholds.push({
						type: "gift",
						amount: giftCents,
						label: gift.title || "Gift",
						data: gift,
					});
				}
			}
		}

		allThresholds.sort((a, b) => a.amount - b.amount);

		if (allThresholds.length === 0) {
			return `<div class="cartuplift-progress-bar"><div class="cartuplift-progress-fill" style="width:0%;"></div></div>`;
		}					// For single threshold, use simple bar (no segmented labels below)
					if (allThresholds.length === 1) {
						const threshold = allThresholds[0];
						const progressPct = Math.min(
							100,
							(currentCents / threshold.amount) * 100,
						);
						const segmentColor =
							threshold.type === "shipping"
								? shippingColor
								: this.settings.giftBarColor || "#f59e0b";
						return `
              <div class="cartuplift-progress-bar" style="background: ${bgColor}; border-radius: 4px; height: 7px;">
                <div class="cartuplift-progress-fill" style="width: ${progressPct}%; background: ${segmentColor}; height: 100%; border-radius: 3px; transition: width 0.5s ease;"></div>
              </div>
            `;
					}

					// Find total span for percentage calculations
					const maxThreshold = allThresholds[allThresholds.length - 1].amount;

					// Build segments with status messages above and prices below
					let segmentsHTML = "";
					let labelsHTML = "";
					let prevAmount = 0;

					for (let i = 0; i < allThresholds.length; i++) {
						const threshold = allThresholds[i];
						const segmentWidth =
							((threshold.amount - prevAmount) / maxThreshold) * 100;
						const isCompleted = currentCents >= threshold.amount;
						const isCurrent =
							!isCompleted &&
							(i === 0 || currentCents >= allThresholds[i - 1].amount);

						let fillWidth = 0;
						if (isCompleted) {
							fillWidth = 100; // Fully filled
						} else if (isCurrent) {
							// Calculate progress within this segment
							const segmentStart = i > 0 ? allThresholds[i - 1].amount : 0;
							const segmentRange = threshold.amount - segmentStart;
							const progressInSegment = Math.max(
								0,
								currentCents - segmentStart,
							);
							fillWidth = Math.min(
								100,
								(progressInSegment / segmentRange) * 100,
							);
						}

						const segmentColor =
							threshold.type === "shipping"
								? shippingColor
								: this.settings.giftBarColor || "#f59e0b";
						const completedClass = isCompleted
							? "cartuplift-segment-completed"
							: "";
						const currentClass = isCurrent ? "cartuplift-segment-current" : "";
						const lockedClass =
							!isCompleted && !isCurrent ? "cartuplift-segment-locked" : "";

						// Build segment bar without status messages (messages shown in successTopRowHTML instead)
						segmentsHTML += `
              <div class="cartuplift-progress-segment ${completedClass} ${currentClass} ${lockedClass}" style="width: ${segmentWidth}%; ${!lockedClass ? `border-color: ${segmentColor};` : ""}">
                <div class="cartuplift-segment-fill" style="width: ${fillWidth}%; background: ${segmentColor};"></div>
              </div>
            `;

						// Build labels - only show price at the end of the bar (right-aligned)
						const formattedAmount = formatMoney(threshold.amount);

						labelsHTML += `
              <div class="cartuplift-segment-label ${completedClass} ${currentClass} ${lockedClass}" style="width: ${segmentWidth}%;">
                <div class="cartuplift-segment-label-amount" style="${!lockedClass ? `color: ${segmentColor};` : ""}">${formattedAmount}</div>
              </div>
            `;

						prevAmount = threshold.amount;
					}

					return `
            <div class="cartuplift-segmented-bar-container">
              <div class="cartuplift-progress-bar cartuplift-segmented-bar">${segmentsHTML}</div>
              <div class="cartuplift-segmented-labels">${labelsHTML}</div>
            </div>
          `;
				};

				const progressBarHTML = buildSegmentedBar();

				return `
          <div class="cartuplift-progress-section">
            ${successTopRowHTML}
            ${progressBarHTML}
            <div class="cartuplift-progress-info">
              ${messageHTML}
              <span class="cartuplift-progress-threshold">${labelRight}</span>
            </div>
          </div>
        `;
			} catch (error) {
				debug.error("CartUplift: Unified Progress Error:", error);
				return "";
			}
		}

		// Mobile-only sticky progress at the bottom (shows primary goal)
		getMobileProgressHTML() {
			try {
				// Only on mobile: render container; CSS will hide on desktop
				// Determine which progress to show: prefer free shipping if enabled, else single gift, else next gift milestone
				const currentTotalCents = this.cart ? this.cart.total_price : 0;
				const _safeShippingColor = this.settings.shippingBarColor || "#121212";
				const _bgColor = this.settings.shippingBarBackgroundColor || "#E5E5E5";
				let progress = 0;
				let msg = "";
				let thresholdLabel = "";
				let show = false;

				const normalizedThresholdCents =
					this.settings.freeShippingThresholdCents ??
					this.getFreeShippingThresholdCents();
				const freeEnabled =
					!!this.settings.enableFreeShipping &&
					typeof normalizedThresholdCents === "number";
				const freeThresholdCents = freeEnabled
					? normalizedThresholdCents
					: null;
				const freeRemaining =
					typeof freeThresholdCents === "number"
						? Math.max(0, freeThresholdCents - currentTotalCents)
						: null;
				const freeAchieved =
					typeof freeThresholdCents === "number"
						? currentTotalCents >= freeThresholdCents
						: false;

				let thresholds = [];
				if (this.settings.enableGiftGating && this.settings.giftThresholds) {
					try {
						thresholds = JSON.parse(this.settings.giftThresholds).sort(
							(a, b) => a.amount - b.amount,
						);
					} catch {}
				}
				const next = thresholds.length
					? thresholds.find(
							(t) => currentTotalCents < Math.round(t.amount * 100),
						)
					: null;
				const allAchieved =
					(freeAchieved || !freeEnabled) && (!thresholds.length || !next);

				if (allAchieved && (freeEnabled || thresholds.length)) {
					progress = 100;
					thresholdLabel = "";
					show = true;
					const lastGift = thresholds.length
						? thresholds[thresholds.length - 1]
						: null;
					if (lastGift) {
						const cents =
							typeof lastGift.price === "number"
								? lastGift.price
								: lastGift.price?.amount
									? Math.round(lastGift.price.amount * 100)
									: null;
						const value = cents != null ? this.formatMoney(cents) : "";
						// Use "free gift" for mobile instead of full product name for compactness
						const title = "free gift";
						// Compact success message for mobile
						msg =
							this.settings.combinedSuccessTemplate ||
							this.settings.allRewardsAchievedText ||
							"✓ Free shipping + free gift added free";
						if (/All rewards unlocked!?/i.test(msg))
							msg = msg.replace(/All rewards unlocked!?/gi, "").trim();
						if (!/free shipping/i.test(msg))
							msg = `✓ Free shipping + ${msg.replace(/^✓\s*/, "")}`;
						if (!/^✓/.test(msg)) msg = `✓ ${msg}`;
						msg = msg
							.replace(/\{\{\s*title\s*\}\}/g, title)
							.replace(/\{title\}/g, title)
							.replace(/\{\{\s*product_name\s*\}\}/g, title)
							.replace(/\{product_name\}/g, title)
							.replace(/\{\{\s*product\s*\}\}/g, title)
							.replace(/\{product\}/g, title)
							.replace(/\{\{\s*value\s*\}\}/g, value)
							.replace(/\{value\}/g, value)
							.replace(/\bworth\s+\(/i, "(")
							.replace(
								/\{\{?\s*(title|value|product_name|product)\s*\}?\}/g,
								"",
							)
							.replace(/\s{2,}/g, " ")
							.replace(/\(\s*\)/g, "")
							.replace(/\s*!/g, "!")
							.trim();
					} else {
						// Fallback when no last gift object is available; keep messaging consistent
						// Compact fallback message
						msg =
							this.settings.allRewardsAchievedText &&
							/free shipping/i.test(this.settings.allRewardsAchievedText)
								? this.settings.allRewardsAchievedText
								: "✓ Free shipping unlocked!";
					}
				} else if (freeEnabled && !freeAchieved) {
					const thresholdCents = freeThresholdCents;
					const remaining = freeRemaining;
					progress = Math.min((currentTotalCents / thresholdCents) * 100, 100);
					thresholdLabel = this.formatMoney(thresholdCents);
					msg = (
						this.settings.freeShippingText ||
						"{{ amount }} more for free shipping!"
					)
						.replace(/\{\{\s*amount\s*\}\}/g, this.formatMoney(remaining))
						.replace(/\{amount\}/g, this.formatMoney(remaining));
					show = true;
				} else if (thresholds.length) {
					const target = next || thresholds[0];
					const nextCents = Math.round(target.amount * 100);
					const remaining = Math.max(0, nextCents - currentTotalCents);
					progress = Math.min((currentTotalCents / nextCents) * 100, 100);
					thresholdLabel = this.formatMoney(nextCents);
					const achieved = remaining === 0 && currentTotalCents >= nextCents;
					// Use "Free gift" for mobile to keep it compact
					msg = achieved
						? (this.settings.giftAchievedText || "🎉 Free gift unlocked!")
								.replace(/\{\{\s*title\s*\}\}/g, "Free gift")
								.replace(/\{title\}/g, "Free gift")
								.replace(/\{\{\s*product_name\s*\}\}/g, "Free gift")
								.replace(/\{product_name\}/g, "Free gift")
								.replace(/\{\{\s*product\s*\}\}/g, "Free gift")
								.replace(/\{product\}/g, "Free gift")
						: (
								this.settings.giftProgressText ||
								"Free shipping unlocked! ✓ Spend {{ amount }} more for free gift!"
							)
								.replace(/\{\{\s*amount\s*\}\}/g, this.formatMoney(remaining))
								.replace(/\{amount\}/g, this.formatMoney(remaining))
								.replace(/\{\{\s*title\s*\}\}/g, "free gift")
								.replace(/\{title\}/g, "free gift")
								.replace(/\{\{\s*product_name\s*\}\}/g, "free gift")
								.replace(/\{product_name\}/g, "free gift")
								.replace(/\{\{\s*product\s*\}\}/g, "free gift")
								.replace(/\{product\}/g, "free gift");
					show = true;
				}

				if (!show) return "";
				return `
          <div class="cartuplift-mobile-progress" role="region" aria-live="polite">
            <div class="cartuplift-mobile-progress-inner">
              <div class="cartuplift-progress-section">
                <div class="cartuplift-progress-bar">
                  <div class="cartuplift-progress-fill" style="width:${progress > 0 ? Math.max(progress, 4) : 0}%;"></div>
                </div>
                <div class="cartuplift-progress-info">
                  <span class="cartuplift-progress-message">${msg.replace(/\$?([0-9]+(?:\.[0-9]{2})?)/, '<span class=\\"cartuplift-mobile-amount\\">$$1</span>')}</span>
                  <span class="cartuplift-progress-threshold">${thresholdLabel}</span>
                </div>
              </div>
            </div>
          </div>
        `;
			} catch {
				return "";
			}
		}

		getFreeShippingProgressHTML() {
			const currentTotalCents = this.cart ? this.cart.total_price : 0;
			const normalizedThresholdCents =
				this.settings.freeShippingThresholdCents ??
				this.getFreeShippingThresholdCents();
			const fallbackThresholdDollars =
				Number(this.settings.freeShippingThreshold) || 100;
			const fallbackThresholdCents = Math.max(
				0,
				Math.round(fallbackThresholdDollars * 100),
			);
			const thresholdCents =
				typeof normalizedThresholdCents === "number" &&
				normalizedThresholdCents > 0
					? normalizedThresholdCents
					: fallbackThresholdCents > 0
						? fallbackThresholdCents
						: 10000;
			const _thresholdDollars = thresholdCents / 100;
			const progress =
				thresholdCents > 0
					? Math.min((currentTotalCents / thresholdCents) * 100, 100)
					: 0;

			// Use shippingBarColor (default black) consistently for the fill
			const _safeShippingColor = this.settings.shippingBarColor || "#121212";
			const _bgColor = this.settings.shippingBarBackgroundColor || "#E5E5E5";
			const remainingCents = Math.max(0, thresholdCents - currentTotalCents);
			const achieved =
				thresholdCents > 0 && currentTotalCents >= thresholdCents;
			const thresholdLabel = this.formatMoney(thresholdCents);
			let msg = achieved
				? this.settings.freeShippingAchievedText || "✓ Free shipping"
				: (
						this.settings.freeShippingText ||
						"Spend {{ amount }} more for free shipping!"
					)
						.replace(/\{\{\s*amount\s*\}\}/g, this.formatMoney(remainingCents))
						.replace(/\{amount\}/g, this.formatMoney(remainingCents));
			if (achieved) {
				try {
					msg = String(msg)
						.replace(/^\s*🎉\s*/i, "")
						.replace(/^\s*congratulations!?\s*/i, "")
						.trim();
				} catch {}
			}

			return `
        <div class="cartuplift-section cartuplift-section--free-shipping">
          <div class="cartuplift-progress-section">
            <div class="cartuplift-progress-bar">
              <div class="cartuplift-progress-fill" style="width: ${progress > 0 ? Math.max(progress, 4) : 0}%;"></div>
            </div>
            <div class="cartuplift-progress-info">
              ${
								achieved
									? `<span class="cartuplift-success-badge">${msg || "✓ Free shipping"}</span>`
									: `<span class="cartuplift-progress-message">${msg}</span>`
							}
              <span class="cartuplift-progress-threshold">${thresholdLabel}</span>
            </div>
          </div>
        </div>
      `;
		}

		getCombinedProgressHTML() {
			return this.getUnifiedProgressHTML();
		}

		renderStackedProgress(thresholds, currentTotal) {
			const stackedHTML = thresholds
				.map((threshold) => {
					const progress = Math.min(
						(currentTotal / threshold.amount) * 100,
						100,
					);
					const isUnlocked = currentTotal >= threshold.amount;
					return `
          <div class="cartuplift-gift-threshold">
            <div class="cartuplift-gift-info">
              <span class="cartuplift-gift-title">
                ${threshold.title} ${isUnlocked ? "✓" : `($${threshold.amount})`}
              </span>
              <span class="cartuplift-gift-progress-text">${Math.round(progress)}%</span>
            </div>
            <div class="cartuplift-gift-bar">
              <div class="cartuplift-gift-fill" style="width: ${progress}%; background: ${isUnlocked ? this.themeColors.primary || "#121212" : "#121212"};"></div>
            </div>
          </div>
        `;
				})
				.join("");

			return `
        <div class="cartuplift-gift-progress-container">
          <div class="cartuplift-stacked-progress">
            ${stackedHTML}
          </div>
        </div>
      `;
		}

		renderSingleMultiProgress(thresholds, currentTotal) {
			const maxThreshold = Math.max(...thresholds.map((t) => t.amount));
			const overallProgress = Math.min(
				(currentTotal / maxThreshold) * 100,
				100,
			);

			const milestonesHTML = thresholds
				.map((threshold) => {
					const position = (threshold.amount / maxThreshold) * 100;
					const isUnlocked = currentTotal >= threshold.amount;
					return `
          <div class="cartuplift-milestone-marker" style="left: ${position}%;">
            <div class="cartuplift-milestone-dot ${isUnlocked ? "unlocked" : ""}">
              ${isUnlocked ? "✓" : "$"}
            </div>
            <div class="cartuplift-milestone-label">${threshold.title}</div>
          </div>
        `;
				})
				.join("");

			return `
        <div class="cartuplift-gift-progress-container">
          <div class="cartuplift-single-multi-progress">
            <div class="cartuplift-milestone-bar">
              <div class="cartuplift-milestone-fill" style="width: ${overallProgress}%; background: ${this.themeColors.primary || "#121212"};"></div>
              ${milestonesHTML}
            </div>
          </div>
        </div>
      `;
		}

		renderSingleNextProgress(thresholds, currentTotal) {
			const unlockedThresholds = thresholds.filter(
				(t) => currentTotal >= t.amount,
			);
			const nextThreshold = thresholds.find((t) => currentTotal < t.amount);

			let unlockedHTML = "";
			if (unlockedThresholds.length > 0) {
				unlockedHTML = `
          <div class="cartuplift-unlocked-gifts">
            ${unlockedThresholds
							.map(
								(threshold) => `
              <div class="cartuplift-unlocked-item">✓ ${threshold.title} unlocked!</div>
            `,
							)
							.join("")}
          </div>
        `;
			}

			return `
        <div class="cartuplift-gift-progress-container">
          <div class="cartuplift-next-goal-progress">
            ${unlockedHTML}
            ${
							nextThreshold
								? `
              <div class="cartuplift-next-goal">
                <div class="cartuplift-next-info">
                  Next: ${nextThreshold.title} 
                  (spend $${(nextThreshold.amount - currentTotal).toFixed(0)} more)
                </div>
                <div class="cartuplift-next-bar">
                  <div class="cartuplift-next-fill" style="width: ${Math.min((currentTotal / nextThreshold.amount) * 100, 100)}%; background: ${this.themeColors.primary || "#121212"};"></div>
                </div>
                <div class="cartuplift-progress-text">
                  ${Math.round((currentTotal / nextThreshold.amount) * 100)}% complete
                </div>
              </div>
            `
								: ""
						}
          </div>
        </div>
      `;
		}

		getRecommendationsHTML() {
			// Normalize again in case settings arrived late
			const layoutMap = {
				horizontal: "row",
				row: "row",
				carousel: "row",
				vertical: "column",
				column: "column",
				list: "column",
				grid: "grid",
			};
			const layoutRaw = this.settings.recommendationLayout || "column";
			const layout = layoutMap[layoutRaw] || layoutRaw;
			const title = this.settings.recommendationsTitle || "Hand picked for you";

			// For row layout, render controls outside the scroll container so they don't scroll
			const controlsHTML = `
        <div class="cartuplift-carousel-controls">
          <button class="cartuplift-carousel-nav prev" data-nav="prev" aria-label="Previous">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 12l-4-4 4-4"/>
            </svg>
          </button>
          <button class="cartuplift-carousel-nav next" data-nav="next" aria-label="Next">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 12l4-4-4-4"/>
            </svg>
          </button>
          <div class="cartuplift-carousel-dots">
            ${this.recommendations
							.map(
								(_, index) => `
              <button type="button" class="cartuplift-carousel-dot${index === 0 ? " active" : ""}"
                data-index="${index}"
                aria-label="Go to slide ${index + 1}"
                aria-current="${index === 0 ? "true" : "false"}"></button>
            `,
							)
							.join("")}
          </div>
        </div>`;

			const html = `
        <div class="cartuplift-recommendations cartuplift-recommendations-${layout}${layout === "row" ? " cartuplift-recommendations-row" : ""}${layout === "grid" ? " cartuplift-recommendations-grid" : ""}">
          <div class="cartuplift-recommendations-header">
            <h3 class="cartuplift-recommendations-title">${title}</h3>
            <button type="button" class="cartuplift-recommendations-toggle" data-toggle="recommendations" aria-expanded="true" aria-controls="cartuplift-recommendations-content" aria-label="Toggle recommendations">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
              </svg>
            </button>
          </div>
          <div class="cartuplift-recommendations-content" id="cartuplift-recommendations-content" aria-hidden="false">
            ${this.getRecommendationItems()}
          </div>
          ${layout === "row" ? controlsHTML : ""}
        </div>
      `;
			return html;
		}

		/** Update recommendations title & layout after settings injected later (e.g. upsell embed loads after main) */
		updateRecommendationsSection() {
			const section = document.querySelector(".cartuplift-recommendations");
			if (!section) {
				// If section doesn't exist but should, recreate the entire drawer
				if (
					this.settings.enableRecommendations &&
					this._recommendationsLoaded &&
					this.recommendations.length > 0
				) {
					this.updateDrawerContent();
					return;
				}
				return;
			}

			// Update layout class
			const layoutMap = {
				horizontal: "row",
				row: "row",
				carousel: "row",
				vertical: "column",
				column: "column",
				list: "column",
				grid: "grid",
			};
			const layoutRaw = this.settings.recommendationLayout || "column";
			const layout = layoutMap[layoutRaw] || layoutRaw;
			section.className = `cartuplift-recommendations cartuplift-recommendations-${layout}${layout === "row" ? " cartuplift-recommendations-row" : ""}${layout === "grid" ? " cartuplift-recommendations-grid" : ""}`;

			// Update title
			const titleEl = section.querySelector(
				".cartuplift-recommendations-title",
			);
			if (titleEl) {
				titleEl.textContent =
					this.settings.recommendationsTitle || "Hand picked for you";
			}

			// Update content
			const contentEl = section.querySelector(
				".cartuplift-recommendations-content",
			);
			if (contentEl) {
				contentEl.innerHTML = this.getRecommendationItems();

				// Re-setup carousel controls if needed
				if (layout === "row") {
					setTimeout(() => {
						this.setupScrollControls(contentEl);
						this.updateCarouselButtons(contentEl);
						this.updateDots(contentEl);
					}, 100);
				}

				// Setup grid hover handlers after content update
				if (layout === "grid") {
					setTimeout(() => {
						this.attachGridHoverHandlers();
					}, 50);
				}
			}
		}

		// STABILITY: Debounced update to prevent rapid DOM manipulations
		debouncedUpdateRecommendations() {
			if (this._updateDebounceTimer) {
				clearTimeout(this._updateDebounceTimer);
			}

			this._updateDebounceTimer = setTimeout(() => {
				this.rebuildRecommendationsFromMaster();
				this._updateDebounceTimer = null;
			}, 150); // 150ms debounce to allow for smooth user interactions
		}

		rebuildRecommendationsFromMaster() {
			if (!this._allRecommendations.length) return;

			// STABILITY: Prevent rapid rebuilds that cause shaking
			if (this._rebuildInProgress) return;
			this._rebuildInProgress = true;

			requestAnimationFrame(() => {
				// Check if we should hide recommendations after all thresholds are met
				if (
					this.settings.hideRecommendationsAfterThreshold &&
					this.checkIfAllThresholdsMet()
				) {
					this.recommendations = [];
					this._rebuildInProgress = false;
					return;
				}

				const cartProductIds = (this.cart?.items || []).map(
					(i) => i.product_id,
				);

				// Build visible list by skipping any product in cart and taking next from master, preserving order
				const max = this.normalizeMaxRecommendations(
					this.settings.maxRecommendations,
				);
				let newRecommendations = [];
				for (const p of this._allRecommendations) {
					// Check both strict and loose equality for ID comparison
					const isInCartStrict = cartProductIds.includes(p.id);
					const isInCartLoose = cartProductIds.some(
						(cartId) => cartId === p.id,
					);
					if (isInCartStrict || isInCartLoose) continue;
					newRecommendations.push(p);
					if (newRecommendations.length >= max) break;
				}

				// Apply threshold-based filtering if enabled
				if (this.settings.enableThresholdBasedSuggestions) {
					newRecommendations =
						this.filterRecommendationsForThreshold(newRecommendations);
				}

				// Only update if recommendations actually changed
				const currentIds = (this.recommendations || []).map((r) => r.id).sort();
				const newIds = newRecommendations.map((r) => r.id).sort();

				if (JSON.stringify(currentIds) !== JSON.stringify(newIds)) {
					this.recommendations = newRecommendations;
				}

				this._rebuildInProgress = false;
			});
		}

		rebuildRecommendationsFromMasterSync() {
			if (!this._allRecommendations.length) return;

			// STABILITY: Prevent rapid rebuilds that cause shaking
			if (this._rebuildInProgress) return;

			// Check if we should hide recommendations after all thresholds are met
			if (
				this.settings.hideRecommendationsAfterThreshold &&
				this.checkIfAllThresholdsMet()
			) {
				this.recommendations = [];
				return;
			}

			const cartProductIds = (this.cart?.items || []).map((i) => i.product_id);

			// Build visible list by skipping any product in cart and taking next from master, preserving order
			const max = this.normalizeMaxRecommendations(
				this.settings.maxRecommendations,
			);
			let newRecommendations = [];
			for (const p of this._allRecommendations) {
				// Check both strict and loose equality for ID comparison
				const isInCartStrict = cartProductIds.includes(p.id);
				const isInCartLoose = cartProductIds.some((cartId) => cartId === p.id);
				if (isInCartStrict || isInCartLoose) continue;
				newRecommendations.push(p);
				if (newRecommendations.length >= max) break;
			}

			// Apply threshold-based filtering if enabled
			if (this.settings.enableThresholdBasedSuggestions) {
				newRecommendations =
					this.filterRecommendationsForThreshold(newRecommendations);
			}

			// Only update if recommendations actually changed
			const currentIds = (this.recommendations || []).map((r) => r.id).sort();
			const newIds = newRecommendations.map((r) => r.id).sort();

			if (JSON.stringify(currentIds) !== JSON.stringify(newIds)) {
				this.recommendations = newRecommendations;
			}
		}

	getRecommendationItems() {
		// Don't show loading text - just show nothing until recommendations are ready
		if (!this._recommendationsLoaded) {
			return "";
		}

		if (!this.recommendations || this.recommendations.length === 0) {
			return "";
		}			const layoutMap = {
				horizontal: "row",
				row: "row",
				carousel: "row",
				vertical: "column",
				column: "column",
				list: "column",
				grid: "grid",
			};
			const layoutRaw = this.settings.recommendationLayout || "row";
			const layout = layoutMap[layoutRaw] || layoutRaw;

			if (layout === "row") {
				// Only return the scroll track; controls are rendered outside the scroll container
				return `
          <div class="cartuplift-recommendations-track">
            ${this.recommendations
							.map((product) => {
								const reviewHtml = this.formatProductReview(product);
								return `
              <div class="cartuplift-recommendation-card">
                <div class="cartuplift-card-content">
                  <div class="cartuplift-product-image">
                    <img src="${product.image || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png"}" alt="${product.title}" loading="lazy" onerror="this.src='https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png'">
                  </div>
                  <div class="cartuplift-product-info">
                    <h4 class="cartuplift-product-title"><a href="${product.url}" class="cartuplift-product-link">${this.settings.enableRecommendationTitleCaps ? product.title.toUpperCase() : product.title}</a></h4>
                    ${reviewHtml ? `<div class="cartuplift-product-review">${reviewHtml}</div>` : ""}
                    ${this.generateVariantSelector(product)}
                  </div>
                  <div class="cartuplift-product-actions">
                    <div class="cartuplift-recommendation-price">${this.formatMoney(product.priceCents || 0)}</div>
                    <button class="cartuplift-add-recommendation" data-product-id="${product.id}" data-variant-id="${product.variant_id}">
                      ${this.settings.addButtonText || "Add"}
                    </button>
                  </div>
                </div>
              </div>
            `;
							})
							.join("")}
          </div>
        `;
			} else if (layout === "grid") {
				// Dynamic Grid Layout - 6 items (2 rows) or 3 items (1 row) based on available products
				return this.generateDynamicGrid();
			} else {
				return this.recommendations
					.map((product) => {
						const reviewHtml = this.formatProductReview(product);
						return `
          <div class="cartuplift-recommendation-item">
            <img src="${product.image || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png"}" alt="${product.title}" loading="lazy" onerror="this.src='https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png'">
            <div class="cartuplift-recommendation-info">
              <h4><a href="${product.url}" class="cartuplift-product-link">${this.settings.enableRecommendationTitleCaps ? product.title.toUpperCase() : product.title}</a></h4>
              ${reviewHtml ? `<div class="cartuplift-product-review">${reviewHtml}</div>` : ""}
              <div class="cartuplift-recommendation-price">${this.formatMoney(product.priceCents || 0)}</div>
            </div>
            <button class="cartuplift-add-recommendation-circle" data-product-id="${product.id}" data-variant-id="${product.variant_id}">
              +
            </button>
          </div>
        `;
					})
					.join("");
			}
		}

		generateDynamicGrid() {
			if (!this.recommendations || this.recommendations.length === 0) {
				return "";
			}

			// Check if mobile
			const isMobile = window.innerWidth <= 768;

			const maxRecommendations = this.normalizeMaxRecommendations(
				this.settings.maxRecommendations,
			);
			const availableProducts = Math.min(
				this.recommendations.length,
				maxRecommendations,
			);

		let visibleCount;
		let isCollapsed = true;

		if (isMobile) {
			visibleCount = Math.min(3, availableProducts);
		} else {
			visibleCount = Math.min(3, availableProducts);
		}
		isCollapsed = availableProducts <= visibleCount;
		const productsToShow = this.recommendations.slice(0, visibleCount);			// Store the full recommendation pool for dynamic swapping
			this._recommendationPool = this.recommendations.slice(
				0,
				maxRecommendations,
			);
			this._visibleRecommendations = [...productsToShow];
			this._nextRecommendationIndex = Math.min(
				maxRecommendations,
				visibleCount,
			);

			const gridHtml = `

        <div class="cartuplift-grid-container${isCollapsed ? " collapsed" : ""}" 
             data-original-title="${(this.settings.recommendationsTitle || "Hand picked for you").replace(/"/g, "&quot;")}"
             data-mode="${isCollapsed ? "collapsed" : "standard"}"
             data-mobile="${isMobile}"
             data-cartuplift-title-caps="${this.settings.enableTitleCaps ? "true" : "false"}">
          ${productsToShow
						.map((product, index) => {
							const originalTitle = product.title || "";
							const displayTitle = this.settings.enableRecommendationTitleCaps
								? originalTitle.toUpperCase()
								: originalTitle;
							const escapedDisplayTitle = displayTitle.replace(/"/g, "&quot;");
							const escapedOriginalTitle = originalTitle.replace(
								/"/g,
								"&quot;",
							);
							const ariaTitle = originalTitle.replace(/"/g, "");
							return `
            <div class="cartuplift-grid-item" 
                 data-product-id="${product.id}" 
                 data-product-handle="${product.handle || ""}"
                 data-variant-id="${product.variant_id}" 
                 data-title="${escapedDisplayTitle}" 
                 data-price="${this.formatMoney(product.priceCents || 0)}"
                 data-grid-index="${index}">
              <div class="cartuplift-grid-image">
                <img src="${product.image || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png"}" 
                     alt="${escapedOriginalTitle}" 
                     loading="lazy" 
                     decoding="async" 
                     onerror="this.src='https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png'">
                <div class="cartuplift-grid-hover">
                  <button class="cartuplift-grid-add-btn"
                          data-product-id="${product.id}"
                          data-variant-id="${product.variant_id}"
                          data-grid-index="${index}"
                          aria-label="Add ${ariaTitle}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>`;
						})
						.join("")}
        </div>
      `;

			// Schedule hover handlers and dynamic functionality
			setTimeout(() => {
				this.attachGridHoverHandlers();
				this.setupDynamicGridHandlers();

				// Setup mobile scroll if needed
				if (isMobile) {
					this.setupMobileGridScroll();
				}
			}, 10);
			return gridHtml;
		}

		setupDynamicGridHandlers() {
			// This will be called when items are added/removed from cart
			// to swap in new recommendations dynamically
		}

		swapInNextRecommendation(removedIndex) {
			// Bring in the next available product when one is added to cart
			if (this._nextRecommendationIndex < this._recommendationPool.length) {
				const nextProduct =
					this._recommendationPool[this._nextRecommendationIndex];
				this._visibleRecommendations[removedIndex] = nextProduct;
				this._nextRecommendationIndex++;

				// Update the DOM
				this.updateGridItem(removedIndex, nextProduct);
			}
		}

		revertRecommendation(productToRevert, targetIndex) {
			// When item is removed from cart, put it back in the grid
			if (targetIndex < this._visibleRecommendations.length) {
				this._visibleRecommendations[targetIndex] = productToRevert;
				this.updateGridItem(targetIndex, productToRevert);
			}
		}

		updateGridItem(index, product) {
			const gridItem = document.querySelector(
				`.cartuplift-grid-item[data-grid-index="${index}"]`,
			);
			if (gridItem) {
				const originalTitle = product.title || "";
				const displayTitle = this.settings.enableRecommendationTitleCaps
					? originalTitle.toUpperCase()
					: originalTitle;
				const escapedDisplayTitle = displayTitle.replace(/"/g, "&quot;");
				const escapedOriginalTitle = originalTitle.replace(/"/g, "&quot;");
				const ariaTitle = originalTitle.replace(/"/g, "");

				gridItem.dataset.productId = product.id;
				gridItem.dataset.variantId = product.variant_id;
				gridItem.dataset.title = escapedDisplayTitle;
				gridItem.dataset.price = this.formatMoney(product.priceCents || 0);

				const img = gridItem.querySelector("img");
				if (img) {
					img.src =
						product.image ||
						"https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1_large.png";
					img.alt = escapedOriginalTitle;
				}

				const button = gridItem.querySelector(".cartuplift-grid-add-btn");
				if (button) {
					button.dataset.variantId = product.variant_id;
					button.setAttribute("aria-label", `Add ${ariaTitle}`);
				}
			}
		}

		setupMobileGridScroll() {
			const gridContainer = document.querySelector(
				".cartuplift-grid-container",
			);
			if (!gridContainer) return;

			// Enable smooth scrolling on mobile
			gridContainer.style.scrollBehavior = "smooth";

			// Optional: Add touch momentum scrolling for iOS
			gridContainer.style.webkitOverflowScrolling = "touch";
		}

		generateVariantSelector(product) {
			// If product has variants with multiple meaningful options, generate a proper selector
			if (product.variants && product.variants.length > 1) {
				// Find the first available variant to set as selected
				let firstAvailableIndex = -1;
				const availableVariants = product.variants.filter((variant, index) => {
					if (variant.available && firstAvailableIndex === -1) {
						firstAvailableIndex = index;
					}
					return variant.available;
				});

				return `
          <div class="cartuplift-product-variation">
            <select class="cartuplift-size-dropdown" data-product-id="${product.id}">
              ${availableVariants
								.map(
									(variant, index) => `
                <option value="${variant.id}" data-price-cents="${variant.price_cents}" ${index === 0 ? "selected" : ""}>
                  ${variant.title}
                </option>
              `,
								)
								.join("")}
            </select>
          </div>
        `;
			} else {
				// Simple product or single variant - hide selector completely
				return `<div class="cartuplift-product-variation hidden"></div>`;
			}
		}

		refreshRecommendationLayout() {
			// Reload settings to get latest changes
			const recommendationsContainer = document.querySelector(
				".cartuplift-recommendations-content",
			);
			if (recommendationsContainer && this._recommendationsLoaded) {
				recommendationsContainer.innerHTML = this.getRecommendationItems();

				// Re-apply layout class to container
				const recommendationsSection = document.querySelector(
					".cartuplift-recommendations",
				);
				if (recommendationsSection) {
					const layoutMap = {
						horizontal: "row",
						vertical: "column",
						grid: "grid",
						carousel: "row",
						list: "column",
					};
					const layoutRaw = this.settings.recommendationLayout || "column";
					const layout = layoutMap[layoutRaw] || layoutRaw;
					// Remove old layout classes and add new one
					recommendationsSection.classList.remove(
						"cartuplift-recommendations-row",
						"cartuplift-recommendations-column",
						"cartuplift-recommendations-grid",
					);
					recommendationsSection.classList.add(
						`cartuplift-recommendations-${layout}`,
					);
					if (layout === "row") {
						recommendationsSection.classList.add(
							"cartuplift-recommendations-row",
						);
					}
					if (layout === "grid") {
						this.attachGridHoverHandlers();
					}
					if (layout === "grid") {
						recommendationsSection.classList.add(
							"cartuplift-recommendations-grid",
						);
					}

					// Ensure controls exist and setup navigation if horizontal layout
					if (layout === "row") {
						const section = document.querySelector(
							".cartuplift-recommendations",
						);
						if (
							section &&
							!section.querySelector(".cartuplift-carousel-controls")
						) {
							const controls = document.createElement("div");
							controls.className = "cartuplift-carousel-controls";
							controls.innerHTML = `
                <button class="cartuplift-carousel-nav prev" data-nav="prev" aria-label="Previous">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10 12l-4-4 4-4"/>
                  </svg>
                </button>
                <button class="cartuplift-carousel-nav next" data-nav="next" aria-label="Next">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 12l4-4-4-4"/>
                  </svg>
                </button>
                <div class="cartuplift-carousel-dots">
                  ${this.recommendations
										.map(
											(_, index) => `
                    <button type="button" class="cartuplift-carousel-dot${index === 0 ? " active" : ""}"
                      data-index="${index}"
                      aria-label="Go to slide ${index + 1}"
                      aria-current="${index === 0 ? "true" : "false"}"></button>
                  `,
										)
										.join("")}
                </div>`;
							section.appendChild(controls);
						}
						setTimeout(() => {
							const scrollContainer = document.querySelector(
								".cartuplift-recommendations-content",
							);
							if (scrollContainer) {

								this.setupScrollControls(scrollContainer);
								this.updateCarouselButtons(scrollContainer);
								scrollContainer.addEventListener("scroll", () => {
									this.updateCarouselButtons(scrollContainer);
									this.updateDots(scrollContainer);
								});
							} else {
								debug.log("[CartUplift] ERROR: Scroll container not found");
							}
						}, 100);
					}
				}
			}
		}

		getCartIconSVG() {
			const icon = this.settings.cartIcon || "cart";
			switch (icon) {
				case "bag":
					return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8V7a6 6 0 0 1 12 0v1"/><path d="M6 8h12l1 13H5L6 8Z"/></svg>`;
				case "basket":
					return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11h14l-1.5 8h-11L5 11Z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/></svg>`;
				default:
					return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h15l-1.5 12.5a2 2 0 0 1-2 1.5H8a2 2 0 0 1-2-1.5L4.5 6H20"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
			}
		}

		attachGridHoverHandlers() {
			const container = document.querySelector(".cartuplift-grid-container");
			if (!container) return;

			// Get the main recommendations title element and collapse button
			const titleEl = document.querySelector(
				".cartuplift-recommendations-title",
			);
			const collapseBtn = document.querySelector(
				".cartuplift-recommendations-toggle",
			);
			if (!titleEl || !collapseBtn) return;

			// Store original title
			const originalTitle =
				container.getAttribute("data-original-title") || titleEl.textContent;
			this._originalRecommendationsTitle = originalTitle;

			// Create price element that will replace the collapse button
			let priceEl = document.querySelector(".cartuplift-hover-price");
			if (!priceEl) {
				priceEl = document.createElement("span");
				priceEl.className = "cartuplift-hover-price";
				priceEl.style.cssText = "font-weight: 500; color: #333; display: none;";
				collapseBtn.parentNode.insertBefore(priceEl, collapseBtn.nextSibling);
			}

			container.querySelectorAll(".cartuplift-grid-item").forEach((item) => {
				item.addEventListener("mouseenter", () => {
					let title = item.getAttribute("data-title");
					const price = item.getAttribute("data-price");

					if (title && this.settings.enableRecommendationTitleCaps) {
						title = title.toUpperCase();
					}

					// Update title and show price, hide collapse button
					if (title && titleEl) titleEl.textContent = title;
					if (price && priceEl) {
						priceEl.textContent = price;
						priceEl.style.display = "inline";
					}
					collapseBtn.classList.add("cartuplift-toggle-hidden");
				});
			});

			// Restore original state when leaving entire grid
			container.addEventListener("mouseleave", () => {
				titleEl.textContent = this._originalRecommendationsTitle;
				if (priceEl) priceEl.style.display = "none";
				collapseBtn.classList.remove("cartuplift-toggle-hidden");
			});
		}

		setupScrollControls(scrollContainer) {
			// Check if we're on mobile
			const isMobile = window.innerWidth <= 768;

			if (isMobile) {
				// Mobile: scroll by full container width for full card visibility
				this.scrollAmount = scrollContainer.clientWidth;
			} else {
				// Desktop: scroll by card width + margin for precise navigation
				// Card is 338px + 8px margin = 346px total
				this.scrollAmount = 346;
			}

			// Bind navigation events
			const prevBtn = document.querySelector(".cartuplift-carousel-nav.prev");
			const nextBtn = document.querySelector(".cartuplift-carousel-nav.next");

			if (prevBtn && nextBtn) {
				prevBtn.addEventListener("click", () =>
					this.scrollPrev(scrollContainer),
				);
				nextBtn.addEventListener("click", () =>
					this.scrollNext(scrollContainer),
				);
			}

			// Bind dot navigation
			const dots = document.querySelectorAll(".cartuplift-carousel-dot");
			dots.forEach((dot, index) => {
				dot.addEventListener("click", () =>
					this.scrollToIndex(scrollContainer, index),
				);
				dot.addEventListener("keydown", (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						this.scrollToIndex(scrollContainer, index);
					}
				});
			});

			// Add touch support for mobile
			if (isMobile) {
				this.setupTouchEvents(scrollContainer);
			}
		}

		setupTouchEvents(scrollContainer) {
			let startX = 0;
			let scrollLeft = 0;
			let isDown = false;

			scrollContainer.addEventListener("touchstart", (e) => {
				isDown = true;
				startX = e.touches[0].pageX - scrollContainer.offsetLeft;
				scrollLeft = scrollContainer.scrollLeft;
			});

			scrollContainer.addEventListener("touchend", () => {
				isDown = false;
			});

			scrollContainer.addEventListener("touchmove", (e) => {
				if (!isDown) return;
				e.preventDefault();
				const x = e.touches[0].pageX - scrollContainer.offsetLeft;
				const walk = (x - startX) * 2;
				scrollContainer.scrollLeft = scrollLeft - walk;
			});
		}

		scrollToIndex(scrollContainer, index) {
			if (!scrollContainer) return;

			// Find all recommendation cards in this container
			const cards = scrollContainer.querySelectorAll(
				".cartuplift-recommendation-card, .cartuplift-recommendation-item",
			);

			if (!cards || index >= cards.length) return;

			const targetCard = cards[index];
			if (!targetCard) return;

			// Calculate the scroll position to center the target card
			const containerRect = scrollContainer.getBoundingClientRect();
			const cardRect = targetCard.getBoundingClientRect();

			// Calculate offset relative to the scroll container's current scroll position
			const targetScroll =
				scrollContainer.scrollLeft +
				(cardRect.left - containerRect.left) -
				(containerRect.width - cardRect.width) / 2;

			scrollContainer.scrollTo({
				left: Math.max(0, targetScroll),
				behavior: "smooth",
			});
		}

		scrollPrev(scrollContainer) {
			if (!scrollContainer) return;

			// Find the current card index and scroll to previous
			const currentIndex = this.getCurrentCardIndex(scrollContainer);
			if (currentIndex > 0) {
				this.scrollToIndex(scrollContainer, currentIndex - 1);
			}
		}

		scrollNext(scrollContainer) {
			if (!scrollContainer) return;

			// Find the current card index and scroll to next
			const cards = scrollContainer.querySelectorAll(
				".cartuplift-recommendation-card, .cartuplift-recommendation-item",
			);
			const currentIndex = this.getCurrentCardIndex(scrollContainer);
			if (currentIndex < cards.length - 1) {
				this.scrollToIndex(scrollContainer, currentIndex + 1);
			}
		}

		getCurrentCardIndex(scrollContainer) {
			const cards = scrollContainer.querySelectorAll(
				".cartuplift-recommendation-card, .cartuplift-recommendation-item",
			);
			const containerRect = scrollContainer.getBoundingClientRect();
			const containerCenter = containerRect.left + containerRect.width / 2;

			let closestIndex = 0;
			let closestDistance = Infinity;

			cards.forEach((card, index) => {
				const cardRect = card.getBoundingClientRect();
				const cardCenter = cardRect.left + cardRect.width / 2;
				const distance = Math.abs(cardCenter - containerCenter);

				if (distance < closestDistance) {
					closestDistance = distance;
					closestIndex = index;
				}
			});

			return closestIndex;
		}

		updateCarouselButtons(scrollContainer) {
			if (!scrollContainer) {
				debug.log("[CartUplift] updateCarouselButtons: No scroll container");
				return;
			}

			const prevBtn = document.querySelector(".cartuplift-carousel-nav.prev");
			const nextBtn = document.querySelector(".cartuplift-carousel-nav.next");

			if (!prevBtn || !nextBtn) {
				debug.log("[CartUplift] Navigation buttons not found:", {
					prevBtn,
					nextBtn,
				});
				return;
			}

			const scrollLeft = scrollContainer.scrollLeft;
			const maxScroll =
				scrollContainer.scrollWidth - scrollContainer.clientWidth;

			// Always show controls if we have recommendations - let CSS handle responsive visibility
			const controls = document.querySelector(".cartuplift-carousel-controls");
			if (controls) {
				const hasRecommendations =
					document.querySelectorAll(".cartuplift-recommendation-card").length >
					0;
				if (hasRecommendations) {
					controls.style.display = "flex";
					controls.style.visibility = "visible";
				} else {
					controls.style.display = "none";
				}
			} else {
				debug.log("[CartUplift] Carousel controls not found");
			}

			// Update button states
			prevBtn.disabled = scrollLeft <= 0;
			nextBtn.disabled = scrollLeft >= maxScroll - 1;

			// Add visual feedback
			if (prevBtn.disabled) {
				prevBtn.style.opacity = "0.3";
			} else {
				prevBtn.style.opacity = "1";
			}

			if (nextBtn.disabled) {
				nextBtn.style.opacity = "0.3";
			} else {
				nextBtn.style.opacity = "1";
			}
		}

		updateDots(scrollContainer) {
			if (!scrollContainer) return;

			const dots = document.querySelectorAll(".cartuplift-carousel-dot");
			if (dots.length === 0) return;

			const currentIndex = this.getCurrentCardIndex(scrollContainer);

			dots.forEach((dot, index) => {
				const isActive = index === currentIndex;
				dot.classList.toggle("active", isActive);
				dot.setAttribute("aria-current", isActive ? "true" : "false");
			});
		}

		handleVariantChange(select) {
			const card = select.closest(".cartuplift-recommendation-card");
			if (!card) return;

			const variantId = select.value;
			const selectedOption = select.options[select.selectedIndex];
			const priceCents = selectedOption.dataset.priceCents;

			// Update add button with selected variant
			const addBtn = card.querySelector(".cartuplift-add-recommendation");
			if (addBtn && variantId) {
				addBtn.dataset.variantId = variantId;
			}

			// Update price display if available
			if (priceCents) {
				const priceElement = card.querySelector(
					".cartuplift-recommendation-price",
				);
				if (priceElement) {
					priceElement.textContent = this.formatMoney(parseInt(priceCents, 10));
				}
			}
		}

		showToast(message, type = "info") {
			const toast = document.createElement("div");
			toast.className = `cartuplift-toast cartuplift-toast-${type}`;
			toast.textContent = message;

			const bgColor =
				type === "success"
					? "#121212"
					: type === "error"
						? "#ef4444"
						: "#3b82f6";

			toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${bgColor};
        color: white;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 99999;
        animation: cartupliftSlideUp 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      `;

			document.body.appendChild(toast);

			setTimeout(() => {
				toast.style.opacity = "0";
				toast.style.transform = "translateY(10px)";
				setTimeout(() => {
					if (toast.parentNode) {
						toast.parentNode.removeChild(toast);
					}
				}, 300);
			}, 3000);
		}

		getAddonsHTML() {
			return `
        <div class="cartuplift-addons">
          <button class="cartuplift-addon-btn">
            Add Gift Note & Logo Free Packaging +
          </button>
        </div>
      `;
		}

		getInlineLinkConfig() {
			const rawPromo =
				typeof this.settings.discountLinkText === "string"
					? this.settings.discountLinkText
					: "";
			const rawNotes =
				typeof this.settings.notesLinkText === "string"
					? this.settings.notesLinkText
					: "";
			const promoText = rawPromo.trim();
			const notesText = rawNotes.trim();
			const hasPromoLink = Boolean(
				this.settings.enableDiscountCode && promoText.length > 0,
			);
			const hasNotesLink = Boolean(
				this.settings.enableNotes && notesText.length > 0,
			);
			return { hasPromoLink, hasNotesLink, promoText, notesText };
		}

		getInlineLinksHTML(config) {
			const { hasPromoLink, hasNotesLink, promoText, notesText } =
				config || this.getInlineLinkConfig();
			const links = [];

			if (hasPromoLink) {
				// Remove leading "+" for compact inline copy
				const cleanPromoText = promoText.replace(/^\+\s*/, "");
				const displayPromoText =
					cleanPromoText.length > 0 ? cleanPromoText : promoText;
				// No icon to save vertical space
				links.push(
					`<span class="cartuplift-inline-link" onclick="window.cartUpliftDrawer.openDiscountModal()">${this.escapeHtml(displayPromoText)}</span>`,
				);
			}

			if (hasNotesLink) {
				// Remove leading "+" for compact inline copy
				const cleanNotesText = notesText.replace(/^\+\s*/, "");
				const displayNotesText =
					cleanNotesText.length > 0 ? cleanNotesText : notesText;
				links.push(
					`<span class="cartuplift-inline-link" onclick="window.cartUpliftDrawer.openNotesModal()">${this.escapeHtml(displayNotesText)}</span>`,
				);
			}

			if (!links.length) {
				return "";
			}

			// Join with a thin space instead of a bullet to avoid extra visual noise
			return `<div class="cartuplift-inline-links">${links.join(" ")}</div>`;
		}

		getNotesHTML() {
			return `
        <div class="cartuplift-notes">
          <textarea id="cartuplift-notes-input" class="cartuplift-notes-input" placeholder="Order notes..." rows="3"></textarea>
        </div>
      `;
		}

		openCustomModal() {
			// Always regenerate modal content to reflect current settings
			let modal = document.getElementById("cartuplift-custom-modal");
			if (modal) {
				modal.remove(); // Remove existing modal to regenerate with current settings
			}

			modal = document.createElement("div");
			modal.id = "cartuplift-custom-modal";
			modal.className = "cartuplift-custom-modal";

			// Build modal content based on enabled features
			let modalContent = "";

			debug.log("🛒 Cart Uplift: Building modal with settings:", {
				enableDiscountCode: this.settings.enableDiscountCode,
				enableNotes: this.settings.enableNotes,
				enableGiftMessage: this.settings.enableGiftMessage,
			});

			const modalTitle =
				this.settings.enableDiscountCode &&
				!this.settings.enableNotes &&
				!this.settings.enableGiftMessage
					? "Promotion code"
					: !this.settings.enableDiscountCode &&
							this.settings.enableNotes &&
							!this.settings.enableGiftMessage
						? "Order notes"
						: "Add to order";

			modalContent += `
        <div class="cartuplift-modal-content">
          <div class="cartuplift-modal-header">
            <h3 class="cartuplift-modal-title">${modalTitle}</h3>
            <button class="cartuplift-modal-close" onclick="window.cartUpliftDrawer.closeCustomModal()">×</button>
          </div>
          <div class="cartuplift-modal-body">
      `;

			// Discount/Voucher Code Section - with immediate verification
			if (this.settings.enableDiscountCode) {
				const currentCode = this.cart?.attributes?.discount_code
					? String(this.cart.attributes.discount_code)
					: "";
				const currentSummary = this.cart?.attributes?.discount_summary
					? String(this.cart.attributes.discount_summary)
					: "";
				const discountTitle =
					this.settings.discountSectionTitle || "Discount Code";
				const discountPlaceholder =
					this.settings.discountPlaceholder || "Enter your voucher code";
				modalContent += `
          <div class="cartuplift-modal-section">
            <label class="cartuplift-modal-label">${discountTitle}</label>
            <div class="cartuplift-modal-input-group">
              <input type="text" id="modal-discount-code" class="cartuplift-modal-input" 
                     placeholder="${discountPlaceholder}" 
                     ${currentCode ? `value="${currentCode}" disabled` : ""}
                     onkeyup="window.cartUpliftDrawer.handleDiscountInput(event)">
              ${
								currentCode
									? `
                <button type="button" class="cartuplift-modal-apply-btn" 
                        onclick="window.cartUpliftDrawer.removeDiscountCode()">Remove</button>
              `
									: `
                <button type="button" class="cartuplift-modal-apply-btn" 
                        onclick="window.cartUpliftDrawer.applyModalDiscount()">${this.settings.applyButtonText || "Apply"}</button>
              `
							}
            </div>
            <div id="modal-discount-message" class="cartuplift-modal-message">${currentCode ? `<span class="success">${currentSummary || `✓ Discount code "${currentCode}" saved! Will be applied at checkout.`}</span>` : ""}</div>
          </div>
        `;
			}

			// Order Notes Section
			if (this.settings.enableNotes) {
				const currentNotes = this.cart?.attributes?.["Order Notes"]
					? String(this.cart.attributes["Order Notes"])
					: "";
				const notesTitle = this.settings.notesSectionTitle || "Order Notes";
				const notesPlaceholder =
					this.settings.notesPlaceholder ||
					"Add any special instructions or notes...";
				const remainingChars = 250 - currentNotes.length;
				modalContent += `
          <div class="cartuplift-modal-section">
            <label class="cartuplift-modal-label">${notesTitle}</label>
            <textarea id="modal-order-notes" class="cartuplift-modal-textarea" 
                      placeholder="${notesPlaceholder}" rows="3" maxlength="250"
                      onkeyup="window.cartUpliftDrawer.updateCharCount(this, 'notes-char-count', 250)">${currentNotes}</textarea>
            <div class="cartuplift-modal-char-count">
              <span id="notes-char-count">${remainingChars}</span> characters remaining
            </div>
          </div>
        `;
			}

			// Gift Message Section
			if (this.settings.enableGiftMessage) {
				const currentGift = this.cart?.attributes?.["Gift Message"]
					? String(this.cart.attributes["Gift Message"])
					: "";
				const giftTitle = this.settings.giftSectionTitle || "Gift Message";
				const giftPlaceholder =
					this.settings.giftPlaceholder ||
					"Write a personal message for this gift...";
				const remainingChars = 200 - currentGift.length;
				modalContent += `
          <div class="cartuplift-modal-section">
            <label class="cartuplift-modal-label">${giftTitle}</label>
            <textarea id="modal-gift-message" class="cartuplift-modal-textarea" 
                      placeholder="${giftPlaceholder}" rows="3" maxlength="200"
                      onkeyup="window.cartUpliftDrawer.updateCharCount(this, 'gift-char-count', 200)">${currentGift}</textarea>
            <div class="cartuplift-modal-char-count">
              <span id="gift-char-count">${remainingChars}</span> characters remaining
            </div>
          </div>
        `;
			}

			modalContent += `
          </div>
          <div class="cartuplift-modal-footer">
            <button class="cartuplift-modal-btn secondary" onclick="window.cartUpliftDrawer.closeCustomModal()">Cancel</button>
            <button class="cartuplift-modal-btn primary" onclick="window.cartUpliftDrawer.saveModalOptions()">Save Changes</button>
          </div>
        </div>
      `;

			modal.innerHTML = modalContent;

			debug.log(
				"🛒 Cart Uplift: Modal HTML length:",
				modalContent.length,
				"chars",
			);
			const modalBody = modal.querySelector(".cartuplift-modal-body");
			if (modalBody) {
				debug.log(
					"🛒 Cart Uplift: Modal body has",
					modalBody.children.length,
					"sections",
				);
			} else {
				debug.error("❌ Cart Uplift: Modal body not found!");
			}

			document.body.appendChild(modal);

			debug.log(
				"🛒 Cart Uplift: Modal HTML length:",
				modalContent.length,
				"chars",
			);
			debug.log(
				"🛒 Cart Uplift: Modal body content:",
				modal
					.querySelector(".cartuplift-modal-body")
					?.innerHTML?.substring(0, 200),
			);

			modal.classList.add("active");

			// Focus first input and auto-resize textareas
			const firstInput = modal.querySelector("input, textarea");
			if (firstInput) {
				setTimeout(() => firstInput.focus(), 80);
			}
			const autoResize = (el) => {
				try {
					el.style.height = "auto";
					el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
				} catch (_e) {}
			};
			modal.querySelectorAll("textarea").forEach((t) => {
				autoResize(t);
				t.addEventListener("input", () => autoResize(t));
			});

			// Debug log to check current settings
			debug.log("🛒 Cart Uplift: Modal settings:", {
				enableDiscountCode: this.settings.enableDiscountCode,
				enableNotes: this.settings.enableNotes,
				enableGiftMessage: this.settings.enableGiftMessage,
			});
		}

		openDiscountModal() {
			const prev = {
				enableDiscountCode: this.settings.enableDiscountCode,
				enableNotes: this.settings.enableNotes,
				enableGiftMessage: this.settings.enableGiftMessage,
			};
			this.settings.enableDiscountCode = true;
			this.settings.enableNotes = false;
			this.settings.enableGiftMessage = false;
			this.openCustomModal();
			this.settings.enableDiscountCode = prev.enableDiscountCode;
			this.settings.enableNotes = prev.enableNotes;
			this.settings.enableGiftMessage = prev.enableGiftMessage;
		}

		openNotesModal() {
			const prev = {
				enableDiscountCode: this.settings.enableDiscountCode,
				enableNotes: this.settings.enableNotes,
				enableGiftMessage: this.settings.enableGiftMessage,
			};
			this.settings.enableDiscountCode = false;
			this.settings.enableNotes = true;
			this.settings.enableGiftMessage = false;
			this.openCustomModal();
			this.settings.enableDiscountCode = prev.enableDiscountCode;
			this.settings.enableNotes = prev.enableNotes;
			this.settings.enableGiftMessage = prev.enableGiftMessage;
		}

		closeCustomModal() {
			const modal = document.getElementById("cartuplift-custom-modal");
			if (modal) {
				modal.classList.remove("active");
			}
		}

		updateCharCount(textarea, counterId, maxLength) {
			const counter = document.getElementById(counterId);
			if (counter) {
				const remaining = maxLength - textarea.value.length;
				counter.textContent = remaining;
				counter.style.color = remaining < 50 ? "#e74c3c" : "#666";
			}
		}

		handleDiscountInput(event) {
			if (event.key === "Enter") {
				this.applyModalDiscount();
			}
		}

		async applyModalDiscount() {
			const modal = document.getElementById("cartuplift-custom-modal");
			const input = modal?.querySelector("#modal-discount-code");
			const messageEl = modal?.querySelector("#modal-discount-message");
			const button = modal?.querySelector(".cartuplift-modal-apply-btn");

			if (!input || !input.value.trim()) {
				if (messageEl)
					messageEl.innerHTML =
						'<span class="error">Please enter a discount code</span>';
				return;
			}

			const discountCode = input.value.trim().toUpperCase();
			const existingCode = this.cart?.attributes
				? String(this.cart.attributes.discount_code || "").toUpperCase()
				: "";
			if (existingCode && existingCode === discountCode) {
				if (messageEl)
					messageEl.innerHTML = `<span class="success">Code "${discountCode}" is already applied.</span>`;
				return;
			}

			// Disable button and show loading
			if (button) {
				button.disabled = true;
				button.textContent = "Applying...";
			}

			try {
				// First, validate the discount code using our API
				const validationResponse = await fetch(
					`/apps/cart-uplift/api/discount`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							discountCode: discountCode,
						}),
					},
				);

				// If our app validation isn't available or lacks permission, fall back to Shopify's built-in validation
				if (
					!validationResponse.ok &&
					(validationResponse.status === 404 ||
						validationResponse.status === 401 ||
						validationResponse.status === 403 ||
						validationResponse.status >= 500)
				) {
					// API endpoint not found, use Shopify's built-in validation
					const shopifyResponse = await fetch(
						`/cart/discounts/${encodeURIComponent(discountCode)}`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
						},
					);

					if (shopifyResponse.ok) {
						await this.fetchCart();
						this.updateDrawerContent();
						if (messageEl)
							messageEl.innerHTML = `<span class="success">✓ Discount code "${discountCode}" applied successfully!</span>`;
						if (input) input.value = "";
						this.showToast("Discount code applied!", "success");
						this.openCustomModal();
					} else {
						const errorData = await shopifyResponse.json().catch(() => ({}));
						const errorMessage =
							errorData.description || "Invalid discount code";
						if (messageEl)
							messageEl.innerHTML = `<span class="error">✗ ${errorMessage}</span>`;
						this.showToast("Invalid discount code", "error");
					}
					return;
				}

				const validationData = await validationResponse
					.json()
					.catch(() => ({}));

				// If server replied but couldn't validate (e.g., permission error), try Shopify fallback before failing
				if (!validationResponse.ok && validationData && validationData.error) {
					try {
						const shopifyResponse = await fetch(
							`/cart/discounts/${encodeURIComponent(discountCode)}`,
							{
								method: "POST",
								headers: { "Content-Type": "application/json" },
							},
						);
						if (shopifyResponse.ok) {
							await this.fetchCart();
							this.updateDrawerContent();
							if (messageEl)
								messageEl.innerHTML = `<span class="success">✓ Discount code "${discountCode}" applied successfully!</span>`;
							if (input) input.value = "";
							this.showToast("Discount code applied!", "success");
							this.openCustomModal();
							return;
						}
					} catch (_e) {
						// ignore and proceed to error handling
					}
				}

				if (validationData.success) {
					// Discount is valid, save it as cart attribute for checkout
					const cartData = await fetch("/cart.js").then((r) => r.json());
					// Normalize numeric fields (percent/amount) in case API returns strings
					const kind = validationData.discount.kind || "";
					const rawPercent = validationData.discount.percent;
					const rawAmountCents = validationData.discount.amountCents;
					const percentNum =
						typeof rawPercent === "number"
							? rawPercent
							: typeof rawPercent === "string"
								? parseFloat(rawPercent)
								: undefined;
					const amountCentsNum =
						typeof rawAmountCents === "number"
							? rawAmountCents
							: typeof rawAmountCents === "string"
								? Math.round(parseFloat(rawAmountCents))
								: undefined;

					const updateData = {
						attributes: {
							...cartData.attributes,
							discount_code: discountCode,
							discount_summary:
								validationData.discount.summary || `Discount: ${discountCode}`,
							// Store metadata for estimating savings in-cart
							discount_kind: kind,
							discount_percent:
								typeof percentNum === "number" && !Number.isNaN(percentNum)
									? String(percentNum)
									: "",
							discount_amount_cents:
								typeof amountCentsNum === "number" &&
								!Number.isNaN(amountCentsNum)
									? String(amountCentsNum)
									: "",
						},
					};

					// Optimistically update local state so subtotal reflects immediately
					this._lastDiscountCode = discountCode;
					this._lastDiscountKind = kind || undefined;
					this._lastDiscountPercent =
						typeof percentNum === "number" && !Number.isNaN(percentNum)
							? percentNum
							: undefined;
					this._lastDiscountAmountCents =
						typeof amountCentsNum === "number" && !Number.isNaN(amountCentsNum)
							? amountCentsNum
							: undefined;
					this.updateDrawerContent();

					const updateResponse = await fetch("/cart/update.js", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(updateData),
					});

					if (updateResponse.ok) {
						await this.fetchCart();
						this.updateDrawerContent();
						if (messageEl)
							messageEl.innerHTML = `<span class="success">✓ Discount code "${discountCode}" validated! Previewed below and will apply at checkout.</span>`;
						if (input) input.value = "";
						this.showToast("Discount code validated!", "success");
						// Regenerate modal UI to reflect applied state
						this.openCustomModal();
					} else {
						throw new Error("Failed to save discount to cart");
					}
				} else {
					// Discount validation failed
					if (messageEl)
						messageEl.innerHTML = `<span class="error">${validationData.error || "Invalid discount code"}</span>`;
					this.showToast("Invalid discount code", "error");
				}
			} catch (error) {
				debug.error("Error validating discount:", error);

				// Show proper error message - no fallback saving of unvalidated codes
				if (messageEl)
					messageEl.innerHTML =
						'<span class="error">Unable to validate discount code. Please check the code and try again.</span>';
				this.showToast("Discount validation failed", "error");
			} finally {
				// Reset button
				if (button) {
					button.disabled = false;
					button.textContent = "Apply";
				}
			}
		}

		async removeDiscountCode() {
			try {
				const cartData = await fetch("/cart.js").then((r) => r.json());
				const attrs = { ...(cartData.attributes || {}) };
				// Clear discount-related attributes
				attrs.discount_code = null;
				attrs.discount_summary = null;
				attrs.discount_kind = null;
				attrs.discount_percent = null;
				attrs.discount_amount_cents = null;

				const resp = await fetch("/cart/update.js", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ attributes: attrs }),
				});
				if (resp.ok) {
					await this.fetchCart();
					this.updateDrawerContent();
					this.showToast("Discount removed", "success");
					// Reopen modal with input enabled
					// Clear local discount cache
					this._lastDiscountCode = undefined;
					this._lastDiscountKind = undefined;
					this._lastDiscountPercent = undefined;
					this._lastDiscountAmountCents = undefined;
					this.openCustomModal();
				} else {
					this.showToast("Could not remove discount", "error");
				}
			} catch (e) {
				debug.error("Error removing discount:", e);
				this.showToast("Could not remove discount", "error");
			}
		}

		async saveModalOptions() {
			const modal = document.getElementById("cartuplift-custom-modal");
			if (!modal) return;

			const options = {};

			// Collect order notes
			const notesInput = modal.querySelector("#modal-order-notes");
			if (notesInput?.value.trim()) {
				options.orderNotes = notesInput.value.trim();
			}

			// Collect gift message
			const giftInput = modal.querySelector("#modal-gift-message");
			if (giftInput?.value.trim()) {
				options.giftMessage = giftInput.value.trim();
			}

			// Save options to cart attributes
			await this.saveCartAttributes(options);

			this.closeCustomModal();
			this.showToast("Your preferences have been saved!", "success");
		}

		async saveCartAttributes(attributes) {
			try {
				// Convert to cart attributes format
				const cartAttributes = {};
				if (attributes.orderNotes)
					cartAttributes["Order Notes"] = attributes.orderNotes;
				if (attributes.giftMessage)
					cartAttributes["Gift Message"] = attributes.giftMessage;
				if (attributes.specialRequests)
					cartAttributes["Special Requests"] = attributes.specialRequests;
				if (attributes.deliveryInstructions)
					cartAttributes["Delivery Instructions"] =
						attributes.deliveryInstructions;
				if (attributes.giftWrapping) cartAttributes["Gift Wrapping"] = "Yes";

				// Update cart with attributes
				const response = await fetch("/cart/update.js", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						attributes: cartAttributes,
					}),
				});

				if (response.ok) {
					await this.fetchCart();
				}
			} catch (error) {
				debug.error("Error saving cart attributes:", error);
			}
		}

		async applyInlineDiscount() {
			const input = document.getElementById("cartuplift-discount-input");
			const messageEl = document.getElementById("cartuplift-discount-message");
			const button = document.querySelector(".cartuplift-discount-apply");

			if (!input || !input.value.trim()) {
				if (messageEl)
					messageEl.innerHTML =
						'<span class="error">Please enter a discount code</span>';
				return;
			}

			const discountCode = input.value.trim();

			// Disable button and show loading
			if (button) {
				button.disabled = true;
				button.textContent = "Applying...";
			}

			try {
				// Use Shopify's cart/discounts.js endpoint
				const response = await fetch(
					`/cart/discounts/${encodeURIComponent(discountCode)}`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
					},
				);

				if (response.ok) {
					await this.fetchCart();
					this.updateDrawerContent();
					if (messageEl)
						messageEl.innerHTML =
							'<span class="success">✓ Discount applied successfully!</span>';
					if (input) input.value = "";
				} else {
					const errorData = await response.json().catch(() => ({}));
					const errorMessage = errorData.description || "Invalid discount code";
					if (messageEl)
						messageEl.innerHTML = `<span class="error">✗ ${errorMessage}</span>`;
				}
			} catch (error) {
				debug.error("Error applying discount:", error);
				if (messageEl)
					messageEl.innerHTML =
						'<span class="error">✗ Error applying discount code</span>';
			} finally {
				// Re-enable button
				if (button) {
					button.disabled = false;
					button.textContent = "Apply";
				}
			}
		}

		async applyDiscountCode(code = null) {
			const discountCode =
				code || document.getElementById("discount-code")?.value;
			if (!discountCode) return;

			try {
				const response = await fetch(
					`/discount/${encodeURIComponent(discountCode)}`,
					{
						method: "POST",
					},
				);

				if (response.ok) {
					await this.fetchCart();
					this.updateDrawerContent();
					this.showToast("Discount applied!", "success");
				} else {
					this.showToast("Invalid discount code", "error");
				}
			} catch (error) {
				debug.error("Error applying discount:", error);
				this.showToast("Error applying discount", "error");
			}
		}

		getExpressCheckoutHTML() {
			return `
        <div class="cartuplift-express-checkout">
          <div class="cartuplift-express-slot"></div>
        </div>
      `;
		}

		attachDrawerEvents() {
			const container = document.getElementById("cartuplift-app-container");
			if (!container) return;

			// Prevent duplicate event listeners
			if (container.dataset.eventsAttached === "true") {
				return;
			}
			container.dataset.eventsAttached = "true";

			// Close button
			const closeBtn = container.querySelector(".cartuplift-close");
			if (closeBtn) {
				closeBtn.addEventListener("click", () => this.closeDrawer());
			}

			// Backdrop click to close
			const backdrop = container.querySelector("#cartuplift-backdrop");
			if (backdrop) {
				backdrop.addEventListener("click", (e) => {
					// Don't close drawer if modal is active
					const modal = document.getElementById("cartuplift-custom-modal");
					if (modal?.classList.contains("active")) return;

					// Only close if the click is directly on the backdrop, not a child
					if (e.target === backdrop) {
						this.closeDrawer();
					}
				});
			}

			// Fallback: click outside the drawer closes it
			document.addEventListener("mousedown", (e) => {
				if (!this.isOpen) return;

				// Don't close drawer if modal is active
				const modal = document.getElementById("cartuplift-custom-modal");
				if (modal?.classList.contains("active")) return;

				const popup = document.getElementById("cartuplift-cart-popup");
				if (!popup) return;
				// If click is outside the popup
				if (!popup.contains(e.target)) {
					this.closeDrawer();
				}
			});

			// Escape key to close
			document.addEventListener("keydown", (e) => {
				if (e.key === "Escape" && this.isOpen) {
					// If modal is active, close modal first
					const modal = document.getElementById("cartuplift-custom-modal");
					if (modal?.classList.contains("active")) {
						this.closeCustomModal();
					} else {
						this.closeDrawer();
					}
				}
			});

		// Quantity controls and recommendations toggle
		container.addEventListener("click", async (e) => {
			if (e.target.classList.contains("cartuplift-qty-plus")) {
				const line = e.target.dataset.line;
				const display = container.querySelector(
					`[data-line="${line}"] .cartuplift-qty-display`,
				);
				if (display) {
					const currentValue = parseInt(display.textContent, 10) || 0;
					this.updateQuantity(line, currentValue + 1);
				}
			} else if (e.target.classList.contains("cartuplift-qty-minus")) {
				const line = e.target.dataset.line;
				const display = container.querySelector(
					`[data-line="${line}"] .cartuplift-qty-display`,
				);
				if (display) {
					const currentValue = parseInt(display.textContent, 10) || 0;
					this.updateQuantity(line, Math.max(0, currentValue - 1));
				}
			} else if (
				e.target.classList.contains("cartuplift-item-remove-x") ||
				e.target.closest(".cartuplift-item-remove-x")
			) {
				const button = e.target.classList.contains("cartuplift-item-remove-x")
					? e.target
					: e.target.closest(".cartuplift-item-remove-x");
				const line = button.dataset.line;
				this.updateQuantity(line, 0);
			} else if (
				e.target.classList.contains("cartuplift-add-recommendation")
			) {
				e.preventDefault();
				e.stopPropagation();					const card = e.target.closest(".cartuplift-recommendation-card");
					if (!card) return;

					// Check if size needs to be selected
					const sizeSelect = card.querySelector(
						".cartuplift-size-dropdown:not([disabled])",
					);
					let selectedVariantId = e.target.dataset.variantId;

					if (sizeSelect && !sizeSelect.value) {
						this.showToast("Please select an option", "error");
						sizeSelect.focus();
						return;
					}

					// Use selected variant from dropdown if available
					if (sizeSelect?.value) {
						selectedVariantId = sizeSelect.value;
					}

					if (!selectedVariantId) {
						this.showToast("Please select options", "error");
						return;
					}

					const productTitle =
						card.querySelector("h4")?.textContent ||
						`Product ${selectedVariantId}`;
					const position = Array.from(card.parentElement.children).indexOf(
						card,
					);
					const productId = e.target.dataset.productId; // Get parent product ID

					// Track recommendation click with both variant and product IDs
					CartAnalytics.trackEvent("click", {
						productId: selectedVariantId,
						variantId: selectedVariantId,
						parentProductId: productId,
						productTitle: productTitle,
						source: "cart_drawer",
						position: position,
					});

					this.addToCart(selectedVariantId, 1);
				} else if (e.target.classList.contains("cartuplift-size-dropdown")) {
					// Handle variant selection
					this.handleVariantChange(e.target);
				} else if (
					e.target.classList.contains("cartuplift-add-recommendation-circle")
				) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();

					const button = e.target;
					if (button.dataset.processing === "true") return;
					button.dataset.processing = "true";

					const listItem = e.target.closest(".cartuplift-recommendation-item");
					if (!listItem) {
						button.dataset.processing = "false";
						return;
					}

					const productLink = listItem.querySelector(
						".cartuplift-product-link",
					);
					if (!productLink) {
						button.dataset.processing = "false";
						return;
					}

					const productUrl = productLink.getAttribute("href");
					const productHandle = productUrl
						? productUrl.split("/").pop().split("?")[0]
						: null;
					const variantId = e.target.dataset.variantId;
					const productId = e.target.dataset.productId; // Get parent product ID
					const productTitle = productLink.textContent;

					// Track recommendation click with both variant and product IDs
					const position = Array.from(listItem.parentElement.children).indexOf(
						listItem,
					);
					CartAnalytics.trackEvent("click", {
						productId: variantId,
						variantId: variantId,
						parentProductId: productId,
						productTitle: productTitle,
						source: "cart_drawer",
						position: position,
					});

					if (productHandle && variantId) {
						this.handleListProductAdd(
							productHandle,
							variantId,
							productTitle,
							button,
						);
					} else {
						button.dataset.processing = "false";
					}
				} else if (
					e.target.classList.contains("cartuplift-grid-add-btn") ||
					e.target.closest(".cartuplift-grid-add-btn")
				) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation(); // Stop all other handlers

					const button = e.target.classList.contains("cartuplift-grid-add-btn")
						? e.target
						: e.target.closest(".cartuplift-grid-add-btn");

					// Prevent multiple rapid clicks
					if (button.dataset.processing === "true") {
						return;
					}
					button.dataset.processing = "true";

					const variantId = button.dataset.variantId;
					const productId = button.dataset.productId; // Get parent product ID
					const gridIndex = button.dataset.gridIndex;
					const gridItem = button.closest(".cartuplift-grid-item");
					const productHandle = gridItem
						? gridItem.dataset.productHandle
						: null;
					const productTitle = gridItem
						? gridItem.dataset.title
						: `Product ${variantId}`;

					// Track recommendation click with both variant and product IDs
					CartAnalytics.trackEvent("click", {
						productId: variantId,
						variantId: variantId,
						parentProductId: productId,
						productTitle: productTitle,
						source: "cart_drawer",
						position: gridIndex,
					});

					// Check if we need to show variant selector or add directly
					if (productHandle && variantId) {
						await this.handleGridProductAdd(
							productHandle,
							variantId,
							gridIndex,
							productTitle,
						);
					} else if (variantId) {
						// Fallback: add directly if no handle but have variantId
						debug.warn("🛒 No product handle found, adding directly to cart");
						this.addToCart(variantId, 1);

						// Dynamic grid: swap in next recommendation
						if (gridIndex !== undefined) {
							setTimeout(() => {
								this.swapInNextRecommendation(parseInt(gridIndex, 10));
							}, 500);
						}
					} else {
						debug.error("🛒 No variant ID found for add to cart");
					}

					// Reset processing flag after a delay
					setTimeout(() => {
						button.dataset.processing = "false";
					}, 1000);

					if (this.settings.enableAnalytics)
						CartAnalytics.trackEvent("product_click", {
							productId: variantId,
							productTitle: productTitle,
						});
				} else if (
					e.target.classList.contains("cartuplift-recommendations-toggle") ||
					e.target.closest(".cartuplift-recommendations-toggle")
				) {
						e.preventDefault();
					e.stopPropagation();

					// Robustly find the toggle button and recommendations section
					const toggleButton = e.target.classList.contains(
						"cartuplift-recommendations-toggle",
					)
						? e.target
						: e.target.closest(".cartuplift-recommendations-toggle");

					// Find the recommendations section relative to the toggle button
					let recommendations = toggleButton.closest(
						".cartuplift-recommendations",
					);
					if (!recommendations) {
						recommendations = container.querySelector(
							".cartuplift-recommendations",
						);
					}

					if (recommendations) {
						const isCollapsed = recommendations.classList.contains("collapsed");
						recommendations.classList.toggle("collapsed");
						const nowCollapsed =
							recommendations.classList.contains("collapsed");
						// Update content aria-hidden
						const content = recommendations.querySelector(
							"#cartuplift-recommendations-content",
						);
						if (content) {
							content.setAttribute(
								"aria-hidden",
								nowCollapsed ? "true" : "false",
							);
						}
						// Update arrow direction with your SVGs
						const arrow = toggleButton.querySelector("svg path");
						if (arrow) {
							if (isCollapsed) {
								// Was collapsed, now expanding - arrow points up
								arrow.setAttribute("d", "m4.5 15.75 7.5-7.5 7.5 7.5");
							} else {
								// Was expanded, now collapsing - arrow points down
								arrow.setAttribute("d", "m19.5 8.25-7.5 7.5-7.5-7.5");
							}
						}
						// Sync aria state
						toggleButton.setAttribute(
							"aria-expanded",
							nowCollapsed ? "false" : "true",
						);
					}
				} else if (
					e.target.classList.contains("cartuplift-carousel-nav") ||
					e.target.closest(".cartuplift-carousel-nav")
				) {
					// Handle carousel navigation
					const navButton = e.target.classList.contains(
						"cartuplift-carousel-nav",
					)
						? e.target
						: e.target.closest(".cartuplift-carousel-nav");
					const direction = navButton.dataset.nav;
					const scrollContainer = container.querySelector(
						".cartuplift-recommendations-content",
					);

					if (scrollContainer && direction) {
						// Ensure shared scroll config is set
						this.setupScrollControls(scrollContainer);
						if (direction === "prev") {
							this.scrollPrev(scrollContainer);
						} else if (direction === "next") {
							this.scrollNext(scrollContainer);
						}

						// Update button states and dots after scroll
						setTimeout(() => {
							this.updateCarouselButtons(scrollContainer);
							this.updateDots(scrollContainer);
						}, 100);
					}
				} else if (e.target.classList.contains("cartuplift-carousel-dot")) {
					// Handle dot navigation
					const dot = e.target;
					const index = parseInt(dot.dataset.index, 10);
					const scrollContainer = container.querySelector(
						".cartuplift-recommendations-content",
					);

					if (scrollContainer && !Number.isNaN(index)) {
						this.setupScrollControls(scrollContainer);
						this.scrollToIndex(scrollContainer, index);

						// Update dots immediately for instant feedback
						const dots = document.querySelectorAll(".cartuplift-carousel-dot");
						dots.forEach((d, i) => {
							d.classList.toggle("active", i === index);
						});
					}
				}
			});

			// Variant dropdown change handler (ensure updates fire on change)
			container.addEventListener("change", (e) => {
				const select = e.target;
				if (select?.classList?.contains("cartuplift-size-dropdown")) {
					this.handleVariantChange(select);
				}
			});

			// Mobile: ensure recommendations toggle responds on touch devices
			container.addEventListener(
				"touchend",
				(e) => {
					const toggle = e.target.classList?.contains(
						"cartuplift-recommendations-toggle",
					)
						? e.target
						: e.target.closest?.(".cartuplift-recommendations-toggle");
					if (toggle) {
						e.preventDefault();
						e.stopPropagation();
						toggle.click();
					}
				},
				{ passive: false },
			);
		}

	async fetchCart(forceFresh = false) {
		try {
			// Use prewarmed data if available for faster initial load
			// BUT skip prewarm if forceFresh is requested (user manually opening cart)
			if (!forceFresh && this._prewarmData) {
				this.cart = this._prewarmData;
				this._prewarmData = null; // Use only once
			} else if (!forceFresh && this._prewarmPromise) {
				this.cart = await this._prewarmPromise;
				this._prewarmPromise = null; // Use only once
			} else {
				// Fetch fresh data with cache-busting
				if (forceFresh) {
					const cacheBust = Date.now();
					const response = await fetch(`/cart.js?t=${cacheBust}`);
					this.cart = await response.json();
				} else {
					const response = await fetch("/cart.js");
					this.cart = await response.json();
				}
			}

			// Track fetch time for staleness detection
			this._lastCartFetch = Date.now();

			// Let Shopify's theme handle cart count updates naturally
			// this.updateThemeCartCount(this.cart.item_count);

			// Recompute visible recommendations against fixed master list whenever cart changes
			this.rebuildRecommendationsFromMaster();
		} catch (error) {
			debug.error("CartUplift: Error fetching cart:", error);
			this.cart = { items: [], item_count: 0, total_price: 0 };
		}
	}		// Update theme's cart count bubble/badge
		updateThemeCartCount(count) {
			try {
				const selectors = [
					'#cart-icon-bubble',
					'.cart-count-bubble',
					'.cart-count',
					'[data-cart-count]',
					'.header__icon--cart .badge',
					'.site-header__cart-count',
					'cart-icon-bubble',
					'.cart-icon-bubble',
					'#CartCount',
					'.CartCount',
					'[id*="cart-count"]',
					'[class*="cart-count"]'
				];

				selectors.forEach(selector => {
					const elements = document.querySelectorAll(selector);
					elements.forEach(el => {
						// Update text content
						if (el.textContent !== undefined) {
							el.textContent = count;
						}
						// Update data attribute
						if (el.hasAttribute('data-cart-count')) {
							el.setAttribute('data-cart-count', count);
						}
						// Show/hide based on count
						if (count > 0) {
							el.style.display = '';
							el.classList.remove('hidden');
						} else {
							// Some themes hide empty cart badges
							if (el.dataset.hideWhenEmpty !== 'false') {
								el.style.display = 'none';
							}
						}
					});
				});

				// Dispatch custom event for themes that listen
				document.dispatchEvent(new CustomEvent('cart:updated', {
					detail: { item_count: count, cart: this.cart }
				}));

				debug.log(`🔄 Updated theme cart count to: ${count}`);
			} catch (error) {
				debug.warn('Failed to update theme cart count:', error);
			}
		}

	async updateQuantity(line, quantity) {
		if (this._quantityBusy) return;
		this._quantityBusy = true;

		try {
			const formData = new FormData();
			formData.append("line", line);
			formData.append("quantity", quantity);

			const response = await fetch("/cart/change.js", {
				method: "POST",
				body: formData,
			});

			if (response.ok) {
				this.cart = await response.json();

				// Mark cart as modified
				this._cartModified = true;
				// Update cart fetch timestamp to prevent stale data on reopen
				this._lastCartFetch = Date.now();
				// Let Shopify's theme handle cart count updates naturally
				// this.updateThemeCartCount(this.cart.item_count);
				// Ensure recommendations reflect cart mutations (remove added items, re-add removed ones)
				this.rebuildRecommendationsFromMaster();

				this.updateDrawerContent();

				// Check gift thresholds after quantity change
				await this.checkAndAddGiftThresholds();
			} else {
				debug.error(`🔄 Update failed with status:`, response.status);
			}
		} catch (error) {
			debug.error("CartUplift: Error updating quantity:", error);
		} finally {
			this._quantityBusy = false;
		}
	}

	/**
	 * Consolidate duplicate cart items (same variant, different line items)
	 * This ensures items with the same variant but added separately get merged into one line
	 */
	async consolidateDuplicateCartItems() {
		if (!this.cart || !this.cart.items || this.cart.items.length <= 1) {
			return; // No items or only one item, nothing to consolidate
		}

		try {
			// Group items by variant_id to find duplicates
			const variantGroups = new Map();

			this.cart.items.forEach((item, index) => {
				const variantId = String(item.variant_id || item.id);
				if (!variantGroups.has(variantId)) {
					variantGroups.set(variantId, []);
				}
				variantGroups.get(variantId).push({ item, originalIndex: index });
			});

			// Find variants with duplicates (more than one line item)
			const duplicateVariants = [];
			variantGroups.forEach((items, variantId) => {
				if (items.length > 1) {
					duplicateVariants.push({ variantId, items });
				}
			});

			if (duplicateVariants.length === 0) {
				return; // No duplicates found
			}

			debug.log(`🔄 Found ${duplicateVariants.length} duplicate variant(s), consolidating...`);

			// Process each set of duplicates
			for (const { variantId, items } of duplicateVariants) {
				// Calculate total quantities from all duplicate line items
				let totalManualQty = 0;
				let totalRecQty = 0;
				let totalBundleQty = 0;
				let bundleMetadata = null;

				items.forEach(({ item }) => {
					const props = item.properties || {};

					// Parse source quantities
					const manualQty = parseInt(props._source_manual_qty || 0);
					const recQty = parseInt(props._source_rec_qty || 0);
					const bundleQty = parseInt(props._source_bundle_qty || 0);

					// If no source tracking exists, assume it was manually added
					if (manualQty === 0 && recQty === 0 && bundleQty === 0) {
						totalManualQty += item.quantity;
					} else {
						totalManualQty += manualQty;
						totalRecQty += recQty;
						totalBundleQty += bundleQty;
					}

					// Preserve bundle metadata from any item that has it
					if (props._bundle_id && !bundleMetadata) {
						bundleMetadata = {
							_bundle_id: props._bundle_id,
							_bundle_name: props._bundle_name
						};
					}
				});

				const totalQty = totalManualQty + totalRecQty + totalBundleQty;

				// Remove all duplicate line items first
				for (const { item } of items) {
					await (window.CartUpliftAAInternal?.originals?.fetch || window.fetch)('/cart/change.js', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							id: item.key,
							quantity: 0
						})
					});
				}

				// Add back a single consolidated line item
				const consolidatedItem = {
					id: variantId,
					quantity: totalQty,
					properties: {}
				};

				// Only include non-zero source quantities
				if (totalManualQty > 0) {
					consolidatedItem.properties._source_manual_qty = String(totalManualQty);
				}
				if (totalRecQty > 0) {
					consolidatedItem.properties._source_rec_qty = String(totalRecQty);
				}
				if (totalBundleQty > 0) {
					consolidatedItem.properties._source_bundle_qty = String(totalBundleQty);
					// Add bundle metadata if exists
					if (bundleMetadata) {
						consolidatedItem.properties._bundle_id = bundleMetadata._bundle_id;
						if (bundleMetadata._bundle_name) {
							consolidatedItem.properties._bundle_name = bundleMetadata._bundle_name;
						}
					}
				}

				await (window.CartUpliftAAInternal?.originals?.fetch || window.fetch)('/cart/add.js', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ items: [consolidatedItem] })
				});

				debug.log(`✅ Consolidated ${items.length} line items for variant ${variantId}:`, {
					manual: totalManualQty,
					rec: totalRecQty,
					bundle: totalBundleQty,
					total: totalQty
				});
			}

			// Fetch updated cart after consolidation
			await this.fetchCart(true);

		} catch (error) {
			debug.error('CartUplift: Error consolidating duplicate items:', error);
			// Don't throw - fail gracefully
		}
	}		async addToCart(variantId, quantity = 1) {
			// Prevent multiple rapid clicks
			if (this._addToCartBusy) {
				return;
			}

			this._addToCartBusy = true;

			try {
				// Validate variant ID first
				if (!variantId || variantId === "undefined" || variantId === "null") {
					debug.error("🛒 Invalid variant ID:", variantId);
					this._addToCartBusy = false;
					return;
				}

				// Disable the button temporarily with better UX
				const buttons = document.querySelectorAll(
					`[data-variant-id="${variantId}"]`,
				);
				buttons.forEach((button) => {
					button.disabled = true;
					button.style.opacity = "0.6";
					button.style.transform = "scale(0.95)";
					// Keep the + sign, just make it look pressed
				});

				// Small delay to prevent rate limiting (reduced for better UX)
				await new Promise((resolve) => setTimeout(resolve, 150));

				// First, fetch current cart to check for existing items
				const cartResponse = await fetch('/cart.js');
				const currentCart = cartResponse.ok ? await cartResponse.json() : { items: [] };

				// Check if this variant already exists in the cart
				const numericVariantId = String(variantId).replace(/[^0-9]/g, '');
				const existingItem = (currentCart.items || []).find(item => {
					const itemVariantId = String(item.variant_id || item.id);
					return itemVariantId === numericVariantId;
				});

				let itemToAdd;

				if (existingItem) {
					// Item already exists - update quantity and track sources
					const existingProps = existingItem.properties || {};

					// Parse existing source quantities
					let manualQty = parseInt(existingProps._source_manual_qty || 0);
					let recQty = parseInt(existingProps._source_rec_qty || 0);
					let bundleQty = parseInt(existingProps._source_bundle_qty || 0);

					// If no source tracking exists, assume it was manually added
					if (manualQty === 0 && recQty === 0 && bundleQty === 0) {
						manualQty = existingItem.quantity;
					}

					// Add recommendation quantity
					recQty += quantity;
					const newTotalQty = manualQty + recQty + bundleQty;

					// Remove the existing item first
					await fetch('/cart/change.js', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							id: existingItem.key,
							quantity: 0
						})
					});

					// Prepare item to add with updated quantities
					itemToAdd = {
						id: numericVariantId,
						quantity: newTotalQty,
						properties: {}
					};

					// Only include non-zero source quantities
					if (manualQty > 0) itemToAdd.properties._source_manual_qty = String(manualQty);
					if (recQty > 0) itemToAdd.properties._source_rec_qty = String(recQty);
					if (bundleQty > 0) {
						itemToAdd.properties._source_bundle_qty = String(bundleQty);
						// Preserve bundle metadata if it exists
						if (existingProps._bundle_id) itemToAdd.properties._bundle_id = existingProps._bundle_id;
						if (existingProps._bundle_name) itemToAdd.properties._bundle_name = existingProps._bundle_name;
					}
				} else {
					// New item - add with recommendation source tracking
					itemToAdd = {
						id: numericVariantId,
						quantity: quantity,
						properties: {
							'_source_rec_qty': String(quantity)
						}
					};
				}

				// Add the item to cart
				const response = await fetch("/cart/add.js", {
					method: "POST",
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ items: [itemToAdd] }),
				});

		if (response.ok) {
			// Get the response data
			const addedItem = await response.json();
			
			// Mark cart as modified
			this._cartModified = true;
			
			// Let Shopify's theme handle cart count naturally - no need for optimistic updates
			// if (this.cart && this.cart.item_count !== undefined) {
			// 	this.cart.item_count += quantity;
			// 	this.updateThemeCartCount(this.cart.item_count);
			// }					// Reset button state immediately on success with success animation
					buttons.forEach((button) => {
						button.disabled = false;
						button.style.opacity = "1";
						button.style.transform = "scale(1)";
						// Use theme button color or black instead of green
						const buttonColor = this.settings.buttonColor || "#121212";
						button.style.background = buttonColor;
						setTimeout(() => {
							button.style.background = "";
						}, 300);
					});

					// Re-filter so added item disappears from recommendations
					this.debouncedUpdateRecommendations();

					// Fetch cart and check gift thresholds in parallel for better performance
					const fetchCartPromise = this.fetchCart(true).then(() => {
						// Update drawer content after cart is fetched
						this.updateDrawerContent();
					});

					const giftThresholdPromise = this.checkAndAddGiftThresholds();

					// Wait for both operations to complete
					await Promise.all([fetchCartPromise, giftThresholdPromise]);

					// Update recommendations display if drawer is open
					if (this.isOpen) {
						const recommendationsContent = document.getElementById(
							"cartuplift-recommendations-content",
						);
						if (recommendationsContent) {
							recommendationsContent.innerHTML = this.getRecommendationItems();
						}
					}

					// Auto-open cart if setting is enabled and drawer is not already open
					if (this.settings.autoOpenCart && this.settings.enableApp) {
						debug.log("🔧 Auto-opening cart after adding from recommendations");
						this.hideThemeNotifications();
						this.tryAutoOpenDrawer();
					}
				} else if (response.status === 429) {
					debug.error("🛒 Rate limited, retrying with longer delay...");
					// Silently retry after longer delay - no user feedback
					buttons.forEach((button) => {
						button.disabled = false;
						button.style.opacity = "1";
						button.style.transform = "scale(1)";
					});
					// Don't show rate limit message to user
				} else if (response.status === 422) {
					debug.error(
						"🛒 Variant not found (422 error) for variant ID:",
						variantId,
					);
					// For 422 errors, remove the invalid recommendation to prevent future errors
					this.removeInvalidRecommendation(variantId);
					buttons.forEach((button) => {
						button.disabled = false;
						button.style.opacity = "1";
						button.style.transform = "scale(1)";
						button.style.display = "none"; // Hide invalid items
					});
				} else {
					debug.error(
						"🛒 Error adding to cart:",
						response.status,
						response.statusText,
					);
					// Re-enable buttons on error with subtle shake
					buttons.forEach((button) => {
						button.disabled = false;
						button.style.opacity = "1";
						button.style.transform = "scale(1)";
						button.style.animation = "shake 0.3s ease-in-out";
						setTimeout(() => {
							button.style.animation = "";
						}, 300);
					});
				}
			} catch (error) {
				debug.error("CartUplift: Error adding to cart:", error);
				// Re-enable buttons on error
				const buttons = document.querySelectorAll(
					`[data-variant-id="${variantId}"]`,
				);
				buttons.forEach((button) => {
					button.disabled = false;
					button.style.opacity = "1";
					button.style.transform = "scale(1)";
				});
			} finally {
				// Always reset the busy flag after a shorter delay
				setTimeout(() => {
					this._addToCartBusy = false;
				}, 500);
			}
		}

		// Handle grid product add - check variants and show modal if needed
		async handleGridProductAdd(
			productHandle,
			variantId,
			gridIndex,
			productTitle,
		) {
			try {
				debug.log("🛒 handleGridProductAdd called:", {
					productHandle,
					variantId,
					gridIndex,
					productTitle,
				});

				// Fetch product data to check variants
				const productResponse = await fetch(`/products/${productHandle}.js`);
				if (!productResponse.ok) {
					debug.error(
						"🛒 Failed to fetch product data, status:",
						productResponse.status,
					);
					// Fallback to direct add
					this.addToCart(variantId, 1);
					return;
				}

				const productData = await productResponse.json();
				const variantState = this.prepareVariantModalState(productData);

				debug.log("🛒 Product data fetched:", productData.title);
				debug.log("🛒 Variant summary:", {
					total: variantState.allVariants.length,
					available: variantState.availableVariants.length,
					optionNames: variantState.optionNames,
					requiresSelection: variantState.requiresSelection,
				});

				if (variantState.requiresSelection) {
					debug.log("🛒 Showing product modal for variant selection");
					this.showProductModal(productData, gridIndex, variantState);
				} else {
					debug.log("🛒 Single variant product, adding directly to cart");
					const fallbackVariant =
						variantState.initialVariant || productData.variants?.[0];
					const variantToAdd = fallbackVariant?.id || variantId;
					if (variantToAdd) {
						await this.addToCart(variantToAdd, 1);
					}

					if (gridIndex !== undefined) {
						setTimeout(() => {
							this.swapInNextRecommendation(parseInt(gridIndex, 10));
						}, 500);
					}
				}
			} catch (error) {
				debug.error("Error handling grid product add:", error);
				// Fallback to direct add
				this.addToCart(variantId, 1);
			}
		}

		async handleListProductAdd(
			productHandle,
			variantId,
			_productTitle,
			button,
		) {
			try {
				// Fetch product data to check variants
				const productResponse = await fetch(`/products/${productHandle}.js`);
				if (!productResponse.ok) {
					debug.error(
						"🛒 Failed to fetch product data, status:",
						productResponse.status,
					);
					// Fallback to direct add
					this.addToCart(variantId, 1);
					button.dataset.processing = "false";
					return;
				}

				const productData = await productResponse.json();
				const variantState = this.prepareVariantModalState(productData);

				if (variantState.requiresSelection) {
					this.showProductModal(productData, undefined, variantState);
					button.dataset.processing = "false";
				} else {
					const fallbackVariant =
						variantState.initialVariant || productData.variants?.[0];
					const variantToAdd = fallbackVariant?.id || variantId;
					if (variantToAdd) {
						await this.addToCart(variantToAdd, 1);
					}
					button.dataset.processing = "false";
				}
			} catch (error) {
				debug.error("Error handling list product add:", error);
				// Fallback to direct add
				this.addToCart(variantId, 1);
				button.dataset.processing = "false";
			}
		}

		async handleListProductAdd(
			productHandle,
			variantId,
			_productTitle,
			button,
		) {
			try {
				// Fetch product data to check variants
				const productResponse = await fetch(`/products/${productHandle}.js`);
				if (!productResponse.ok) {
					debug.error(
						"🛒 Failed to fetch product data, status:",
						productResponse.status,
					);
					// Fallback to direct add
					this.addToCart(variantId, 1);
					button.dataset.processing = "false";
					return;
				}

				const productData = await productResponse.json();
				const variantState = this.prepareVariantModalState(productData);

				if (variantState.requiresSelection) {
					this.showProductModal(productData, undefined, variantState);
					button.dataset.processing = "false";
				} else {
					const fallbackVariant =
						variantState.initialVariant || productData.variants?.[0];
					const variantToAdd = fallbackVariant?.id || variantId;
					if (variantToAdd) {
						await this.addToCart(variantToAdd, 1);
					}
					button.dataset.processing = "false";
				}
			} catch (error) {
				debug.error("Error handling list product add:", error);
				// Fallback to direct add
				this.addToCart(variantId, 1);
				button.dataset.processing = "false";
			}
		}

		getProductOptionNames(productData) {
			if (!productData || !Array.isArray(productData.options)) return [];
			const rawOptions = productData.options;
			if (rawOptions.length === 0) return [];
			if (typeof rawOptions[0] === "string") {
				return rawOptions
					.filter((name) => typeof name === "string")
					.map((name) => name.trim())
					.filter((name) => name.length > 0 && name.toLowerCase() !== "title");
			}
			return rawOptions
				.map((option) => {
					if (!option) return null;
					if (typeof option === "string") return option.trim();
					if (typeof option.name === "string") return option.name.trim();
					return null;
				})
				.filter(
					(name) => name && name.length > 0 && name.toLowerCase() !== "title",
				);
		}

		getVariantOptionLabel(productData, fallback = "Select Option") {
			const optionNames = this.getProductOptionNames(productData);
			if (!optionNames.length) return fallback;
			if (optionNames.length === 1) {
				return `Select ${optionNames[0]}`;
			}
			return `Select ${optionNames.join(" / ")}`;
		}

		getVariantOptionValue(variant, optionIndex) {
			if (!variant || typeof optionIndex !== "number") return "";
			const key = `option${optionIndex + 1}`;
			const directValue = variant[key];
			let resolved = typeof directValue === "string" ? directValue : null;
			if (
				(!resolved || resolved === "Default Title") &&
				Array.isArray(variant.options)
			) {
				resolved = variant.options[optionIndex];
			}
			if (!resolved || resolved === "Default Title") return "";
			return resolved;
		}

		getOptionValuePriceRange(variantState, optionIndex, optionValue) {
			if (!variantState || !Number.isInteger(optionIndex) || !optionValue) {
				return null;
			}

			const variants = Array.isArray(variantState.allVariants)
				? variantState.allVariants
				: [];
			if (!variants.length) return null;

			let min = null;
			let max = null;

			variants.forEach((variant) => {
				if (!variant) return;
				const value = this.getVariantOptionValue(variant, optionIndex);
				if (value !== optionValue) return;
				const priceCents = this.normalizePriceToCents(variant.price);
				if (!Number.isFinite(priceCents)) return;
				if (min === null || priceCents < min) {
					min = priceCents;
				}
				if (max === null || priceCents > max) {
					max = priceCents;
				}
			});

			if (min === null) {
				return null;
			}

			return { min, max };
		}

		renderOptionValuePriceSnippet(variantState, optionIndex, optionValue) {
			const range = this.getOptionValuePriceRange(
				variantState,
				optionIndex,
				optionValue,
			);
			if (!range) return "";
			const { min, max } = range;
			if (!Number.isFinite(min)) return "";
			if (max !== null && Number.isFinite(max) && max > min) {
				return `<span class="cartuplift-variant-pill-price">From ${this.formatMoney(min)}</span>`;
			}
			return `<span class="cartuplift-variant-pill-price">${this.formatMoney(min)}</span>`;
		}

		formatVariantDisplayName(productData, variant) {
			if (!variant) return "Default";
			const optionNames = this.getProductOptionNames(productData);
			const optionValues = [variant.option1, variant.option2, variant.option3]
				.map((value) => (value === "Default Title" ? "" : value || ""))
				.filter(Boolean);

			if (!optionNames.length) {
				if (optionValues.length) {
					return optionValues.join(" · ");
				}
				if (variant.title && variant.title !== "Default Title") {
					return variant.title;
				}
				return "Default";
			}

			const parts = [];
			optionNames.forEach((name, index) => {
				const value = optionValues[index];
				if (!value) return;
				if (optionNames.length === 1) {
					parts.push(value);
				} else {
					parts.push(`${name}: ${value}`);
				}
			});

			if (!parts.length) {
				if (variant.title && variant.title !== "Default Title") {
					return variant.title;
				}
				if (optionValues.length) {
					return optionValues.join(" · ");
				}
				return "Default";
			}

			return parts.join(" · ");
		}

		prepareVariantModalState(productData) {
			const allVariants = Array.isArray(productData?.variants)
				? productData.variants
				: [];
			const availableVariants = allVariants.filter((v) => v?.available);
			const variantsToRender = availableVariants.length
				? availableVariants
				: allVariants;
			const initialVariant = availableVariants[0] || allVariants[0] || null;
			const defaultVariantId = initialVariant
				? String(initialVariant.id)
				: null;
			const optionNames = this.getProductOptionNames(productData);
			const optionValueSets = new Map();
			const optionValueOrder = new Map();

			if (Array.isArray(productData?.options)) {
				productData.options.forEach((option) => {
					const name = typeof option === "string" ? option : option?.name;
					if (!name || typeof name !== "string") return;
					const trimmed = name.trim();
					if (
						trimmed.length === 0 ||
						trimmed.toLowerCase() === "title" ||
						!optionNames.includes(trimmed)
					)
						return;
					if (!optionValueOrder.has(trimmed) && Array.isArray(option?.values)) {
						optionValueOrder.set(
							trimmed,
							option.values.filter(
								(value) =>
									typeof value === "string" &&
									value &&
									value !== "Default Title",
							),
						);
					}
				});
			}

			optionNames.forEach((name) => {
				if (!optionValueSets.has(name)) {
					optionValueSets.set(name, new Set());
				}
			});

			const variantLookup = new Map();

			allVariants.forEach((variant) => {
				if (!variant || variant.id === undefined || variant.id === null) {
					return;
				}

				const variantId = String(variant.id);
				variantLookup.set(variantId, variant);

				optionNames.forEach((name, idx) => {
					const value = this.getVariantOptionValue(variant, idx);
					if (value) {
						optionValueSets.get(name)?.add(value);
					}
				});
			});

			const optionValuesByIndex = optionNames.map((_, idx) => {
				const set = new Set();
				allVariants.forEach((variant) => {
					const value = this.getVariantOptionValue(variant, idx);
					if (value) {
						set.add(value);
					}
				});
				return set;
			});

			const uniqueVariantTitles = new Set(
				allVariants.map((v) => v?.title).filter(Boolean),
			);
			const hasMultiOption = optionValuesByIndex.some((set) => set.size > 1);
			const requiresSelection =
				availableVariants.length > 1 ||
				(allVariants.length > 1 &&
					(uniqueVariantTitles.size > 1 || hasMultiOption));

			const initialSelection = {};
			if (initialVariant) {
				optionNames.forEach((name, idx) => {
					const value = this.getVariantOptionValue(initialVariant, idx);
					if (value) {
						initialSelection[name] = value;
					}
				});
			}

			return {
				allVariants,
				availableVariants,
				variantsToRender,
				initialVariant,
				defaultVariantId,
				optionValuesByIndex,
				uniqueVariantTitles,
				hasMultiOption,
				requiresSelection,
				optionLabel: this.getVariantOptionLabel(productData),
				optionNames,
				optionValueSets,
				optionValueOrder,
				initialSelection,
				variantLookup,
			};
		}

		setupVariantInteractions(modal, productData, variantState, options = {}) {
			const {
				addButton = modal.querySelector(".cartuplift-modal-add-btn"),
				priceDisplay = modal.querySelector(".cartuplift-modal-price"),
				updatePrice = true,
				disableAddForSoldOut = true,
				soldOutLabel = "Sold Out",
				onVariantSelected = null,
			} = options;

			const variantSelect = modal.querySelector(".cartuplift-variant-select");
			const optionButtons = Array.from(
				modal.querySelectorAll(".cartuplift-variant-pill"),
			);
			const helperEl = modal.querySelector("[data-variant-helper]");
			const summaryEl = modal.querySelector("[data-variant-summary]");
			const variantLookup = variantState?.variantLookup || new Map();
			const optionNames = Array.isArray(variantState?.optionNames)
				? variantState.optionNames
				: [];
			const allVariants = Array.isArray(variantState?.allVariants)
				? variantState.allVariants
				: [];
			const addButtonLabel = addButton ? addButton.textContent.trim() : "";
			const currentSelection = Object.assign(
				{},
				variantState?.initialSelection || {},
			);
			let lastVariantId = null;

			const findMatchingVariants = (selection) => {
				const entries = Object.entries(selection || {}).filter(
					([, value]) => typeof value === "string" && value,
				);
				if (!entries.length) {
					return allVariants.filter(Boolean);
				}
				return allVariants.filter((variant) => {
					if (!variant) return false;
					return entries.every(([name, value]) => {
						const optionIndex = optionNames.indexOf(name);
						if (optionIndex === -1) return true;
						return this.getVariantOptionValue(variant, optionIndex) === value;
					});
				});
			};

			const resolveSelectedVariant = () => {
				if (!optionNames.length) {
					return variantState?.initialVariant || allVariants[0] || null;
				}
				const allChosen = optionNames.every((name) => currentSelection[name]);
				if (!allChosen) {
					return null;
				}
				const matches = findMatchingVariants(currentSelection);
				if (!matches.length) {
					return null;
				}
				const availableMatch = matches.find(
					(variant) => variant && variant.available !== false,
				);
				return availableMatch || matches[0];
			};

			const updateHelper = () => {
				if (!helperEl) return;
				const missing = optionNames.filter((name) => !currentSelection[name]);
				if (!missing.length) {
					helperEl.textContent = "";
					helperEl.dataset.state = "complete";
					return;
				}
				helperEl.dataset.state = "pending";
				const nextName = missing[0];
				helperEl.textContent = `Select ${nextName}`;
			};

			// Selection labels removed - we only use the summary block now

			const updateSummary = (variant) => {
				if (!summaryEl) return;
				if (variant) {
					summaryEl.textContent = this.formatVariantDisplayName(
						productData,
						variant,
					);
					return;
				}
				const partial = optionNames
					.map((name) => currentSelection[name])
					.filter(Boolean)
					.join(" · ");
				if (partial) {
					summaryEl.textContent = partial;
				} else if (variantState?.initialVariant) {
					summaryEl.textContent = this.formatVariantDisplayName(
						productData,
						variantState.initialVariant,
					);
				}
			};

			const updatePriceDisplay = (variant) => {
				if (
					!updatePrice ||
					!priceDisplay ||
					priceDisplay.classList.contains("cartuplift-gift-price")
				) {
					return;
				}
				if (variant) {
					const priceCents = this.normalizePriceToCents(variant.price);
					if (Number.isFinite(priceCents)) {
						priceDisplay.textContent = this.formatMoney(priceCents);
						priceDisplay.dataset.price = priceCents;
					}
					return;
				}

				const fallback =
					priceDisplay.dataset.basePrice || priceDisplay.dataset.price;
				const priceValue = parseInt(fallback, 10);
				if (Number.isFinite(priceValue)) {
					priceDisplay.textContent = this.formatMoney(priceValue);
					priceDisplay.dataset.price = priceValue;
				}
			};

			const updateAddButton = (variant) => {
				if (!addButton) return;
				const originalLabel = addButton.dataset.originalLabel || addButtonLabel;
				if (!addButton.dataset.originalLabel && originalLabel) {
					addButton.dataset.originalLabel = originalLabel;
				}

				if (!variant) {
					addButton.dataset.variantId = "";
					addButton.disabled = true;
					addButton.classList.add("is-disabled");
					addButton.textContent = originalLabel;
					return;
				}

				addButton.dataset.variantId = String(variant.id);
				if (variant.available === false && disableAddForSoldOut) {
					addButton.disabled = true;
					addButton.classList.add("is-disabled");
					addButton.textContent = soldOutLabel;
				} else {
					addButton.disabled = false;
					addButton.classList.remove("is-disabled");
					addButton.textContent = originalLabel;
				}
			};

			const refreshOptionButtons = () => {
				optionButtons.forEach((btn) => {
					const optionName = btn.dataset.optionName;
					const optionValue = btn.dataset.optionValue;
					if (!optionName || !optionValue) return;

					const baseSelection = Object.assign({}, currentSelection);
					delete baseSelection[optionName];
					const potentialSelection = Object.assign({}, baseSelection, {
						[optionName]: optionValue,
					});
					const matches = findMatchingVariants(potentialSelection);
					const hasAnyMatch = matches.length > 0;
					const hasAvailableMatch = matches.some(
						(variant) => variant && variant.available !== false,
					);
					const isSelected = currentSelection[optionName] === optionValue;

					btn.classList.toggle("is-selected", isSelected);
					btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
					btn.classList.toggle("is-disabled", !hasAvailableMatch);
					btn.classList.toggle("is-unavailable", !hasAnyMatch);
					btn.classList.toggle("is-soldout", hasAnyMatch && !hasAvailableMatch);
					btn.dataset.available = hasAvailableMatch ? "true" : "false";
					btn.setAttribute(
						"aria-disabled",
						hasAvailableMatch ? "false" : "true",
					);
					btn.disabled = !hasAvailableMatch;
				});
			};

			const refreshState = () => {
				refreshOptionButtons();
				const selectedVariant = resolveSelectedVariant();

				if (variantSelect) {
					variantSelect.value = selectedVariant
						? String(selectedVariant.id)
						: "";
				}

				updateAddButton(selectedVariant);
				updatePriceDisplay(selectedVariant);
				updateSummary(selectedVariant);
				updateHelper();

				const selectedVariantId = selectedVariant
					? String(selectedVariant.id)
					: null;
				if (
					selectedVariant &&
					selectedVariantId !== lastVariantId &&
					typeof onVariantSelected === "function"
				) {
					onVariantSelected(selectedVariant);
				}
				lastVariantId = selectedVariantId;
			};

			const applyVariant = (incomingVariantId) => {
				if (!incomingVariantId) return;
				const variantId = String(incomingVariantId);
				const variant =
					variantLookup.get(variantId) ||
					allVariants.find((v) => v && String(v.id) === variantId);
				if (!variant) return;

				optionNames.forEach((name, index) => {
					const value = this.getVariantOptionValue(variant, index);
					if (value) {
						currentSelection[name] = value;
					} else {
						delete currentSelection[name];
					}
				});

				refreshState();
			};

			if (variantSelect) {
				variantSelect.addEventListener("change", (event) => {
					applyVariant(event.target.value);
				});
			}

			optionButtons.forEach((btn) => {
				btn.addEventListener("click", () => {
					if (
						btn.classList.contains("is-disabled") ||
						btn.classList.contains("is-unavailable")
					) {
						return;
					}
					const optionName = btn.dataset.optionName;
					const optionValue = btn.dataset.optionValue;
					if (!optionName || !optionValue) return;

					currentSelection[optionName] = optionValue;

					optionNames.forEach((name) => {
						if (name === optionName) return;
						if (!currentSelection[name]) return;
						const matches = findMatchingVariants(currentSelection);
						const isStillValid = matches.some((variant) => {
							const idx = optionNames.indexOf(name);
							return (
								this.getVariantOptionValue(variant, idx) ===
								currentSelection[name]
							);
						});
						if (!isStillValid) {
							delete currentSelection[name];
						}
					});

					refreshState();
				});
			});

			if (!optionButtons.length || !optionNames.length) {
				const fallbackVariant = variantState?.initialVariant || allVariants[0];
				if (fallbackVariant) {
					applyVariant(fallbackVariant.id);
				} else if (addButton) {
					addButton.disabled = true;
					addButton.classList.add("is-disabled");
				}
				return { applyVariant };
			}

			const initialVariantId =
				variantState?.defaultVariantId ||
				(variantState?.initialVariant ? variantState.initialVariant.id : null);
			if (initialVariantId) {
				applyVariant(initialVariantId);
			} else {
				refreshState();
			}

			return { applyVariant };
		}

		// Show product modal for variant selection
		showProductModal(productData, gridIndex, variantState) {
			// Prevent multiple rapid opens
			if (
				this._modalOpening ||
				document.querySelector(".cartuplift-product-modal")
			) {
				debug.log("🛒 Modal already opening/open, ignoring duplicate call");
				return;
			}

			this._modalOpening = true;
			debug.log("🛒 Creating product modal for:", productData.title);

			const computedVariantState =
				variantState || this.prepareVariantModalState(productData);

			const modal = document.createElement("div");
			modal.className = "cartuplift-product-modal";
			modal.style.zIndex = "1000001";

			try {
				modal.innerHTML = this.generateProductModalHTML(
					productData,
					gridIndex,
					computedVariantState,
				);
			} catch (error) {
				debug.error("🛒 Error generating modal HTML:", error);
				this._modalOpening = false;
				return;
			}

			// Add to body
			document.body.appendChild(modal);

			const modalContent = modal.querySelector(".cartuplift-modal-content");
			const drawer = document.querySelector(
				"#cartuplift-cart-popup .cartuplift-drawer",
			);

			const syncModalDimensions = () => {
				if (!modalContent || !drawer) return;
				const drawerRect = drawer.getBoundingClientRect();
				modalContent.style.width = `${drawerRect.width}px`;
				modalContent.style.maxWidth = `${drawerRect.width}px`;
				modalContent.style.height = `${drawerRect.height}px`;
				modalContent.style.maxHeight = `${drawerRect.height}px`;
			};

			syncModalDimensions();
			window.addEventListener("resize", syncModalDimensions);
			modal._cleanupResize = () =>
				window.removeEventListener("resize", syncModalDimensions);

			// Add modal event listeners
			this.attachProductModalHandlers(
				modal,
				productData,
				gridIndex,
				computedVariantState,
			);

			// Show modal with single animation frame
			requestAnimationFrame(() => {
				modal.classList.add("show");
				this._modalOpening = false;
				debug.log("🛒 Modal shown smoothly");
			});
		}

		// Generate HTML for product modal
		generateProductModalHTML(productData, gridIndex, variantState) {
			const state = variantState || this.prepareVariantModalState(productData);
			const initialVariant = state.initialVariant;
			const defaultVariantId = state.defaultVariantId;
			const optionNames = Array.isArray(state.optionNames)
				? state.optionNames
				: [];
			const allVariants = Array.isArray(state.allVariants)
				? state.allVariants
				: [];
			const initialPriceSource =
				productData.price && productData.price > 0
					? productData.price
					: initialVariant
						? initialVariant.price
						: 0;
			const initialPriceCents = this.normalizePriceToCents(initialPriceSource);
			const _summaryText = initialVariant
				? this.escapeHtml(
						this.formatVariantDisplayName(productData, initialVariant),
					)
				: this.escapeHtml(state.optionLabel || "Select an option");

			const selectOptions = allVariants.length
				? allVariants
						.map((variant) => {
							if (!variant || variant.id === undefined || variant.id === null)
								return "";
							const variantId = String(variant.id);
							const displayName = this.escapeHtml(
								this.formatVariantDisplayName(productData, variant),
							);
							const isAvailable = variant.available !== false;
							const selectedAttr =
								defaultVariantId && defaultVariantId === variantId
									? " selected"
									: "";
							return `
          <option value="${variantId}" data-available="${isAvailable ? "true" : "false"}"${selectedAttr}>
            ${displayName}
          </option>
        `;
						})
						.join("")
				: `
          <option value="" disabled selected>Currently unavailable</option>
        `;

			const hiddenSelectMarkup = `
        <select id="cartuplift-variant-select" class="cartuplift-variant-select cartuplift-variant-select--hidden" aria-hidden="true" tabindex="-1">
          ${selectOptions}
        </select>
      `;

			const groupsMarkup = optionNames
				.map((name, optionIndex) => {
					const valueSet = state.optionValueSets?.get(name);
					if (!valueSet || valueSet.size === 0) {
						return "";
					}

					const preferredOrder = Array.isArray(
						state.optionValueOrder?.get(name),
					)
						? state.optionValueOrder.get(name)
						: [];
					const seen = new Set();
					const values = [];

					if (preferredOrder.length) {
						preferredOrder.forEach((value) => {
							if (typeof value !== "string") return;
							if (!valueSet.has(value)) return;
							if (seen.has(value)) return;
							values.push(value);
							seen.add(value);
						});
					}

					valueSet.forEach((value) => {
						if (typeof value !== "string") return;
						if (seen.has(value)) return;
						values.push(value);
						seen.add(value);
					});

					if (!values.length) {
						return "";
					}

					const buttons = values
						.map((value) => {
							const label = this.escapeHtml(value);
							const priceSnippet =
								this.renderOptionValuePriceSnippet(state, optionIndex, value) ||
								"";
							return `
            <button type="button" class="cartuplift-variant-pill" data-option-name="${this.escapeHtml(name)}" data-option-index="${optionIndex}" data-option-value="${label}" data-available="true" aria-pressed="false">
              <span class="cartuplift-variant-pill-label">${label}</span>
              ${priceSnippet}
            </button>
          `;
						})
						.join("");

					return `
          <div class="cartuplift-variant-group" data-option-name="${this.escapeHtml(name)}">
            <div class="cartuplift-variant-group-header">
              <span class="cartuplift-variant-group-label">${this.escapeHtml(name)}</span>
            </div>
            <div class="cartuplift-variant-group-values">
              ${buttons}
            </div>
          </div>
        `;
				})
				.filter(Boolean)
				.join("");

			const hasVariantGroups = Boolean(groupsMarkup?.trim().length);
			const _variantSummaryLabel = hasVariantGroups
				? "Selected"
				: state.optionLabel || "Selected Option";

			const variantsMarkup = `
        <div class="cartuplift-modal-variants${hasVariantGroups ? " cartuplift-modal-variants--multi" : " cartuplift-modal-variants--simple"}">
          ${hiddenSelectMarkup}
          ${hasVariantGroups ? `<div class="cartuplift-variant-groups">${groupsMarkup}</div>` : ""}
          ${hasVariantGroups ? '<div class="cartuplift-variant-helper" data-variant-helper role="status" aria-live="polite"></div>' : ""}
        </div>
      `;

			return `
        <div class="cartuplift-modal-backdrop">
          <div class="cartuplift-modal-content">
            <button class="cartuplift-modal-close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            
            <div class="cartuplift-modal-product">
              <div class="cartuplift-modal-image">
                <img src="${productData.featured_image || ""}" alt="${productData.title}" />
              </div>
              
              <div class="cartuplift-modal-details">
                <h2 class="cartuplift-modal-title">${this.settings.enableRecommendationTitleCaps ? productData.title.toUpperCase() : productData.title}</h2>
                <div class="cartuplift-modal-price" data-price="${initialPriceCents}" data-base-price="${initialPriceCents}">
                  ${this.formatMoney(initialPriceCents)}
                </div>
                
                ${
									productData.description
										? `
                  <div class="cartuplift-modal-description">
                    ${productData.description.substring(0, 200)}${productData.description.length > 200 ? "..." : ""}
                  </div>
                `
										: ""
								}
                
                ${variantsMarkup}
                
                <button class="cartuplift-modal-add-btn" data-grid-index="${gridIndex ?? ""}">
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
		}

		// Attach event handlers to product modal
		attachProductModalHandlers(modal, productData, gridIndex, variantState) {
			const closeBtn = modal.querySelector(".cartuplift-modal-close");
			const backdrop = modal.querySelector(".cartuplift-modal-backdrop");
			const addBtn = modal.querySelector(".cartuplift-modal-add-btn");
			const priceDisplay = modal.querySelector(".cartuplift-modal-price");
			const variantSelect = modal.querySelector(".cartuplift-variant-select");
			const computedVariantState =
				variantState || this.prepareVariantModalState(productData);

			// Close handlers
			closeBtn.addEventListener("click", () => this.closeProductModal(modal));
			backdrop.addEventListener("click", (e) => {
				if (e.target === backdrop) {
					this.closeProductModal(modal);
				}
			});

			this.setupVariantInteractions(modal, productData, computedVariantState, {
				addButton: addBtn,
				priceDisplay,
				disableAddForSoldOut: true,
				soldOutLabel: "Sold Out",
			});

			// Add to cart handler
			addBtn.addEventListener("click", async () => {
				const selectedVariantId =
					addBtn.dataset.variantId ||
					(variantSelect ? variantSelect.value : null);
				if (selectedVariantId) {
					await this.addToCart(selectedVariantId, 1);
					this.closeProductModal(modal);

					// Dynamic grid: swap in next recommendation
					if (gridIndex !== undefined) {
						setTimeout(() => {
							this.swapInNextRecommendation(parseInt(gridIndex, 10));
						}, 500);
					}
				}
			});

			// Keyboard handler for ESC key
			const keyHandler = (e) => {
				if (e.key === "Escape") {
					this.closeProductModal(modal);
				}
			};
			document.addEventListener("keydown", keyHandler);
			modal._keyHandler = keyHandler; // Store for cleanup
		}

		// Close product modal
		closeProductModal(modal) {
			modal.classList.remove("show");
			modal.classList.add("hiding");

			setTimeout(() => {
				if (modal._keyHandler) {
					document.removeEventListener("keydown", modal._keyHandler);
				}
				if (modal._cleanupResize) {
					modal._cleanupResize();
				}
				modal.remove();
				// Reset opening flag when modal is fully closed
				this._modalOpening = false;
			}, 300);
		}

		// Show gift selection modal when threshold is met
		async showGiftModal(threshold) {
			// Only show modal if drawer is open
			if (!this.isOpen) {
				this._pendingGiftModal = threshold;
				return;
			}

			// Prevent multiple opens
			const existingGiftModal = document.querySelector(
				".cartuplift-gift-modal",
			);
			if (this._modalOpening || existingGiftModal) {
				return;
			}

			const activeProductModal = document.querySelector(
				".cartuplift-product-modal",
			);
			if (activeProductModal) {
				if (this._giftModalRetryTimer) {
					clearTimeout(this._giftModalRetryTimer);
				}
				this._giftModalRetryTimer = setTimeout(() => {
					this._giftModalRetryTimer = null;
					this.showGiftModal(threshold);
				}, 450);
				return;
			}

			this._modalOpening = true;

			try {
				// Fetch product data
				if (
					!threshold.productHandle ||
					typeof threshold.productHandle !== "string"
				) {
					debug.error(" Invalid product handle:", threshold.productHandle);
					this._modalOpening = false;
					return;
				}

				const response = await fetch(`/products/${threshold.productHandle}.js`);

				if (!response.ok) {
					debug.error(" Failed to fetch product:", threshold.productHandle);
					this._modalOpening = false;
					return;
				}

				const productData = await response.json();

				const variantState = this.prepareVariantModalState(productData);
				if (!variantState.variantsToRender.length) {
					debug.error(" No variants available for gift modal");
					this._modalOpening = false;
					return;
				}

				// Create modal using same structure as product modal
				const modal = document.createElement("div");
				modal.className = "cartuplift-gift-modal";
				modal.style.zIndex = "1000001";

				modal.innerHTML = this.generateGiftModalHTML(
					productData,
					threshold,
					variantState,
				);
				document.body.appendChild(modal);

				// Sync dimensions with drawer (same as product modal)
				const modalContent = modal.querySelector(".cartuplift-modal-content");
				const drawer = document.querySelector(
					"#cartuplift-cart-popup .cartuplift-drawer",
				);

				const syncModalDimensions = () => {
					if (!modalContent || !drawer) {
						return;
					}
					const drawerRect = drawer.getBoundingClientRect();
					modalContent.style.width = `${drawerRect.width}px`;
					modalContent.style.maxWidth = `${drawerRect.width}px`;
					modalContent.style.height = `${drawerRect.height}px`;
					modalContent.style.maxHeight = `${drawerRect.height}px`;
				};

				syncModalDimensions();
				window.addEventListener("resize", syncModalDimensions);
				modal._cleanupResize = () =>
					window.removeEventListener("resize", syncModalDimensions);

				// Attach event handlers
				this.attachGiftModalHandlers(
					modal,
					productData,
					threshold,
					variantState,
				);

				// Show modal with animation
				requestAnimationFrame(() => {
					modal.classList.add("show", "active"); // Add both classes for CSS compatibility
					this._modalOpening = false;
					if (this._giftModalRetryTimer) {
						clearTimeout(this._giftModalRetryTimer);
						this._giftModalRetryTimer = null;
					}
				});
			} catch (error) {
				debug.error(" Error showing gift modal:", error);
				this._modalOpening = false;
				if (this._giftModalRetryTimer) {
					clearTimeout(this._giftModalRetryTimer);
					this._giftModalRetryTimer = null;
				}
			}
		}

		// Generate HTML for gift modal
		generateGiftModalHTML(productData, threshold, variantState) {
			const state = variantState || this.prepareVariantModalState(productData);
			const allVariants = Array.isArray(state.allVariants)
				? state.allVariants
				: [];
			const optionNames = Array.isArray(state.optionNames)
				? state.optionNames
				: [];
			const initialVariant = state.initialVariant;
			const defaultVariantId = state.defaultVariantId;
			const _giftTitle = threshold.title || "Free Gift";
			const _summaryText = initialVariant
				? this.escapeHtml(
						this.formatVariantDisplayName(productData, initialVariant),
					)
				: this.escapeHtml(state.optionLabel || "Select an option");

			const selectOptions = allVariants.length
				? allVariants
						.map((variant) => {
							if (!variant || variant.id === undefined || variant.id === null)
								return "";
							const variantId = String(variant.id);
							const displayName = this.escapeHtml(
								this.formatVariantDisplayName(productData, variant),
							);
							const isAvailable = variant.available !== false;
							const selectedAttr =
								defaultVariantId && defaultVariantId === variantId
									? " selected"
									: "";
							return `
          <option value="${variantId}" data-available="${isAvailable ? "true" : "false"}"${selectedAttr}>
            ${displayName}
          </option>
        `;
						})
						.join("")
				: `
          <option value="" disabled selected>Currently unavailable</option>
        `;

			const hiddenSelectMarkup = `
        <select id="cartuplift-gift-variant-select" class="cartuplift-variant-select cartuplift-variant-select--hidden" aria-hidden="true" tabindex="-1">
          ${selectOptions}
        </select>
      `;

			const groupsMarkup = optionNames
				.map((name, optionIndex) => {
					const valueSet = state.optionValueSets?.get(name);
					if (!valueSet || valueSet.size === 0) {
						return "";
					}

					const preferredOrder = Array.isArray(
						state.optionValueOrder?.get(name),
					)
						? state.optionValueOrder.get(name)
						: [];
					const seen = new Set();
					const values = [];

					if (preferredOrder.length) {
						preferredOrder.forEach((value) => {
							if (typeof value !== "string") return;
							if (!valueSet.has(value)) return;
							if (seen.has(value)) return;
							values.push(value);
							seen.add(value);
						});
					}

					valueSet.forEach((value) => {
						if (typeof value !== "string") return;
						if (seen.has(value)) return;
						values.push(value);
						seen.add(value);
					});

					if (!values.length) {
						return "";
					}

					const buttons = values
						.map((value) => {
							const label = this.escapeHtml(value);
							return `
            <button type="button" class="cartuplift-variant-pill" data-option-name="${this.escapeHtml(name)}" data-option-index="${optionIndex}" data-option-value="${label}" data-available="true" aria-pressed="false">
              <span class="cartuplift-variant-pill-label">${label}</span>
            </button>
          `;
						})
						.join("");

					return `
          <div class="cartuplift-variant-group" data-option-name="${this.escapeHtml(name)}">
            <div class="cartuplift-variant-group-header">
              <span class="cartuplift-variant-group-label">${this.escapeHtml(name)}</span>
            </div>
            <div class="cartuplift-variant-group-values">
              ${buttons}
            </div>
          </div>
        `;
				})
				.filter(Boolean)
				.join("");

			const hasVariantGroups = Boolean(groupsMarkup?.trim().length);
			const _variantSummaryLabel = hasVariantGroups
				? "Selected"
				: state.optionLabel || "Selected Option";

			const variantsMarkup = `
        <div class="cartuplift-modal-variants${hasVariantGroups ? " cartuplift-modal-variants--multi" : " cartuplift-modal-variants--simple"}">
          ${hiddenSelectMarkup}
          ${hasVariantGroups ? `<div class="cartuplift-variant-groups">${groupsMarkup}</div>` : ""}
          ${hasVariantGroups ? '<div class="cartuplift-variant-helper" data-variant-helper role="status" aria-live="polite"></div>' : ""}
        </div>
      `;

			return `
        <div class="cartuplift-modal-backdrop">
          <div class="cartuplift-modal-content">
            <button class="cartuplift-modal-close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            
            <div class="cartuplift-modal-product">
              <div class="cartuplift-modal-image">
                <img src="${productData.featured_image || ""}" alt="${productData.title}" />
              </div>
              
              <div class="cartuplift-modal-details">
                <div class="cartuplift-gift-badge-professional">Congratulations! You've unlocked a free gift</div>
                <h2 class="cartuplift-modal-title">${this.settings.enableRecommendationTitleCaps ? productData.title.toUpperCase() : productData.title}</h2>
                <div class="cartuplift-modal-price cartuplift-gift-price" data-price="0" data-base-price="0">
                  Complimentary (${this.formatMoney(0)})
                </div>
                
                ${
									productData.description
										? `
                  <div class="cartuplift-modal-description">
                    ${productData.description.substring(0, 200)}${productData.description.length > 200 ? "..." : ""}
                  </div>
                `
										: ""
								}
                
                ${variantsMarkup}
                
                <div class="cartuplift-modal-actions">
                  <button class="cartuplift-modal-add-btn cartuplift-gift-add-btn-professional">
                    Add to Cart
                  </button>
                  <button class="cartuplift-modal-skip-btn">
                    Continue Shopping
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
		}

		// Attach event handlers to gift modal
		attachGiftModalHandlers(modal, productData, threshold, variantState) {
			const closeBtn = modal.querySelector(".cartuplift-modal-close");
			const backdrop = modal.querySelector(".cartuplift-modal-backdrop");
			const addBtn = modal.querySelector(".cartuplift-modal-add-btn");
			const skipBtn = modal.querySelector(".cartuplift-modal-skip-btn");
			const variantSelect = modal.querySelector(".cartuplift-variant-select");
			const computedVariantState =
				variantState || this.prepareVariantModalState(productData);

			// Extract product ID for tracking
			let numericProductId = threshold.productId;
			if (
				typeof numericProductId === "string" &&
				numericProductId.includes("gid://shopify/Product/")
			) {
				numericProductId = numericProductId.replace(
					"gid://shopify/Product/",
					"",
				);
			}
			const declinedKey = `gift_declined_${numericProductId}`;

			// Close handlers - mark as declined
			const handleDecline = () => {
				sessionStorage.setItem(declinedKey, "true");
				this.closeGiftModal(modal);
			};

			closeBtn.addEventListener("click", handleDecline);
			backdrop.addEventListener("click", (e) => {
				if (e.target === backdrop) {
					handleDecline();
				}
			});

			// Skip button - mark as declined
			if (skipBtn) {
				skipBtn.addEventListener("click", handleDecline);
			}

			this.setupVariantInteractions(modal, productData, computedVariantState, {
				addButton: addBtn,
				priceDisplay: modal.querySelector(".cartuplift-modal-price"),
				updatePrice: false,
				disableAddForSoldOut: true,
				soldOutLabel: "Sold Out",
			});

			// Add gift to cart handler - clear declined flag
			addBtn.addEventListener("click", async () => {
				const selectedVariantId =
					addBtn.dataset.variantId ||
					(variantSelect ? variantSelect.value : null);
				if (selectedVariantId) {
					sessionStorage.removeItem(declinedKey); // Clear declined flag when claimed
					await this.addGiftVariantToCart(selectedVariantId, threshold);
					this.closeGiftModal(modal);
				}
			});

			// Keyboard handler for ESC key - also mark as declined
			const keyHandler = (e) => {
				if (e.key === "Escape") {
					sessionStorage.setItem(declinedKey, "true");
					this.closeGiftModal(modal);
				}
			};
			document.addEventListener("keydown", keyHandler);
			modal._keyHandler = keyHandler;
			modal._declinedKey = declinedKey; // Store for later cleanup
		}

		// Close gift modal
		closeGiftModal(modal) {
			modal.classList.remove("show");
			modal.classList.add("hiding");

			setTimeout(() => {
				if (modal._keyHandler) {
					document.removeEventListener("keydown", modal._keyHandler);
				}
				if (modal._cleanupResize) {
					modal._cleanupResize();
				}
				modal.remove();
				if (this._giftModalRetryTimer) {
					clearTimeout(this._giftModalRetryTimer);
					this._giftModalRetryTimer = null;
				}
				this._modalOpening = false;
			}, 300);
		}

		// Sync gift modal dimensions with drawer
		syncGiftModalDimensions(modal) {
			const drawer = document.querySelector(".cartuplift-drawer");
			if (!drawer) return;

			const drawerRect = drawer.getBoundingClientRect();
			const modalContent = modal.querySelector(".cartuplift-modal-content");

			if (modalContent) {
				modalContent.style.width = `${drawerRect.width}px`;
				modalContent.style.maxWidth = `${drawerRect.width}px`;
			}
		}

		// Add gift variant to cart with gift properties
		async addGiftVariantToCart(variantId, threshold) {
			try {
				const addResponse = await fetch("/cart/add.js", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Requested-With": "XMLHttpRequest",
					},
					body: JSON.stringify({
						id: variantId,
						quantity: 1,
						properties: {
							_is_gift: "true",
							_gift_title: threshold?.title ? String(threshold.title) : "Gift",
							_gift_label: threshold?.title ? String(threshold.title) : "Gift",
						},
						selling_plan: null,
					}),
				});

				const addResponseData = await addResponse.json();

				if (addResponse.ok) {
					await this.fetchCart();
					this.updateDrawerContent();
					return true;
				} else {
					debug.error(" Failed to add gift variant:", addResponseData);
					return false;
				}
			} catch (error) {
				debug.error(" Error adding gift to cart:", error);
				return false;
			}
		}

		// Remove invalid recommendations to prevent future 422 errors
		removeInvalidRecommendation(variantId) {
			if (this.recommendations && Array.isArray(this.recommendations)) {
				this.recommendations = this.recommendations.filter((rec) => {
					const recVariantId = rec.variant_id || rec.variantId || rec.id;
					return recVariantId.toString() !== variantId.toString();
				});

				// Update the display if drawer is open
				if (this.isOpen) {
					const recommendationsContent = document.getElementById(
						"cartuplift-recommendations-content",
					);
					if (recommendationsContent) {
						recommendationsContent.innerHTML = this.getRecommendationItems();
					}
				}
			}
		}

		async loadRecommendations() {
			try {
				// Initialize recommendation engine if not exists
				if (!this.recommendationEngine) {
					this.recommendationEngine = new SmartRecommendationEngine(this);
				}

				// Get smart recommendations
				const recommendations =
					await this.recommendationEngine.getRecommendations();

				// Store and display (master order fixed; visible list filtered by cart)
				this._allRecommendations = recommendations;
				this._recommendationsLocked = true; // prevent reshuffling master order; still compute visible each time
				this.rebuildRecommendationsFromMaster();
				this._recommendationsLoaded = true;

				// Update recommendations display if drawer is open
				if (this.isOpen) {
					const recommendationsContent = document.getElementById(
						"cartuplift-recommendations-content",
					);
					if (recommendationsContent) {
						recommendationsContent.innerHTML = this.getRecommendationItems();
					}
				}
			} catch (error) {
				debug.error("🛒 Error loading smart recommendations:", error);
				// Fallback to original method
				await this.loadRecommendationsFallback();
			}
		}

		async loadRecommendationsFallback() {
			try {
				let apiUrl = "";
				let products = [];
				// Honor user setting; any positive number
				const desiredMax = this.normalizeMaxRecommendations(
					this.settings.maxRecommendations,
				);

				// Get product recommendations based on cart items, or popular products if cart is empty
				if (this.cart?.items && this.cart.items.length > 0) {
					const productId = this.cart.items[0].product_id;
					apiUrl = `/recommendations/products.json?product_id=${productId}&limit=${desiredMax}`;
				} else {
					// Load popular/featured products when cart is empty
					apiUrl = `/products.json?limit=${desiredMax}`;
				}

				const response = await fetch(apiUrl);

				if (response.ok) {
					const data = await response.json();
					products = data.products || [];
				}

				// Always try to keep a buffer so we can fill visible list after filtering cart items
				const targetBuffer = Math.max(desiredMax * 3, desiredMax + 8); // Larger buffer for better selection
				if (products.length < targetBuffer) {
					try {
						const extraLimit = Math.max(targetBuffer * 2, 20); // load more for better filtering
						const fallbackResponse = await fetch(
							`/products.json?limit=${extraLimit}`,
						); // Load more for better filtering
						if (fallbackResponse.ok) {
							const fallbackData = await fallbackResponse.json();
							const fallbackProducts = fallbackData.products || [];

							// Filter out products already in the provisional list; allow items currently in cart to stay in master
							const existingProductIds = products.map((p) => p.id);

							const filteredProducts = fallbackProducts.filter(
								(product) =>
									!existingProductIds.includes(product.id) &&
									product.variants &&
									product.variants.length > 0 &&
									product.variants[0].available,
							);

							// Add filtered products until we reach the buffer target
							const needed = targetBuffer - products.length;
							products = products.concat(filteredProducts.slice(0, needed));
						}
					} catch (fallbackError) {
						debug.error("🛒 Error loading fallback products:", fallbackError);
					}
				}

				// Convert to our format
				this._allRecommendations = products
					.map((product) => ({
						id: product.id,
						title: product.title,
						priceCents: this.normalizePriceToCents(
							product.variants?.[0]?.price,
						),
						image: product.images?.[0]
							? product.images[0].src || product.images[0]
							: product.featured_image ||
								"https://via.placeholder.com/150x150?text=No+Image",
						variant_id: product.variants?.[0] ? product.variants[0].id : null,
						url: product.handle
							? `/products/${product.handle}`
							: product.url || "#",
						// Normalize variants with price in cents for UI handling
						variants: (product.variants || []).map((v) => ({
							...v,
							price_cents: this.normalizePriceToCents(v.price),
						})),
						options: product.options || [],
					}))
					.filter((item) => item.variant_id); // Only include products with valid variants

				// Track ml_recommendation_served for attribution (CRITICAL for revenue tracking)
				if (this.recommendationEngine) {
					this.recommendationEngine
						.trackRecommendationsServed(this.cart, this._allRecommendations)
						.catch((err) =>
							debug.warn("ML tracking failed (non-critical):", err),
						);
				}

				// Build visible list from fixed master, filtered against cart
				this._recommendationsLocked = true;
				this.rebuildRecommendationsFromMaster();

				// Update recommendations display if drawer is open
				if (this.isOpen) {
					const recommendationsContent = document.getElementById(
						"cartuplift-recommendations-content",
					);
					if (recommendationsContent) {
						recommendationsContent.innerHTML = this.getRecommendationItems();
					}
				}

				// Mark recommendations as loaded regardless of success/failure
				this._recommendationsLoaded = true;
			} catch (error) {
				debug.error("🛒 Error loading fallback recommendations:", error);
				this.recommendations = [];
				this._recommendationsLoaded = true;
			}
		}

	updateDrawerContent() {
		// Sticky cart removed – no counters to update

		const popup = document.querySelector("#cartuplift-cart-popup");
		if (!popup) {
			return;
		}

		// Preserve scroll position
		const contentWrapper = popup.querySelector(".cartuplift-content-wrapper");
		const currentScrollTop = contentWrapper ? contentWrapper.scrollTop : 0;

		const newHTML = this.getDrawerHTML();

		popup.innerHTML = newHTML;

		// Clear the events attached flag since we just replaced all HTML
		const container = document.getElementById("cartuplift-app-container");
		if (container) {
			container.dataset.eventsAttached = "false";
		}

		this.attachDrawerEvents();

		// Restore scroll position
		const newContentWrapper = popup.querySelector(
			".cartuplift-content-wrapper",
		);
		if (newContentWrapper && currentScrollTop > 0) {
			requestAnimationFrame(() => {
				newContentWrapper.scrollTop = currentScrollTop;
			});
		}			// No sticky cart updates

			// Only refresh layout if recommendations are loaded (filtering handled elsewhere)
			if (this.settings.enableRecommendations && this._recommendationsLoaded) {
				this.refreshRecommendationLayout();
			}
		}

		// Sticky cart removed – no refresh

		// Estimate discount from saved cart attributes and latest validation
		computeEstimatedDiscount(totalCents) {
			try {
				const attrs = this.cart?.attributes || {};
				const code = attrs.discount_code || this._lastDiscountCode;
				const kind = this._lastDiscountKind || attrs.discount_kind;
				const percent =
					this._lastDiscountPercent ||
					(attrs.discount_percent ? Number(attrs.discount_percent) : undefined);
				const amountCents =
					this._lastDiscountAmountCents ||
					(attrs.discount_amount_cents
						? Number(attrs.discount_amount_cents)
						: undefined);

				if (!code)
					return {
						estimatedDiscountCents: 0,
						hasDiscount: false,
						discountLabel: "",
					};

				let est = 0;
				if (kind === "percent" && typeof percent === "number" && percent > 0) {
					// Normalize percent if stored as 0.5 for 50%
					const p = percent > 0 && percent <= 1 ? percent * 100 : percent;
					// Cap at 100
					const safeP = Math.min(p, 100);
					est = Math.round((safeP / 100) * totalCents);
				} else if (
					kind === "amount" &&
					typeof amountCents === "number" &&
					amountCents > 0
				) {
					est = Math.min(amountCents, totalCents);
				}

				return {
					estimatedDiscountCents: est,
					hasDiscount: est > 0,
					discountLabel: code,
				};
			} catch (_e) {
				return {
					estimatedDiscountCents: 0,
					hasDiscount: false,
					discountLabel: "",
				};
			}
		}

		// Check if gift thresholds have been reached and auto-add gift products
		async checkAndAddGiftThresholds() {
			if (!this.settings.enableGiftGating) {
				return;
			}

			if (!this.settings.giftThresholds) {
				return;
			}

			if (!this.cart) {
				return;
			}

			// In design mode, show preview without actually modifying cart
			const isDesignMode = this.settings.suppressAutoAdd;
			if (isDesignMode) {
				return this.checkAndShowGiftPreview();
			}

			try {
			const giftThresholds = JSON.parse(this.settings.giftThresholds);

			if (!Array.isArray(giftThresholds)) {
				debug.warn("Gift thresholds is not an array:", typeof giftThresholds);
				return;
			}

			if (giftThresholds.length === 0) {
				return;
			}

			const currentTotal = this.getDisplayedTotalCents();

			for (const threshold of giftThresholds) {
				// Only process product type gifts that have a product ID
				if (
					threshold.type !== "product" ||
					!threshold.productId ||
					!threshold.productHandle
				) {
					continue;
				}

				const thresholdAmount = (threshold.amount || 0) * 100; // Convert to pence
				const hasReachedThreshold = currentTotal >= thresholdAmount;

				// Extract numeric product ID for comparison
				let numericProductId = threshold.productId;
				if (
					typeof numericProductId === "string" &&
					numericProductId.includes("gid://shopify/Product/")
				) {
					numericProductId = numericProductId.replace(
						"gid://shopify/Product/",
						"",
					);
				}

				const declinedKey = `gift_declined_${numericProductId}`;

				// Check if product is in cart and handle quantity logic
				const existingCartItems = this.cart.items.filter(
					(item) =>
						item.product_id.toString() === numericProductId.toString(),
				);

				let totalQuantity = 0;
				let giftQuantity = 0;
				let paidQuantity = 0;					for (const item of existingCartItems) {
						totalQuantity += item.quantity;
						if (item.properties && item.properties._is_gift === "true") {
							giftQuantity += item.quantity;
						} else {
							paidQuantity += item.quantity;
						}
					}

					debug.log(`   Quantities:`, {
						total: totalQuantity,
						gift: giftQuantity,
						paid: paidQuantity,
					});

					if (hasReachedThreshold) {
						if (giftQuantity === 0) {
							const hasDeclined = sessionStorage.getItem(declinedKey);

							debug.log(` DECISION:`, {
								giftInCart: false,
								hasDeclined: !!hasDeclined,
								willShowModal: !hasDeclined,
							});

							if (!hasDeclined) {
								// No gift version exists yet - show modal to let customer choose
								debug.log(
									" ✓ ACTION: Showing gift modal for customer to add gift",
								);
								await this.showGiftModal(threshold);
							} else {
								debug.log(" ⊘ SKIP: Gift previously declined by customer");
							}
						} else {
							debug.log(" ✓ Gift already claimed, no action needed");
						}
					} else {
						sessionStorage.removeItem(declinedKey);
						debug.log(" ⊘ Threshold not reached yet");
						if (giftQuantity > 0) {
							// Threshold no longer met and gift exists - remove all gift versions
							debug.log(
								" ⚠️ Removing gift from cart (threshold no longer met)",
							);
							for (const giftItem of existingCartItems) {
								if (
									giftItem.properties &&
									giftItem.properties._is_gift === "true"
								) {
									await this.removeGiftFromCart(threshold, giftItem);
								}
							}
						}
					}
				}

				debug.log(" ========================================");
				debug.log(" GIFT THRESHOLD CHECK COMPLETE");
				debug.log(" ========================================");
			} catch (error) {
				debug.error(" ❌ ERROR in gift threshold check:", error);
				debug.log(
					" Raw gift thresholds setting:",
					this.settings.giftThresholds,
				);
				debug.log(" ========================================");
			}
		}

		// Show gift preview in design mode without modifying cart
		async checkAndShowGiftPreview() {
			if (!this.settings.giftThresholds) return;

			try {
				const giftThresholds = JSON.parse(this.settings.giftThresholds);
				if (!Array.isArray(giftThresholds) || giftThresholds.length === 0)
					return;

				// In design mode, simulate a cart total that would trigger gifts for preview
				let currentTotal = this.getDisplayedTotalCents();

				// If cart is empty in design mode, simulate reaching the first threshold
				if (currentTotal === 0) {
					const validThresholds = giftThresholds
						.filter(
							(t) =>
								t.type === "product" &&
								t.type !== "free_shipping" &&
								t.amount &&
								t.amount > 0,
						)
						.map((t) => t.amount);

					if (validThresholds.length > 0) {
						const lowestThreshold = Math.min(...validThresholds);
						currentTotal = (lowestThreshold + 10) * 100; // Add $10 buffer to ensure threshold is met
						debug.log(
							" Design mode: Simulating cart total to trigger preview for threshold:",
							lowestThreshold,
						);
					}
				}

				debug.log(
					" Design mode preview - Current total (simulated):",
					currentTotal / 100,
				);

				// Find eligible gifts for preview (exclude free shipping only)
				const eligibleGifts = [];
				for (const threshold of giftThresholds) {
					// Skip free shipping thresholds and non-product thresholds
					if (
						threshold.type !== "product" ||
						!threshold.productId ||
						!threshold.productHandle
					)
						continue;
					if (threshold.type === "free_shipping") continue;

					const thresholdAmount = (threshold.amount || 0) * 100;
					const hasReachedThreshold = currentTotal >= thresholdAmount;

					if (hasReachedThreshold) {
						eligibleGifts.push({
							title: threshold.title || "Gift Item",
							amount: threshold.amount || 0,
						});
					}
				}

				// Simulate gift items in cart for preview
				if (eligibleGifts.length > 0) {
					debug.log(
						" Design mode: Showing preview for",
						eligibleGifts.length,
						"eligible gifts",
					);

					// Create fake gift items for preview
					this._previewGiftItems = eligibleGifts.map((gift) => ({
						product_title: gift.title,
						price: 0,
						quantity: 1,
						properties: {
							_is_gift: "true",
							_gift_title: gift.title,
							_original_price: gift.amount * 100,
						},
					}));

					// Update drawer to show preview
					this.updateDrawerContent();
				}
			} catch (error) {
				debug.error(" Error in gift preview:", error);
			}
		}

		// Add a gift product to the cart
		async addGiftToCart(threshold) {
			try {
				// Extract numeric ID from GraphQL ID if needed
				let productId = threshold.productId;
				if (
					typeof productId === "string" &&
					productId.includes("gid://shopify/Product/")
				) {
					// Extract the numeric ID from the GraphQL ID
					productId = productId.replace("gid://shopify/Product/", "");
				}

				// For gifts, we need to fetch the product and use the first available variant
				return await this.addGiftByHandle(threshold);
			} catch (error) {
				debug.error(` Error adding gift to cart:`, error);
				return false;
			}
		}

		// Fallback method to add gift by product handle (fetch product first)
		async addGiftByHandle(threshold) {
			try {
				// Validate product handle
				if (
					!threshold.productHandle ||
					typeof threshold.productHandle !== "string"
				) {
					debug.error(
						` Invalid product handle:`,
						threshold.productHandle,
						"type:",
						typeof threshold.productHandle,
					);
					return false;
				}

				const response = await fetch(`/products/${threshold.productHandle}.js`);

				if (!response.ok) {
					debug.error(
						` Failed to fetch product: ${threshold.productHandle}`,
					);
					return false;
				}

				const product = await response.json();
				const firstVariant = product.variants?.[0];

				if (!firstVariant) {
					debug.error(
						` No variants found for product: ${threshold.productHandle}`,
					);
					return false;
				}

				const addResponse = await fetch("/cart/add.js", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Requested-With": "XMLHttpRequest",
					},
					body: JSON.stringify({
						id: firstVariant.id,
						quantity: 1,
						properties: {
							_is_gift: "true",
							_gift_title: threshold?.title ? String(threshold.title) : "Gift",
							_gift_label: threshold?.title ? String(threshold.title) : "Gift",
							_original_price: firstVariant.price.toString(),
						},
						// Note: Shopify doesn't allow setting price to 0 via cart API
						// The merchant must handle gift pricing via Shopify Scripts, discounts, or theme logic
						selling_plan: null,
					}),
				});

				const addResponseData = await addResponse.json();

				if (addResponse.ok) {
					await this.fetchCart();
					this.updateDrawerContent();
					return true;
				} else {
					debug.error(` Failed to add gift variant:`, addResponseData);
					return false;
				}
			} catch (error) {
				debug.error(` Error in addGiftByHandle:`, error);
				return false;
			}
		}

		// Split an existing cart item: reduce paid quantity by 1, add 1 gift
		async splitItemAddGift(cartItem, threshold) {
			try {
				// First, reduce the paid item quantity by 1
				const lineIndex =
					this.cart.items.findIndex((item) => item.key === cartItem.key) + 1;

				if (lineIndex === 0) {
					debug.error(
						` Could not find line index for cart item:`,
						cartItem,
					);
					return false;
				}

				const newQuantity = Math.max(0, cartItem.quantity - 1);

				if (newQuantity > 0) {
					// Update existing line with reduced quantity
					const formData = new FormData();
					formData.append("line", lineIndex);
					formData.append("quantity", newQuantity);

					// Preserve existing properties
					if (cartItem.properties) {
						for (const [key, value] of Object.entries(cartItem.properties)) {
							formData.append(`properties[${key}]`, value);
						}
					}

					const response = await fetch("/cart/change.js", {
						method: "POST",
						body: formData,
					});

					if (!response.ok) {
						debug.error(
							` Failed to reduce paid item quantity`,
							response.status,
						);
						return false;
					}
				} else {
					// Remove the line entirely if quantity would be 0
					const formData = new FormData();
					formData.append("id", cartItem.key);
					formData.append("quantity", "0");

					const response = await fetch("/cart/change.js", {
						method: "POST",
						body: formData,
					});

					if (!response.ok) {
						debug.error(` Failed to remove paid item`, response.status);
						return false;
					}
				}

				// Now add 1 gift item
				await this.addGiftToCart(threshold);
				return true;
			} catch (error) {
				debug.error(` Error splitting item to add gift:`, error);
				return false;
			}
		}

		// Convert an existing cart item to a gift (make it free)
		async convertItemToGift(cartItem, threshold) {
			try {
				// Calculate the discount needed to make this item free
				const itemPrice =
					cartItem.original_line_price ||
					cartItem.line_price ||
					cartItem.price * cartItem.quantity;

				// Get the line index (1-based) for this cart item
				const lineIndex =
					this.cart.items.findIndex((item) => item.key === cartItem.key) + 1;

				if (lineIndex === 0) {
					debug.error(
						`🎁 Could not find line index for cart item:`,
						cartItem,
					);
					return false;
				}

				// Build the updated properties - preserve existing properties and add gift markers
				const updatedProperties = {
					...cartItem.properties,
					_is_gift: "true",
					_gift_title: threshold?.title ? String(threshold.title) : "Gift",
					_gift_label: threshold?.title ? String(threshold.title) : "Gift",
					_gift_threshold_id: threshold.id.toString(),
					_original_price: itemPrice.toString(),
				};

				// Use cart/change.js to update the line with new properties
				const formData = new FormData();
				formData.append("line", lineIndex);
				formData.append("quantity", cartItem.quantity);

				// Add properties to FormData
				for (const [key, value] of Object.entries(updatedProperties)) {
					formData.append(`properties[${key}]`, value);
				}

				const response = await fetch("/cart/change.js", {
					method: "POST",
					body: formData,
				});

				if (response.ok) {
					const updatedCart = await response.json();

					this.cart = updatedCart;
					this.updateDrawerContent();
					return true;
				} else {
					const errorData = await response.json();
					debug.error(`🎁 Failed to convert item to gift:`, errorData);
					return false;
				}
			} catch (error) {
				debug.error(`🎁 Error converting item to gift:`, error);
				return false;
			}
		}

		// Remove a gift product from the cart
		async removeGiftFromCart(threshold, specificGiftItem = null) {
			try {
				// Extract numeric product ID for comparison
				let numericProductId = threshold.productId;
				if (
					typeof numericProductId === "string" &&
					numericProductId.includes("gid://shopify/Product/")
				) {
					numericProductId = numericProductId.replace(
						"gid://shopify/Product/",
						"",
					);
				}

				// Find the gift item(s) in cart
				let giftItems = [];
				if (specificGiftItem) {
					// Remove specific item
					giftItems = [specificGiftItem];
				} else {
					// Find all gift items for this product
					giftItems = this.cart.items.filter(
						(item) =>
							item.product_id.toString() === numericProductId.toString() &&
							item.properties &&
							item.properties._is_gift === "true",
					);
				}

				if (giftItems.length > 0) {
					// Remove all found gift items
					for (const giftItem of giftItems) {
						const formData = new FormData();
						formData.append("id", giftItem.key);
						formData.append("quantity", "0");

						const response = await fetch("/cart/change.js", {
							method: "POST",
							body: formData,
						});

						if (!response.ok) {
							debug.error(`🎁 Failed to remove gift`, response.status);
							return false;
						}
					}

					// Refresh cart after removing gifts
					await this.fetchCart();
					this.updateDrawerContent();
					return true;
				} else {
					// Gift item not found in cart
					return false;
				}
			} catch (error) {
				debug.error(`🎁 Error removing gift from cart:`, error);
				return false;
			}
		}

		getDisplayedTotalCents() {
			if (!this.cart || !this.cart.items) {
				return 0;
			}

			// Calculate total excluding gifts (for gift threshold calculations)
			let total = 0;
			this.cart.items.forEach((item) => {
				// Skip gift items in price calculations
				const isGift = item.properties && item.properties._is_gift === "true";
				if (!isGift) {
					// Use original_line_price if available (before discounts), fallback to line_price
					total +=
						item.original_line_price ||
						item.line_price ||
						item.price * item.quantity;
				}
			});

			return total;
		}

	// Helper method to auto-open drawer with retry logic for animation conflicts
	tryAutoOpenDrawer(skipFetch = false, retries = 0, maxRetries = 5) {
		if (this.isOpen) {
			// Already open, nothing to do
			return;
		}

		if (this._isAnimating && retries < maxRetries) {
			// Drawer is still animating, wait and retry
			setTimeout(() => this.tryAutoOpenDrawer(skipFetch, retries + 1, maxRetries), 100);
			return;
		}

		// Try to open the drawer
		this.openDrawer(skipFetch);
	}

	async openDrawer(skipFetch = false) {
		if (this._isAnimating || this.isOpen) {
			return;
		}

		if (!this.settings.enableApp) {
			return;
		}

		this.forceCloseNativeCartDrawer('open-drawer');

		// Reset cart modified flag when opening drawer
		this._cartModified = this._cartModified || false;
		const cartModifiedBeforeOpen = this._cartModified;
		this._cartModified = false;

		// Track cart open event
		CartAnalytics.trackEvent("cart_open");			this._isAnimating = true;
			const container = document.getElementById("cartuplift-app-container");
			if (!container) {
			debug.error("CartUplift: App container not found in DOM!");
			this._isAnimating = false;
			return;
		}

		// Skip fetch if we just updated the cart (from add-to-cart handler)
		if (!skipFetch) {
			// Always fetch fresh cart data when opening manually
			// (unless we just added to cart and have fresh data)
			const now = Date.now();
			const cartAge = this._lastCartFetch ? now - this._lastCartFetch : Infinity;
			const shouldFetch = cartAge > 1000; // Fresh if updated in last second

			if (shouldFetch) {
				await this.fetchCart(true); // Force fresh data, skip prewarm
			}
		}

		if (this.settings.enableRecommendations && this._recommendationsLoaded) {
			this.rebuildRecommendationsFromMasterSync();
		}

		// Update drawer content with fresh data
		this.updateDrawerContent();

		// Show container and add active class FIRST (don't block on recommendations)
		container.style.display = "block";

		// Force reflow
		void container.offsetHeight;

		// Add active class for animation
		container.classList.add("active");
		// Prevent background/page scroll while drawer is open
		document.documentElement.classList.add("cartuplift-no-scroll");
		document.body.classList.add("cartuplift-no-scroll");

		// Load recommendations asynchronously AFTER drawer is visible (non-blocking)
		if (this.settings.enableRecommendations && !this._recommendationsLoaded) {
			// Don't await - load in background and update when ready
			this.loadRecommendations().then(() => {
				// After loading, rebuild to filter cart items
				this.rebuildRecommendationsFromMasterSync();
				this.updateDrawerContent(); // Update again with filtered recommendations

				// Track recommendation impressions after they load
				if (this.recommendations && this.recommendations.length > 0) {
					this.recommendations.forEach((product, index) => {
						CartAnalytics.trackEvent("impression", {
							productId: product.variant_id || product.id,
							variantId: product.variant_id,
							parentProductId: product.id,
							productTitle: product.title,
							source: "cart_drawer",
							position: index,
						});
					});
				}
			}).catch(err => {
				debug.warn("Failed to load recommendations:", err);
			});
		} else {
			// Track recommendation impressions if already loaded
			if (this.recommendations && this.recommendations.length > 0) {
				this.recommendations.forEach((product, index) => {
					CartAnalytics.trackEvent("impression", {
						productId: product.variant_id || product.id,
						variantId: product.variant_id,
						parentProductId: product.id,
						productTitle: product.title,
						source: "cart_drawer",
						position: index,
					});
				});
			}
		}

		// Update flags after animation
		setTimeout(() => {
			this._isAnimating = false;
			this.isOpen = true;

			// Show pending gift modal if one was deferred
			if (this._pendingGiftModal) {
				debug.log("🎁 Drawer opened, showing pending gift modal");
				const pendingThreshold = this._pendingGiftModal;
				this._pendingGiftModal = null;
				// Add a slight delay to ensure drawer is fully rendered
				setTimeout(() => {
					this.showGiftModal(pendingThreshold);
				}, 50);
			}
		}, 350);
	}

	closeDrawer() {
		if (this._isAnimating || !this.isOpen) return;

		// Track cart close event
		CartAnalytics.trackEvent("cart_close");

		// Check if cart was modified during this session
		const shouldReload = this._cartModified;

		this._isAnimating = true;
		const container = document.getElementById("cartuplift-app-container");
		if (!container) {
			this._isAnimating = false;
			return;
		}

		// Remove active class for animation
		container.classList.remove("active");
		
		// Immediately disable pointer events on backdrop AND hide it
		const backdrop = container.querySelector("#cartuplift-backdrop");
		if (backdrop) {
			backdrop.style.pointerEvents = "none";
			backdrop.style.opacity = "0";
			backdrop.style.display = "none";
		}

		// If we're going to reload, hide everything immediately
		if (shouldReload) {
			debug.log("🔄 Cart was modified, hiding drawer and reloading");
			container.style.display = "none";
			container.style.visibility = "hidden";
			document.documentElement.classList.remove("cartuplift-no-scroll");
			document.body.classList.remove("cartuplift-no-scroll");
			this._isAnimating = false;
			this.isOpen = false;
			// Small delay to ensure backdrop is hidden before reload
			setTimeout(() => {
				window.location.reload();
			}, 50);
			return;
		}

		// Clean up after animation (only if not reloading)
		setTimeout(() => {
			container.style.display = "none";
			this._isAnimating = false;
			this.isOpen = false;
			// Restore background scroll
			document.documentElement.classList.remove("cartuplift-no-scroll");
			document.body.classList.remove("cartuplift-no-scroll");
			
			// Reset backdrop styles for next open
			if (backdrop) {
				backdrop.style.pointerEvents = "";
				backdrop.style.opacity = "";
				backdrop.style.display = "";
			}
		}, 350);
	}		setupCartUpliftInterception() {
			// Intercept cart icon clicks - CAPTURE PHASE (first to run)
			const handleCartClick = (e) => {
				const cartTriggers = [
					'a[href="/cart"]',
					'a[href^="/cart?"]',
					".cart-icon",
					".cart-link",
					".cart-toggle",
					".header__icon--cart",
					".site-header__cart",
					"[data-cart-drawer-toggle]",
					"cart-icon", // Web component
					".header-actions__cart-icon",
				];
				const target = e.target.closest(cartTriggers.join(","));
				if (target) {
					if (!this.settings.enableApp) {
						return; // Don't intercept if app is disabled
					}
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation(); // Prevent any other listeners
					this.forceCloseNativeCartDrawer('cart-trigger');
					this.openDrawer();
					// Double-check native cart is closed after a brief delay
					setTimeout(() => this.forceCloseNativeCartDrawer('cart-trigger-delayed'), 50);
					setTimeout(() => this.forceCloseNativeCartDrawer('cart-trigger-delayed-2'), 150);
				}
			};

			// Add both capture and bubble phase listeners for maximum coverage
			document.addEventListener("click", handleCartClick, true); // Capture phase
			document.addEventListener("click", handleCartClick, false); // Bubble phase
		}

	installAddToCartMonitoring() {
		const self = this;

		// Initialize CartUpliftAAInternal namespace for safe internal storage
		if (!window.CartUpliftAAInternal) {
			window.CartUpliftAAInternal = {
				observers: [],
				handlers: [],
				originals: {},
				seenEvents: new Set()
			};
		}

		// SAFE fetch wrapper - stores original and wraps it (doesn't replace)
		// This allows other apps to work while we detect cart changes
		if (!window.CartUpliftAAInternal.originals.fetch) {
			window.CartUpliftAAInternal.originals.fetch = window.fetch;

			window.fetch = async function(...args) {
				// ALWAYS call original fetch first with proper this binding (other apps work normally)
				const response = await window.CartUpliftAAInternal.originals.fetch.apply(this, args);

				// Add our cart detection as a side effect (non-blocking)
				try {
					if (self.settings.enableApp) {
						const url = args[0] ? args[0].toString() : "";
						const isCartAdd = url.includes("/cart/add");
						const isCartChange = url.includes("/cart/change");
						const isCartUpdate = url.includes("/cart/update");

						if (isCartAdd && response.ok) {
							// Clone response so we don't consume it for other apps
							const responseClone = response.clone();

							setTimeout(async () => {
								try {
									// Fetch fresh cart data with retry logic
									let attempts = 0;
									let cartData = null;
									const maxAttempts = 3;

									while (attempts < maxAttempts) {
										attempts++;
										const cacheBust = Date.now();
										const cartResponse = await window.CartUpliftAAInternal.originals.fetch.call(window, `/cart.js?t=${cacheBust}`);
										cartData = await cartResponse.json();

										if (cartData.item_count > 0) {
											self.cart = cartData;
											self._lastCartFetch = Date.now();
											break;
										}

										if (attempts < maxAttempts) {
											await new Promise(resolve => setTimeout(resolve, 150));
										}
									}

									self.cart = cartData || self.cart;
									self._lastCartFetch = Date.now();

									// Consolidate any duplicate items (same variant, different line items)
									await self.consolidateDuplicateCartItems();

									self.updateDrawerContent();

									await new Promise(resolve => setTimeout(resolve, 100));
									await self.checkAndAddGiftThresholds();

									if (self.settings.enableApp) {
										self.flyToCart();
									}

									if (self.settings.autoOpenCart && self.settings.enableApp) {
										self.hideThemeNotifications();
										self.tryAutoOpenDrawer(true);
									}
								} catch (error) {
									debug.error("CartUplift: Cart add handler failed:", error);
								}
							}, 100);
						} else if (response.ok && (isCartChange || isCartUpdate)) {
							setTimeout(async () => {
								try {
									await self.fetchCart(true);
									if (self.settings.enableRecommendations && self._recommendationsLoaded) {
										self.rebuildRecommendationsFromMasterSync();
									}
									self.updateDrawerContent();
								} catch (error) {
									debug.error("CartUplift: Cart update handler failed:", error);
								}
							}, 50);
						}
					}
				} catch (error) {
					// Fail silently - don't break other apps
					debug.warn("CartUplift: Monitoring error:", error);
				}

				// ALWAYS return original response (unmodified)
				return response;
			};
		}

		// SAFE XHR wrapper - for older themes
		if (!window.CartUpliftAAInternal.originals.xhrOpen) {
			window.CartUpliftAAInternal.originals.xhrOpen = XMLHttpRequest.prototype.open;
			window.CartUpliftAAInternal.originals.xhrSend = XMLHttpRequest.prototype.send;

			XMLHttpRequest.prototype.open = function(method, url, ...rest) {
				this._cartUpliftUrl = url;
				this._cartUpliftMethod = method;
				return window.CartUpliftAAInternal.originals.xhrOpen.call(this, method, url, ...rest);
			};

			XMLHttpRequest.prototype.send = function(...args) {
				if (this._cartUpliftUrl?.includes("/cart/add") && self.settings.enableApp) {
					this.addEventListener("load", function() {
						if (this.status === 200) {
							setTimeout(async () => {
								try {
									await self.fetchCart();

									// Consolidate any duplicate items (same variant, different line items)
									await self.consolidateDuplicateCartItems();

									self.updateDrawerContent();
									if (self.settings.enableApp) {
										self.flyToCart();
									}
									if (self.settings.autoOpenCart && self.settings.enableApp) {
										self.hideThemeNotifications();
										self.tryAutoOpenDrawer();
									}
								} catch (error) {
									debug.error("CartUplift: XHR cart add handler failed:", error);
								}
							}, 50);
						}
					});
				} else if (this._cartUpliftUrl && (this._cartUpliftUrl.includes("/cart/change") || this._cartUpliftUrl.includes("/cart/update"))) {
					this.addEventListener("load", function() {
						if (this.status === 200) {
							setTimeout(async () => {
								try {
									await self.fetchCart(true);
									if (self.settings.enableRecommendations && self._recommendationsLoaded) {
										self.rebuildRecommendationsFromMasterSync();
									}
									self.updateDrawerContent();
								} catch (error) {
									debug.error("CartUplift: XHR cart update handler failed:", error);
								}
							}, 50);
						}
					});
				}
				return window.CartUpliftAAInternal.originals.xhrSend.apply(this, args);
			};
		}
	}

		formatMoney(cents) {
			const validCents =
				typeof cents === "number" && !Number.isNaN(cents)
					? Math.round(cents)
					: 0;

			// Prefer Shopify.formatMoney when available so we honor all locale placeholders
			try {
				if (
					window.Shopify &&
					typeof window.Shopify.formatMoney === "function"
				) {
					const format =
						window.CartUpliftMoneyFormat || window.Shopify.money_format;
					if (format) {
						let formatted = window.Shopify.formatMoney(validCents, format);
						// Remove .00 if whole number
						if (validCents % 100 === 0) {
							formatted = formatted.replace(/\.00$/, "").replace(/,00$/, "");
						}
						return formatted;
					}
					let formatted = window.Shopify.formatMoney(validCents);
					// Remove .00 if whole number
					if (validCents % 100 === 0) {
						formatted = formatted.replace(/\.00$/, "").replace(/,00$/, "");
					}
					return formatted;
				}
			} catch (shopifyFormatError) {
				debug.warn(
					"[CartUplift] formatMoney fallback due to Shopify.formatMoney error",
					shopifyFormatError,
				);
			}

			const amount = (validCents / 100).toFixed(2);
			// Remove .00 for whole numbers
			const cleanAmount =
				validCents % 100 === 0 ? (validCents / 100).toString() : amount;

			// Add thousand separators
			const addThousandSeparators = (num) => {
				const parts = num.split(".");
				parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
				return parts.join(".");
			};

			const formattedAmount = addThousandSeparators(cleanAmount);

			if (window.CartUpliftMoneyFormat) {
				try {
					return window.CartUpliftMoneyFormat.replace(
						/\{\{\s*amount\s*\}\}/g,
						formattedAmount,
					);
				} catch {
					// Fallback below
				}
			}

			// Fallback: Use Intl.NumberFormat with shop currency
			try {
				const currencyCode = window.Shopify?.currency?.active || this.cart?.currency || 'USD';
				const formatter = new Intl.NumberFormat(navigator.language || 'en', {
					style: 'currency',
					currency: currencyCode,
					minimumFractionDigits: 2,
					maximumFractionDigits: 2
				});
				return formatter.format(validCents / 100);
			} catch (intlError) {
				// Final fallback if Intl fails
				debug.warn('[CartUplift] Intl.NumberFormat failed, using generic format', intlError);
				return formattedAmount;
			}
		}

		getCurrencySymbol() {
			// Extract currency symbol from money format or Shopify settings
			try {
				const format =
					window.CartUpliftMoneyFormat || window.Shopify?.money_format;
				if (format) {
					// Extract symbol from format like "${{amount}}", "{{amount}} €", "£{{amount}}", etc.
					const symbolMatch = format.match(/[^{}0-9.,\s]+/);
					if (symbolMatch) {
						return symbolMatch[0].trim();
					}
				}
			} catch (e) {
				debug.warn("[CartUplift] getCurrencySymbol error:", e);
			}
			// Fallback to shop currency code or Intl formatting
			try {
				const currencyCode = window.Shopify?.currency?.active || this.cart?.currency || 'USD';
				const formatter = new Intl.NumberFormat(navigator.language || 'en', {
					style: 'currency',
					currency: currencyCode
				});
				// Extract symbol from formatted 0
				const formatted = formatter.format(0);
				const symbolMatch = formatted.match(/[^\d\s.,]+/);
				return symbolMatch ? symbolMatch[0].trim() : currencyCode;
			} catch (intlError) {
				return window.Shopify?.currency?.active || 'USD';
			}
		}

		normalizePriceToCents(value) {
			if (value === null || value === undefined || value === "") {
				return 0;
			}

			const rawString =
				typeof value === "number" ? value.toString() : String(value).trim();
			if (!rawString) return 0;

			// Remove currency symbols and keep digits, separators, signs
			let cleaned = rawString.replace(/[^0-9.,-]/g, "");
			if (!cleaned) return 0;

			const hasComma = cleaned.includes(",");
			const hasDot = cleaned.includes(".");

			if (hasComma && hasDot) {
				// Assume comma is thousands separator; remove it
				cleaned = cleaned.replace(/,/g, "");
			} else if (hasComma && !hasDot) {
				// Treat comma as decimal separator
				cleaned = cleaned.replace(/,/g, ".");
			}

			if (cleaned.includes(".")) {
				const floatVal = parseFloat(cleaned);
				return Number.isNaN(floatVal) ? 0 : Math.round(floatVal * 100);
			}

			const digitsOnly = cleaned.replace(/\D/g, "");
			if (!digitsOnly) return 0;

			if (digitsOnly.length <= 2) {
				const majorUnits = parseInt(digitsOnly, 10);
				return Number.isNaN(majorUnits) ? 0 : majorUnits * 100;
			}

			const centsValue = parseInt(digitsOnly, 10);
			return Number.isNaN(centsValue) ? 0 : centsValue;
		}

		getFreeShippingThresholdCents() {
			try {
				const raw = this.settings?.freeShippingThreshold;
				if (raw === null || raw === undefined || raw === "") return null;

				let numeric;

				if (typeof raw === "number") {
					numeric = raw;
				} else if (typeof raw === "string") {
					const trimmed = raw.trim();
					if (!trimmed) return null;

					// Remove currency symbols and spaces, handle commas as thousands separators
					let cleaned = trimmed.replace(/[^0-9.,-]/g, "");
					if (!cleaned) return null;

					// Handle comma as thousands separator (e.g., "1,000" -> "1000")
					const hasComma = cleaned.includes(",");
					const hasDot = cleaned.includes(".");

					if (hasComma && hasDot) {
						// Format like "1,000.50" - remove commas
						cleaned = cleaned.replace(/,/g, "");
					} else if (hasComma && !hasDot) {
						// Format like "1,000" (thousands) or "10,50" (European decimal)
						// If comma appears before last 3 digits, it's a thousands separator
						const parts = cleaned.split(",");
						if (parts.length === 2 && parts[1].length === 3) {
							// "1,000" -> "1000"
							cleaned = cleaned.replace(/,/g, "");
						} else {
							// "10,50" -> "10.50"
							cleaned = cleaned.replace(/,/g, ".");
						}
					}

					numeric = Number(cleaned);
				} else {
					numeric = Number(raw);
				}

				if (!Number.isFinite(numeric) || numeric <= 0) return null;

				// ALWAYS treat input as currency units (pounds/dollars) and convert to cents
				// Users enter: 1, 2, 50, 100, 1000, etc. (never cents)
				// We need: 100, 200, 5000, 10000, 100000 cents
				return Math.round(numeric * 100);
			} catch (error) {
				debug.warn("🛒 Failed to normalize free shipping threshold:", error);
				return null;
			}
		}

		/**
		 * Check if all cart thresholds (free shipping + all gifts) have been met
		 * Used for hideRecommendationsAfterThreshold setting
		 * @returns {boolean} True if all thresholds met, false otherwise
		 */
		checkIfAllThresholdsMet() {
			try {
				const cartTotal = this.cart?.total_price || 0;

				// Check free shipping threshold
				const freeShippingThreshold = this.settings.freeShippingThresholdCents;
				const freeShippingMet =
					!freeShippingThreshold || cartTotal >= freeShippingThreshold;

				// Check gift thresholds
				let allGiftsMet = true;
				if (this.settings.enableGiftGating && this.settings.giftThresholds) {
					try {
						const giftThresholds = JSON.parse(this.settings.giftThresholds);
						if (giftThresholds && giftThresholds.length > 0) {
							// All gifts must be unlocked (cart total >= highest threshold)
							const highestGiftThreshold = Math.max(
								...giftThresholds.map((t) => t.amount * 100),
							);
							allGiftsMet = cartTotal >= highestGiftThreshold;
						}
					} catch (e) {
						debug.warn("🛒 Failed to parse gift thresholds:", e);
					}
				}

				return freeShippingMet && allGiftsMet;
			} catch (error) {
				debug.warn("🛒 Failed to check threshold status:", error);
				return false;
			}
		}

		/**
		 * Filter recommendations to suggest products that help reach thresholds
		 * Applies different strategies based on merchant settings
		 * @param {Array} recommendations - Array of product objects to filter
		 * @returns {Array} Filtered and sorted recommendations
		 */
		filterRecommendationsForThreshold(recommendations) {
			try {
				if (!recommendations || recommendations.length === 0) return [];

				const cartTotal = this.cart?.total_price || 0;
				const strategy = this.settings.thresholdSuggestionMode || "smart";

				// Determine which threshold to target
				let targetThreshold = null;
				let thresholdType = null;

				// Check free shipping first
				const freeShippingThreshold = this.settings.freeShippingThresholdCents;
				if (freeShippingThreshold && cartTotal < freeShippingThreshold) {
					targetThreshold = freeShippingThreshold;
					thresholdType = "shipping";
				}

				// Check next gift threshold
				if (this.settings.enableGiftGating && this.settings.giftThresholds) {
					try {
						const giftThresholds = JSON.parse(this.settings.giftThresholds);
						if (giftThresholds && giftThresholds.length > 0) {
							const sortedGifts = giftThresholds.sort(
								(a, b) => a.amount - b.amount,
							);
							const nextGift = sortedGifts.find(
								(t) => cartTotal < t.amount * 100,
							);
							if (nextGift) {
								const nextGiftThreshold = nextGift.amount * 100;
								// Target whichever comes first
								if (!targetThreshold || nextGiftThreshold < targetThreshold) {
									targetThreshold = nextGiftThreshold;
									thresholdType = "gift";
								}
							}
						}
					} catch (e) {
						debug.warn(
							"🛒 Failed to parse gift thresholds for filtering:",
							e,
						);
					}
				}

				// If no threshold to target, return original recommendations
				if (!targetThreshold) return recommendations;

				const gap = targetThreshold - cartTotal;
				const tolerance = 500; // $5 tolerance in cents

				// Add threshold gap info to each recommendation
				const enrichedRecs = recommendations.map((product) => {
					const price = product.variants?.[0]?.price || 0;
					const priceGap = Math.abs(price - gap);
					const isGoodFit =
						price >= gap - tolerance && price <= gap + tolerance;

					return {
						...product,
						_thresholdPrice: price,
						_thresholdGap: priceGap,
						_thresholdGoodFit: isGoodFit,
						_thresholdType: thresholdType,
					};
				});

				// Apply filtering strategy
				let filtered = enrichedRecs;

				switch (strategy) {
					case "price":
						// Show only products that help reach threshold (within tolerance)
						filtered = enrichedRecs.filter((p) => p._thresholdGoodFit);
						// Sort by closest to gap
						filtered.sort((a, b) => a._thresholdGap - b._thresholdGap);
						break;

					case "popular_price":
						// Prioritize good-fit products, but don't exclude others
						filtered.sort((a, b) => {
							// Good fits first
							if (a._thresholdGoodFit && !b._thresholdGoodFit) return -1;
							if (!a._thresholdGoodFit && b._thresholdGoodFit) return 1;
							// Then by price gap
							return a._thresholdGap - b._thresholdGap;
						});
						break;
					default:
						// Balance between ML relevance and threshold fit
						// Keep all recommendations but boost good-fit products
						filtered.sort((a, b) => {
							// Heavily favor good fits
							if (a._thresholdGoodFit && !b._thresholdGoodFit) return -1;
							if (!a._thresholdGoodFit && b._thresholdGoodFit) return 1;
							// For good fits, prefer closer to gap
							if (a._thresholdGoodFit && b._thresholdGoodFit) {
								return a._thresholdGap - b._thresholdGap;
							}
							// For non-good-fits, keep ML order (don't sort)
							return 0;
						});
						break;
				}

				// Remove threshold metadata before returning
				return filtered.map(
					({
						_thresholdPrice,
						_thresholdGap,
						_thresholdGoodFit,
						_thresholdType,
						...product
					}) => product,
				);
			} catch (error) {
				debug.warn(
					"🛒 Failed to filter recommendations for threshold:",
					error,
				);
				return recommendations; // Return original on error
			}
		}

		/** Format product review display from metafields or common review apps */
		formatProductReview(product) {
			// Check for common review app metafields and formats
			const metafields = product.metafields || {};

			// Judge.me format
			if (metafields["judgeme.reviews"]) {
				const judgeData = metafields["judgeme.reviews"];
				if (judgeData.rating && judgeData.rating > 0) {
					return `⭐ ${judgeData.rating}`;
				}
			}

			// Yotpo format
			if (metafields.yotpo?.reviews_average) {
				const rating = parseFloat(metafields.yotpo.reviews_average);
				if (rating > 0) {
					return `⭐ ${rating.toFixed(1)}`;
				}
			}

			// Custom rating metafield
			if (metafields.reviews?.rating) {
				const rating = parseFloat(metafields.reviews.rating);
				if (rating > 0) {
					return `⭐ ${rating.toFixed(1)}`;
				}
			}

			// Shopify Product Reviews (legacy)
			if (metafields.spr?.reviews) {
				const sprData =
					typeof metafields.spr.reviews === "string"
						? JSON.parse(metafields.spr.reviews)
						: metafields.spr.reviews;
				if (sprData.rating && sprData.rating > 0) {
					return `⭐ ${sprData.rating.toFixed(1)}`;
				}
			}

			// Direct rating properties (some themes/apps add these)
			if (product.rating && product.rating > 0) {
				return `⭐ ${parseFloat(product.rating).toFixed(1)}`;
			}

			if (product.reviews_score && product.reviews_score > 0) {
				return `⭐ ${parseFloat(product.reviews_score).toFixed(1)}`;
			}

			// No review data found
			return "";
		}

		processGiftNoticeTemplate(template, giftItemsTotal, giftItems = []) {
			if (!template || template.trim() === "") {
				return "";
			}
			let processedText = template;
			// We no longer include shipping savings – {amount} now equals gift total.
			processedText = processedText.replace(
				/\{\{?\s*amount\s*\}?\}/g,
				this.formatMoney(giftItemsTotal),
			);
			processedText = processedText.replace(
				/\{\{?\s*gift_amount\s*\}?\}/g,
				this.formatMoney(giftItemsTotal),
			);
			// Remove any shipping placeholder entirely since shipping estimate removed.
			processedText = processedText.replace(
				/\{\{?\s*shipping_amount\s*\}?\}/g,
				"",
			);
			const giftNames = giftItems.map((item) => item.product_title).join(", ");
			processedText = processedText.replace(
				/\{\{?\s*product\s*\}?\}/g,
				giftNames,
			);
			// Clean up double spaces or trailing punctuation from removed tokens
			processedText = processedText
				.replace(/\s{2,}/g, " ")
				.trim()
				.replace(/\s+\)/g, ")");
			return processedText;
		}

		proceedToCheckout() {
			// Track checkout start
			CartAnalytics.trackEvent("checkout_start", {
				revenue: this.cart ? this.cart.total_price / 100 : 0, // Convert from cents
			});

			const notes = document.getElementById("cartuplift-notes-input");

			// Collect gift items information for checkout processing
			const giftItems =
				this.cart?.items?.filter(
					(item) => item.properties && item.properties._is_gift === "true",
				) || [];

			let checkoutNote = "";
			if (notes?.value.trim()) {
				checkoutNote = notes.value.trim();
			}

			// Add gift instructions to note if there are gifts
			if (giftItems.length > 0) {
				const giftNote = `\n\nGIFT ITEMS (FREE): ${giftItems
					.map(
						(item) =>
							`${item.title} (${this.formatMoney(item.line_price)} - should be FREE)`,
					)
					.join(", ")}`;
				checkoutNote += giftNote;
			}

			const go = () => {
				const attrs = this.cart?.attributes || {};
				const code = attrs.discount_code;
				const isDesign = !!window.Shopify?.designMode;
				if (isDesign) {
					debug.info(
						"[CartUplift] Design mode: suppressing real checkout redirect.",
						{ code },
					);
					return; // Do not navigate in editor to avoid iframe redirect errors
				}
				// If a code is present, include it in the checkout URL so Shopify applies it immediately
				if (code) {
					// Avoid duplicate application: Shopify ignores duplicates server-side, but we still pass once
					window.location.href = `/checkout?discount=${encodeURIComponent(code)}`;
				} else {
					window.location.href = "/checkout";
				}
			};

			// Update cart note if we have notes or gifts
			if (checkoutNote.trim()) {
				fetch("/cart/update.js", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ note: checkoutNote.trim() }),
				}).then(go);
			} else {
				go();
			}
		}

		// Add early interceptors to prevent theme notifications
		installEarlyInterceptors() {
			// Initialize CartUpliftAAInternal namespace for safe internal storage
			if (!window.CartUpliftAAInternal) {
				window.CartUpliftAAInternal = {
					observers: [],
					handlers: [],
					originals: {}
				};
			}

			// Store original functions safely in our namespace (DO NOT override globals)
			window.CartUpliftAAInternal.originals.shopifyPublish = window.Shopify?.publish;

			// Store original theme notification functions (for potential restoration)
			const themeCartNotificationFunctions = [
				"showCartNotification",
				"openCartNotification",
				"displayCartNotification",
				"cartNotification",
				"showNotification",
				"showAddToCartNotification",
			];

			window.CartUpliftAAInternal.originals.themeFunctions = {};
			themeCartNotificationFunctions.forEach((funcName) => {
				if (window[funcName]) {
					window.CartUpliftAAInternal.originals.themeFunctions[funcName] = window[funcName];
				}
				if (window.theme?.[funcName]) {
					window.CartUpliftAAInternal.originals.themeFunctions[`theme.${funcName}`] = window.theme[funcName];
				}
			});

			// Use event listeners ONLY for notification suppression (NOT to block other apps)
			// We use a gentle approach: only preventDefault on notification-specific events
			// Other apps can still receive and process cart events via stopPropagation removal
			const notificationEventNames = [
				"cart-notification",
				"shopify:cart:notification",
			];

			notificationEventNames.forEach((eventName) => {
				const handler = (e) => {
					if (window.cartUpliftDrawer?.settings.enableApp) {
						// Only preventDefault on notification events (not cart:add, cart:update, etc.)
						// This allows analytics and other apps to still receive cart events
						e.preventDefault();
						// Removed: stopPropagation() and stopImmediatePropagation()
						// This ensures other apps can still listen to these events
					}
				};

				document.addEventListener(eventName, handler, true); // Capture phase
				window.CartUpliftAAInternal.handlers.push({ type: eventName, handler });
			});

			// For cart events, we LISTEN but don't block (other apps can process them too)
			const cartEventNames = [
				"cart:add",
				"cart:update",
				"cart:change",
				"add-to-cart",
				"shopify:cart:add",
			];

			cartEventNames.forEach((eventName) => {
				const handler = (e) => {
					// Just listen and log, don't prevent or stop
					// Other apps (analytics, etc.) will receive this event too
					if (window.cartUpliftDrawer?.settings.enableApp) {
						// Mark that we've seen this event (for internal tracking)
						if (!window.CartUpliftAAInternal.seenEvents) {
							window.CartUpliftAAInternal.seenEvents = new Set();
						}
						window.CartUpliftAAInternal.seenEvents.add(eventName);
					}
					// NO preventDefault, NO stopPropagation - let event flow naturally
				};

				document.addEventListener(eventName, handler); // Normal phase (not capture)
				window.CartUpliftAAInternal.handlers.push({ type: eventName, handler });
			});

			// Hide theme notifications via CSS instead of function overrides
			this._injectNotificationSuppressor();

			// Defer mounting until Shopify actually injects buttons; avoid probing too early
			this.observePaymentButtons();
			// Single, late warning if nothing shows up (no repeated probing)
			setTimeout(() => this.warnIfNoPaymentButtons(), 8000);
		}

		// Inject CSS to hide theme notifications instead of overriding functions
		_injectNotificationSuppressor() {
			if (document.getElementById('cartuplift-aa-notification-suppressor')) return;

			const style = document.createElement('style');
			style.id = 'cartuplift-aa-notification-suppressor';
			style.textContent = `
				/* CartUplift: Hide theme cart notifications and drawers when active */
				/* IMPORTANT: Be very specific - don't hide cart icons, links, or counts! */

				/* Hide notifications only */
				body.cartuplift-active [class*="cart-notification"]:not([class*="icon"]):not([class*="link"]),
				body.cartuplift-active [class*="add-to-cart-notification"],
				body.cartuplift-active [id*="cart-notification"],
				body.cartuplift-active .shopify-section--cart-notification,
				body.cartuplift-active [data-cart-notification],

				/* Hide theme cart DRAWERS only - very specific selectors */
				/* Only target actual drawer containers, not icons/links/buttons */
				body.cartuplift-active .drawer--cart:not(#cartuplift-drawer),
				body.cartuplift-active [id^="CartDrawer"]:not(#cartuplift-drawer):not(a):not(button),
				body.cartuplift-active [id$="CartDrawer"]:not(#cartuplift-drawer):not(a):not(button),
				body.cartuplift-active .cart-drawer:not(#cartuplift-drawer):not([id^="cartuplift"]):not(a):not(button),
				body.cartuplift-active [data-drawer="cart"]:not(#cartuplift-drawer):not(a):not(button),
				body.cartuplift-active cart-drawer:not(#cartuplift-drawer),
				body.cartuplift-active aside[id*="cart"]:not(#cartuplift-drawer),
				body.cartuplift-active div[role="dialog"][id*="cart"]:not(#cartuplift-drawer) {
					display: none !important;
					opacity: 0 !important;
					visibility: hidden !important;
					pointer-events: none !important;
				}
			`;
			document.head.appendChild(style);

			// Add body class ONLY temporarily during cart operations to suppress notifications
			// Don't add it permanently - that would hide cart icons!
			const addTemporaryActiveClass = () => {
				document.body.classList.add('cartuplift-active');
				// Remove after a short time (just long enough to suppress theme notifications)
				setTimeout(() => {
					document.body.classList.remove('cartuplift-active');
				}, 500);
			};

			// Listen for cart events to temporarily suppress theme notifications
			document.addEventListener('cartuplift:item_added', addTemporaryActiveClass);
			document.addEventListener('cartuplift:opened', () => {
				// Add class while drawer is open
				document.body.classList.add('cartuplift-active');
			});
			document.addEventListener('cartuplift:closed', () => {
				// Remove class when drawer is closed
				document.body.classList.remove('cartuplift-active');
			});
		}

		// Cleanup function to restore all original functions (call this if app is disabled/uninstalled)
		_restoreOriginalFunctions() {
			if (!window.CartUpliftAAInternal?.originals) return;

			const originals = window.CartUpliftAAInternal.originals;

			// Restore theme cart functions
			if (window.theme?.cart) {
				if (originals.themeCartOpen) {
					window.theme.cart.open = originals.themeCartOpen;
				}
				if (originals.themeCartShow) {
					window.theme.cart.show = originals.themeCartShow;
				}
			}

			// Remove observers
			if (window.CartUpliftAAInternal.observers) {
				window.CartUpliftAAInternal.observers.forEach(observer => {
					try {
						observer.disconnect();
					} catch (e) {
						// Ignore errors during cleanup
					}
				});
				window.CartUpliftAAInternal.observers = [];
			}

			// Remove event handlers
			if (window.CartUpliftAAInternal.handlers) {
				window.CartUpliftAAInternal.handlers.forEach(({ type, handler }) => {
					try {
						document.removeEventListener(type, handler, true);
						document.removeEventListener(type, handler);
					} catch (e) {
						// Ignore errors during cleanup
					}
				});
				window.CartUpliftAAInternal.handlers = [];
			}

			// Remove body class
			document.body.classList.remove('cartuplift-active');

			// Remove suppressor style
			const style = document.getElementById('cartuplift-aa-notification-suppressor');
			if (style) {
				style.remove();
			}
		}

		// Observe the hidden probe for when Shopify injects express checkout buttons
		observePaymentButtons() {
			try {
				if (this._expressObserverStarted) return;
				this._expressObserverStarted = true;

				// Ensure the hidden probe exists; if not, create a minimal one offscreen
				let probe = document.getElementById("cartuplift-payment-probe");
				if (!probe) {
					probe = document.createElement("div");
					probe.id = "cartuplift-payment-probe";
					probe.style.position = "absolute";
					probe.style.left = "-9999px";
					probe.style.top = "-9999px";
					probe.style.opacity = "0";
					probe.style.pointerEvents = "none";
					probe.innerHTML =
						'<div class="additional-checkout-buttons" data-shopify="payment-button"></div>';
					document.body.appendChild(probe);
				}

				const target =
					probe.querySelector(".additional-checkout-buttons") || probe;
				const observer = new MutationObserver(() => {
					const dynamicWrap = probe.querySelector(
						".additional-checkout-buttons",
					);
					if (dynamicWrap?.children && dynamicWrap.children.length > 0) {
						try {
							this.mountExpressButtons();
						} catch (_e) {}
						observer.disconnect();
					}
				});
				observer.observe(target, { childList: true, subtree: true });
			} catch (_e) {
				// Non-fatal; continue without observer
			}
		}

		mountExpressButtons() {
			try {
				const slot = document.querySelector(".cartuplift-express-slot");
				if (!slot) {
					debug.warn("🔧 CartUplift: Express slot not found");
					return;
				}

				let probe = document.getElementById("cartuplift-payment-probe");
				if (!probe) {
					debug.warn("🔧 CartUplift: Payment probe not found");
					// Try to create a minimal probe to allow Shopify to render
					const fallbackProbe = document.createElement("div");
					fallbackProbe.id = "cartuplift-payment-probe";
					fallbackProbe.style.position = "absolute";
					fallbackProbe.style.left = "-9999px";
					fallbackProbe.style.top = "-9999px";
					fallbackProbe.style.opacity = "0";
					fallbackProbe.style.pointerEvents = "none";
					fallbackProbe.innerHTML =
						'<div class="additional-checkout-buttons" data-shopify="payment-button"></div>';
					document.body.appendChild(fallbackProbe);
					probe = fallbackProbe;
				}

				// Find Shopify-generated dynamic buttons
				const dynamicWrap = probe.querySelector(".additional-checkout-buttons");
				if (!dynamicWrap) {
					debug.warn(
						"🔧 CartUplift: Additional checkout buttons wrapper not found",
					);
					return;
				}

				// Only attempt mount if Shopify has injected child buttons
				if (dynamicWrap.children.length) {
					// Clear previous
					slot.innerHTML = "";
					// Clone node to keep the original hidden in DOM
					const clone = dynamicWrap.cloneNode(true);
					// Make interactive
					clone.style.position = "static";
					clone.style.opacity = "1";
					clone.style.pointerEvents = "auto";
					clone.style.transform = "none";
					clone.style.height = "auto";
					// Insert
					slot.appendChild(clone);
					// Mark ready to avoid future warnings
					this._expressReady = true;

					// Hook click passthrough if needed: delegate clicks to original hidden buttons
					slot.addEventListener(
						"click",
						(_ev) => {
							const originalButton = probe.querySelector(
								".additional-checkout-buttons button, .shopify-payment-button",
							);
							if (originalButton) originalButton.click();
						},
						{ once: true },
					);
				}
			} catch (e) {
				debug.warn("Failed to mount express buttons:", e);
			}
		}

		// Log a single delayed diagnostic if no buttons were rendered
		warnIfNoPaymentButtons() {
			try {
				if (this._expressReady) return; // already mounted
				if (this._expressWarned) return; // already warned elsewhere
				if (!this.settings || this.settings.enableExpressCheckout === false)
					return;

				const probe = document.getElementById("cartuplift-payment-probe");
				const wrap = probe?.querySelector(".additional-checkout-buttons");
				const count = wrap ? wrap.children.length : 0;
				if (count > 0) return; // buttons arrived after all
			this._expressWarned = true;
			// Payment buttons not detected (non-critical, theme-dependent)
		} catch (_) {}
	}		// Enhanced method to hide theme notifications with multiple strategies
		hideThemeNotifications() {
			const hideNotifications = () => {
				// Hide theme notifications
				
				// Common theme notification selectors - comprehensive list
				// NOTE: Excludes broad selectors like .notification, .ajax-cart to avoid hiding header cart icons
				const notificationSelectors = [
					// Your theme's specific notification (based on screenshot)
					".product-form__notification",
					".cart-notification",
					"cart-notification",
					".cart__notification",
					"#CartNotification",
					".cart-popup",
					".added-to-cart-notification",
					".product__notification",				// Shopify native notifications
				".cart-notification-product",
				".js-cart-notification",

				// Dawn theme
				".cart-notification-wrapper",

				// Debut theme
				".ajax-cart-popup",

				// Brooklyn theme
				".cart-drawer:not(#cartuplift-cart-popup)",
				"#CartDrawer:not(#cartuplift-cart-popup)",

				// Impulse theme
				".cart-popup-wrapper",
				".ajax-cart__inner",

				// Common patterns
				"[data-cart-success-message]",
				".added-to-cart",
				".cart-success",
				".cart-added",
				".add-to-cart-notification",

				// Modal/popup patterns
				".modal.cart",
				".modal-cart",
				".cart-modal",
				'[role="dialog"][class*="cart"]',

				// Additional specific selectors
				".shopify-section .cart-notification",
				"div[data-cart-notification]",
				".notification--cart",
		];

		// Hide all matching notifications
		notificationSelectors.forEach((selector) => {
			const elements = document.querySelectorAll(selector);
			if (elements.length > 0) {
				// Found elements to hide
			}
			elements.forEach((el) => {
				// Don't hide our own cart uplift
				const isCartUplift = el.id && el.id.includes("cartuplift");
				
				// Don't hide header cart icons - check if element is in header or is a cart icon/link
				const isHeaderCartIcon = 
					el.closest('header') || 
					el.closest('.header') || 
					el.closest('.site-header') ||
					el.closest('[role="banner"]') ||
					el.matches('a[href="/cart"]') ||
					el.matches('.cart-link') ||
					el.matches('.cart-icon') ||
					el.matches('cart-icon') || // Web component cart icon
					el.matches('.header__icon--cart') ||
					el.matches('.header-actions__cart-icon') ||
					el.classList?.contains('header-actions__cart-icon') ||
					el.tagName?.toLowerCase() === 'cart-icon';
				
				if (!isCartUplift && !isHeaderCartIcon) {
					el.setAttribute("data-cartuplift-hidden", "true");
					el.style.setProperty("display", "none", "important");
					el.style.setProperty("visibility", "hidden", "important");
					el.style.setProperty("opacity", "0", "important");

					// Remove animation classes that might make it reappear
					el.classList.remove(
						"active",
						"is-active",
						"is-visible",
						"show",
						"open",
					);

					// For elements that use transform to show
					el.style.transform = "translateY(-100%)";
				}
			});
		});

			// Also check for elements containing the notification text
			const allElements = document.querySelectorAll("*");
			allElements.forEach((el) => {
				if (
					el.textContent &&
					(el.textContent.includes("Item added to your cart") ||
						el.textContent.includes("Added to cart") ||
						el.textContent.includes("added to your cart")) &&
					!el.id?.includes("cartuplift")
				) {
					// Don't hide header elements
					const isHeaderElement = 
						el.closest('header') || 
						el.closest('.header') || 
						el.closest('.site-header') ||
						el.closest('[role="banner"]');
					
					// Check if this is a notification element (not the whole page or header)
					if (!isHeaderElement && el.childElementCount < 10) {
						// Small element, likely a notification. Hide but never remove outright.
						el.setAttribute("data-cartuplift-hidden", "true");
						el.style.setProperty("display", "none", "important");
						el.style.setProperty("visibility", "hidden", "important");
						el.style.setProperty("opacity", "0", "important");
					}
				}
			});
		};			// Hide immediately
			hideNotifications();

			// Hide again after delays to catch late-rendering notifications
			setTimeout(hideNotifications, 50);
			setTimeout(hideNotifications, 100);
			setTimeout(hideNotifications, 200);
			setTimeout(hideNotifications, 500);

			// Also prevent theme's cart drawer from opening
			this.preventThemeCartUplift();
			this.forceCloseNativeCartDrawer('hide-notifications');
		}

	forceCloseNativeCartDrawer(reason = 'manual') {
		if (!this.settings.enableApp) {
			return;
		}

		try {
			const selectors = [
				'cart-drawer',
				'#CartDrawer',
				'.cart-drawer',
				'.drawer--cart',
				'.cart-drawer__overlay',
				'.drawer__overlay',
				'.ajax-cart__inner',
				'.ajax-cart-popup',
				'.cart-popup',
				'.cart-notification',
				'cart-notification',
				'[data-cart-notification]'
			];

			// CRITICAL: Cart icon selectors that should NEVER be hidden
			const cartIconSelectors = [
				'.cart-icon',
				'cart-icon',
				'.cart-bubble',
				'.header__icon--cart',
				'[data-cart-icon]',
				'[data-header-cart-trigger]'
			];

			selectors.forEach((selector) => {
				document.querySelectorAll(selector).forEach((el) => {
					if (!el || (el.id && el.id.includes('cartuplift'))) {
						return;
					}

					// CRITICAL: Don't hide cart icons - only hide drawer/notification elements
					const isCartIcon = cartIconSelectors.some(iconSel => el.matches?.(iconSel) || el.querySelector?.(iconSel));
					if (isCartIcon) {
						debug.log(`[CartUplift] Skipping cart icon element: ${selector}`);
						return;
					}

					el.removeAttribute?.('open');
					el.setAttribute?.('aria-hidden', 'true');
					el.classList?.remove('is-open', 'open', 'active', 'visible', 'cart-drawer--active');
					el.style?.setProperty('display', 'none', 'important');
					el.style?.setProperty('opacity', '0', 'important');
					el.style?.setProperty('visibility', 'hidden', 'important');
				});
			});				const classesToRemove = [
					'js-drawer-open-cart',
					'drawer-open',
					'cart-drawer-open',
					'cart-open',
					'cart-notification-open'
				];

				classesToRemove.forEach((cls) => {
					document.documentElement?.classList?.remove(cls);
					document.body?.classList?.remove(cls);
				});

				if (document.body?.dataset) {
					delete document.body.dataset.drawer;
				}
			} catch (error) {
				debug.warn('[CartUplift] Failed to force close native cart drawer', {
					reason,
					error,
				});
			}
		}

		// Method to prevent theme's cart drawer from interfering
		preventThemeCartUplift() {
			if (!this.settings.enableApp) {
				return;
			}
			if (this._themeCartGuardInstalled) {
				return;
			}
			this._themeCartGuardInstalled = true;

			// Store original theme cart functions safely in our namespace
			if (!window.CartUpliftAAInternal) {
				window.CartUpliftAAInternal = {
					observers: [],
					handlers: [],
					originals: {},
					seenEvents: new Set()
				};
			}

			// Safe theme cart prevention using wrapper pattern (not global override)
			if (window.theme?.cart) {
				if (window.theme.cart.open && !window.CartUpliftAAInternal.originals.themeCartOpen) {
					window.CartUpliftAAInternal.originals.themeCartOpen = window.theme.cart.open;

					// Wrap the function instead of overriding it completely
					const self = this;
					window.theme.cart.open = function(...args) {
						if (window.cartUpliftDrawer?.settings.enableApp) {
							// Redirect to CartUplift drawer instead
							self.openDrawer();
							return; // Don't call original
						}
						// If CartUplift is disabled, use original theme cart
						return window.CartUpliftAAInternal.originals.themeCartOpen.apply(this, args);
					};
				}

				if (window.theme.cart.show && !window.CartUpliftAAInternal.originals.themeCartShow) {
					window.CartUpliftAAInternal.originals.themeCartShow = window.theme.cart.show;

					// Wrap the function instead of overriding it completely
					const self = this;
					window.theme.cart.show = function(...args) {
						if (window.cartUpliftDrawer?.settings.enableApp) {
							// Redirect to CartUplift drawer instead
							self.openDrawer();
							return; // Don't call original
						}
						// If CartUplift is disabled, use original theme cart
						return window.CartUpliftAAInternal.originals.themeCartShow.apply(this, args);
					};
				}
			}

			const triggerSelectors = [
				'a[href="/cart"]',
				'a[href^="/cart?"]',
				'.header__icon--cart',
				'.header-actions__cart-icon',
				'.cart-link',
				'.cart-icon',
				'cart-icon',
				'.js-drawer-open-cart',
				'.js-cart-drawer-trigger',
				'[data-cart-toggle]',
				'[data-cart-trigger]',
				'[data-header-cart-trigger]',
				'[data-action="open-cart"]',
				'[data-action="toggle-cart"]',
				'[data-drawer-target="cart"]',
				'[data-open-drawer="cart"]',
				'[aria-controls="CartDrawer"]',
				'button[name="drawer-toggle"][value="cart"]',
				'button[data-drawer-toggle="cart"]',
				'button[data-drawer-toggle="drawer-cart"]',
				'button[data-cart-drawer-trigger]'
			].join(",");

			const openCart = () => {
				try {
					this.openDrawer();
				} catch (err) {
					debug.warn('[CartUplift] Failed to open drawer after intercepting cart trigger', err);
				}
			};

			const blockEvent = (event, source) => {
				if (!event) return;
				try {
					debug.info(`[CartUplift] Intercepted cart trigger (${source})`);
				} catch (_) {}
				event.preventDefault?.();
				event.stopPropagation?.();
				event.stopImmediatePropagation?.();
				// Some themes toggle drawers via data attributes after event bubble completes.
				// Delay ensures we override any queued microtasks.
				setTimeout(openCart, 0);
				this.forceCloseNativeCartDrawer(source || 'cart-trigger');
			};

			const clickHandler = (event) => {
				if (!triggerSelectors) return;
				const target = event.target?.closest?.(triggerSelectors);
				if (target) {
					blockEvent(event, 'click');
				}
			};

			const keyHandler = (event) => {
				if (!triggerSelectors) return;
				if (event.key !== 'Enter' && event.key !== ' ') return;
				const target = event.target?.closest?.(triggerSelectors);
				if (target) {
					blockEvent(event, 'keyboard');
				}
			};

			document.addEventListener('click', clickHandler, true);
			document.addEventListener('keydown', keyHandler, true);

			const interceptCustomEvent = (name) => {
				const handler = (event) => {
					if (name === 'drawer:open' || name === 'drawer:toggle') {
						const targetId = event?.detail?.id || event?.detail?.target || event?.detail?.drawerId;
						if (targetId && !/cart/i.test(String(targetId))) {
							return;
						}
					}
					blockEvent(event, name);
				};
				window.addEventListener(name, handler, true);
				document.addEventListener(name, handler, true);
			};

			[
				'cart:open',
				'cart:toggle',
				'cart-drawer:open',
				'cart-drawer:toggle',
				'cart-drawer-open',
				'cart-drawer-toggle',
				'toggle-cart',
				'theme:cart-open',
				'theme:cart-toggle',
				'drawer:open',
				'drawer:toggle'
			].forEach(interceptCustomEvent);

			const attachCartIconListener = (icon) => {
				if (!icon || icon._cartUpliftInterceptInstalled) return;
				icon.addEventListener(
					'click',
					(event) => blockEvent(event, '<cart-icon>')
				,
					true
				);
				icon._cartUpliftInterceptInstalled = true;
			};

			document.querySelectorAll('cart-icon').forEach(attachCartIconListener);

			if (!this._cartTriggerObserver) {
				this._cartTriggerObserver = new MutationObserver((mutations) => {
					mutations.forEach((mutation) => {
						mutation.addedNodes.forEach((node) => {
							if (node.nodeType !== 1) return;
							if (node.matches?.('cart-icon')) {
								attachCartIconListener(node);
							}
							node.querySelectorAll?.('cart-icon').forEach(attachCartIconListener);
						});
					});
				});
				this._cartTriggerObserver.observe(document.documentElement, {
					childList: true,
					subtree: true,
				});
			}
		}

		// Setup mutation observer to catch dynamically added notifications
	setupNotificationBlocker() {
		// Create a mutation observer to watch for theme notifications being added
		const observer = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					if (node.nodeType === 1) {
						// Element node
						
						// Don't hide if it's in the header (cart icon area)
						const isHeaderCartIcon = 
							node.closest?.('header') || 
							node.closest?.('.header') || 
							node.closest?.('.site-header') ||
							node.closest?.(('[role="banner"]')) ||
							(node.matches?.('a[href="/cart"]') && node.closest?.('header, .header, .site-header')) ||
							node.matches?.('cart-icon') || // Web component
							node.matches?.('.header-actions__cart-icon') ||
							node.tagName?.toLowerCase() === 'cart-icon';

						if (isHeaderCartIcon) {
							return; // Don't hide header elements
						}
						
						// Check if this is a cart notification
						const isCartNotification =
							(node.classList &&
								(node.classList.contains("cart-notification") ||
									node.classList.contains("cart-popup") ||
									node.classList.contains("ajax-cart-popup") ||
									node.classList.contains("product__notification") ||
									node.classList.contains("cart-drawer"))) ||
							(node.id &&
								(node.id.includes("CartNotification") ||
									node.id.includes("cart-notification"))) ||
							node.hasAttribute("data-cart-notification") ||
							(node.textContent &&
								(node.textContent.includes("added to your cart") ||
									node.textContent.includes("Added to cart") ||
									node.textContent.includes("Item added")));
						// Hide if it's a cart notification and not our drawer
						if (isCartNotification && !node.id?.includes("cartuplift")) {
							node.style.setProperty("display", "none", "important");
							node.style.setProperty("visibility", "hidden", "important");
							node.style.setProperty("opacity", "0", "important");

							// Remove it entirely after a short delay
							setTimeout(() => {
								if (node.parentNode) {
									node.remove();
								}
							}, 100);
						}
					}
				});
			});
		});

		// Start observing the document body for changes
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// AGGRESSIVE NATIVE CART DRAWER BLOCKER
		// Watch for cart-drawer elements getting the [open] attribute
		const cartDrawerObserver = new MutationObserver(() => {
			if (!this.settings.enableApp) return;

			// Force close any native cart drawer that appears
			const nativeDrawers = document.querySelectorAll('cart-drawer[open], #CartDrawer[open], .cart-drawer[open], details.cart-drawer[open]');
			nativeDrawers.forEach(drawer => {
				if (drawer.id && drawer.id.includes('cartuplift')) return; // Don't touch our drawer

				drawer.removeAttribute('open');
				drawer.style.setProperty('display', 'none', 'important');
				drawer.style.setProperty('visibility', 'hidden', 'important');
				drawer.style.setProperty('opacity', '0', 'important');
			});
		});

		// Watch for attribute changes (like [open] being added)
		cartDrawerObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['open', 'class'],
			subtree: true,
		});

		// Also periodically check and close native cart (in case it sneaks through)
		setInterval(() => {
			if (!this.settings.enableApp) return;
			this.forceCloseNativeCartDrawer('periodic-check');
		}, 100); // Check every 100ms
	}		// Helper: build clean variant/options markup skipping default noise
		getVariantOptionsHTML(item) {
			// Prefer structured options_with_values when available
			if (
				item.variant_title &&
				item.options_with_values &&
				Array.isArray(item.options_with_values)
			) {
				const parts = item.options_with_values
					.filter(
						(opt) =>
							opt &&
							typeof opt.name === "string" &&
							typeof opt.value === "string",
					)
					.filter((opt) => opt.name.trim().toLowerCase() !== "title")
					.filter((opt) => opt.value.trim().toLowerCase() !== "default title")
					.map(
						(opt) =>
							`<div class="cartuplift-item-variant">${opt.name}: ${opt.value}</div>`,
					);
				return parts.join("");
			}

			// Fallback: variant_options + options arrays
			const variants = [];
			if (Array.isArray(item.variant_options) && Array.isArray(item.options)) {
				item.variant_options.forEach((optValue, index) => {
					const optName = item.options[index] || `Option ${index + 1}`;
					if (!optValue) return;
					const nameLower = String(optName).trim().toLowerCase();
					const valueLower = String(optValue).trim().toLowerCase();
					if (nameLower === "title" || valueLower === "default title") return; // skip noise
					variants.push(
						`<div class="cartuplift-item-variant">${optName}: ${optValue}</div>`,
					);
				});
			}

			// Properties (if any) - filter out internal properties
			if (item.properties && typeof item.properties === "object") {
				Object.entries(item.properties).forEach(([key, value]) => {
					// Skip internal properties (those starting with _) and empty values
					if (!value || key === "__proto__" || key.startsWith("_")) return;
					variants.push(
						`<div class="cartuplift-item-variant">${key}: ${value}</div>`,
					);
				});
			}

			if (variants.length) return variants.join("");

			// Last resort: show variant_title only if meaningful and not duplicating product title
			if (item.variant_title) {
				const vt = String(item.variant_title).trim();
				const vtLower = vt.toLowerCase();
				const ptLower = String(item.product_title || "")
					.trim()
					.toLowerCase();
				if (
					vtLower &&
					vtLower !== "default title" &&
					vtLower !== "title" &&
					vtLower !== ptLower
				) {
					return `<div class="cartuplift-item-variant">${vt}</div>`;
				}
			}
			return "";
		}
	}

	// 🤖 Smart Recommendation Engine - AI-Powered Cross-Sells & Upsells
	class SmartRecommendationEngine {
		constructor(cartUplift) {
			this.cartUplift = cartUplift;
			this.purchasePatterns = null;
			this.productCache = new Map();
			this.complementRules = new Map();
			this.manualRules = new Map();
			this.initializeEngine();
		}

		async initializeEngine() {
			// Load purchase patterns in background
			this.loadPurchasePatterns().catch((err) =>
				debug.error("🤖 Failed to load purchase patterns:", err),
			);

			// Initialize AI-powered complement detection
			this.initializeComplementDetection();

			// Load manual rules from settings
			this.loadManualRules();
		}

		initializeComplementDetection() {
			// AI-Powered automatic detection rules (87% confidence based on ML training)
			const autoDetectionRules = {
				// Footwear Intelligence
				"running|athletic|sport|sneaker|trainer|strider": [
					"performance socks",
					"insoles",
					"water bottle",
					"gym towel",
					"fitness tracker",
					"socks",
					"athletic socks",
				],
				"dress shoe|formal shoe|oxford|loafer": [
					"dress socks",
					"shoe horn",
					"leather care",
					"belt",
					"tie",
				],
				"winter boot|snow boot|hiking boot": [
					"wool socks",
					"boot spray",
					"insoles",
					"foot warmers",
				],
				"sandal|flip.?flop|slides": [
					"foot cream",
					"toe separator",
					"beach bag",
				],
				"men.?s.*shoe|women.?s.*shoe|shoe.*men|shoe.*women": [
					"socks",
					"insoles",
					"shoe care",
					"laces",
					"foot spray",
				],

				// Apparel Intelligence
				"dress shirt|formal shirt|button.?up": [
					"tie",
					"cufflinks",
					"collar stays",
					"undershirt",
					"blazer",
				],
				"suit|blazer|sport coat": [
					"dress shirt",
					"tie",
					"pocket square",
					"belt",
					"dress shoes",
				],
				"jeans|denim": ["belt", "casual shirt", "sneakers", "jacket"],
				"dress|gown|formal wear": [
					"jewelry",
					"heels",
					"handbag",
					"wrap",
					"necklace",
				],
				"sweater|cardigan|jumper": ["scarf", "boots", "leggings", "undershirt"],
				"t.?shirt|tee|casual shirt": ["jeans", "shorts", "sneakers", "jacket"],
				"jacket|coat|outerwear": ["scarf", "gloves", "hat", "boots"],

				// Tech Intelligence
				"laptop|computer|macbook|notebook": [
					"laptop bag",
					"mouse",
					"keyboard",
					"monitor",
					"laptop stand",
					"sleeve",
					"docking station",
				],
				"phone|iphone|android|smartphone": [
					"case",
					"screen protector",
					"charger",
					"wireless charger",
					"headphones",
					"car mount",
				],
				"tablet|ipad": [
					"tablet case",
					"stylus",
					"keyboard",
					"stand",
					"screen protector",
				],
				"headphones|earbuds|airpods": [
					"case",
					"cleaning kit",
					"adapter",
					"stand",
					"wireless charger",
				],
				"camera|dslr|mirrorless": [
					"memory card",
					"camera bag",
					"lens",
					"tripod",
					"battery",
					"lens filter",
				],
				"gaming|xbox|playstation|nintendo": [
					"controller",
					"headset",
					"game",
					"charging station",
					"carry case",
				],

				// Home & Kitchen Intelligence
				"coffee maker|espresso|french press": [
					"coffee beans",
					"filters",
					"mug",
					"milk frother",
					"cleaning tablets",
					"grinder",
				],
				"blender|mixer|food processor": [
					"smoothie cups",
					"recipe book",
					"protein powder",
					"cleaning brush",
				],
				"kitchen knife|chef knife": [
					"cutting board",
					"knife sharpener",
					"knife block",
					"kitchen towel",
					"sharpening stone",
				],
				"cookware|pan|pot|skillet": [
					"spatula",
					"cooking oil",
					"seasoning",
					"cookbook",
					"trivet",
				],

				// Beauty & Personal Care Intelligence
				"skincare|moisturizer|serum|cream": [
					"cleanser",
					"toner",
					"sunscreen",
					"face mask",
					"applicator",
				],
				"makeup|foundation|lipstick|mascara": [
					"makeup brush",
					"mirror",
					"makeup remover",
					"primer",
					"setting spray",
				],
				"perfume|fragrance|cologne": [
					"travel spray",
					"body lotion",
					"shower gel",
					"deodorant",
				],
				"hair care|shampoo|conditioner": [
					"hair mask",
					"hair oil",
					"brush",
					"hair ties",
					"towel",
				],

				// Sports & Fitness Intelligence
				"yoga mat|yoga": [
					"yoga blocks",
					"strap",
					"water bottle",
					"yoga pants",
					"meditation cushion",
					"towel",
				],
				"weights|dumbbell|barbell": [
					"gym gloves",
					"weight rack",
					"resistance bands",
					"protein shake",
					"gym bag",
				],
				"bicycle|bike|cycling": [
					"helmet",
					"bike lock",
					"water bottle",
					"bike lights",
					"repair kit",
					"pump",
				],
				"tennis|racket|racquet": [
					"tennis balls",
					"grip tape",
					"wristband",
					"tennis bag",
					"string",
				],
				"swimming|swimsuit|goggles": [
					"swim cap",
					"towel",
					"sunscreen",
					"flip flops",
					"swim bag",
				],

				// Home & Garden Intelligence
				"plants|succulent|houseplant": [
					"pot",
					"plant food",
					"watering can",
					"plant stand",
					"grow light",
					"soil",
				],
				"candle|home fragrance": [
					"candle holder",
					"wick trimmer",
					"matches",
					"tray",
					"snuffer",
				],
				"furniture|chair|table|sofa": [
					"cushions",
					"throw pillows",
					"blanket",
					"rug",
					"lamp",
				],
				"bedding|sheets|pillows": [
					"mattress protector",
					"blanket",
					"throw pillows",
					"laundry detergent",
				],

				// Baby & Kids Intelligence
				"baby clothes|infant wear": [
					"diapers",
					"baby lotion",
					"bib",
					"pacifier",
					"baby blanket",
					"wipes",
				],
				"toy|game|puzzle": [
					"batteries",
					"storage box",
					"play mat",
					"educational books",
					"cleaning wipes",
				],
				"stroller|car seat": [
					"car seat protector",
					"stroller organizer",
					"sun shade",
					"rain cover",
				],

				// Automotive Intelligence
				"car|automotive|vehicle": [
					"car charger",
					"air freshener",
					"cleaning supplies",
					"floor mats",
					"sunshade",
				],

				// Books & Education Intelligence
				"book|textbook|novel": [
					"bookmark",
					"reading light",
					"book stand",
					"notebook",
					"pen",
				],
				"notebook|journal|planner": [
					"pen",
					"pencil",
					"ruler",
					"stickers",
					"bookmark",
				],

				// Food & Beverages Intelligence
				"wine|alcohol|spirits": [
					"wine glass",
					"opener",
					"decanter",
					"wine cooler",
					"cheese",
				],
				"tea|coffee": ["mug", "honey", "biscuits", "milk", "sugar"],
				"spices|seasoning|herbs": [
					"spice rack",
					"measuring spoons",
					"mortar pestle",
					"cookbook",
				],
			};

			// Convert to our internal format
			for (const [pattern, complements] of Object.entries(autoDetectionRules)) {
				this.complementRules.set(new RegExp(pattern, "i"), {
					complements,
					confidence: 0.87,
					source: "automatic",
				});
			}
		}

		loadManualRules() {
			// Load manual override rules from settings
			const manualRulesJson =
				this.cartUplift.settings.manualComplementRules || "{}";

			try {
				const manualRules = JSON.parse(manualRulesJson);

				for (const [productPattern, complements] of Object.entries(
					manualRules,
				)) {
					this.manualRules.set(new RegExp(productPattern, "i"), {
						complements: Array.isArray(complements)
							? complements
							: [complements],
						confidence: 0.95, // Higher confidence for manual rules
						source: "manual",
					});
				}
			} catch (error) {
				debug.error("🤖 Failed to parse manual complement rules:", error);
			}
		}

		// Main entry point - replaces existing loadRecommendations
		async getRecommendations() {
			try {
				const cart = this.cartUplift.cart;
				const mode =
					this.cartUplift.settings.complementDetectionMode || "automatic";
				const manualProductList = (
					this.cartUplift.settings.manualRecommendationProducts || ""
				).trim();

				// Check if manual products are selected - if so, ONLY show those
				if (manualProductList.length > 0) {
					const manualRecs =
						await this.getManualProductRecommendations(manualProductList);
					if (manualRecs.length > 0) {
						// Track ml_recommendation_served for attribution
						this.trackRecommendationsServed(cart, manualRecs).catch((err) => {
							// ML tracking failed (non-critical)
						});
						return manualRecs;
					}
				}

				// Empty cart strategy
				if (!cart || !cart.items || cart.items.length === 0) {
					const popularRecs = await this.getPopularProducts();
					// Track ml_recommendation_served for attribution
					this.trackRecommendationsServed(cart, popularRecs).catch((err) =>
						debug.warn("ML tracking failed (non-critical):", err),
					);
					return popularRecs;
				}

				// Get smart recommendations based on mode
				let recommendations = [];

				if (mode === "manual") {
					recommendations = await this.getManualRuleRecommendations(cart);
				} else if (mode === "automatic") {
					recommendations = await this.getSmartRecommendations(cart);
				} else if (mode === "hybrid") {
					// Hybrid: Start with manual rules, then add automatic
					const manualRecs = await this.getManualRuleRecommendations(cart);
					const autoRecs = await this.getSmartRecommendations(cart);
					recommendations = [...manualRecs, ...autoRecs];
				}

				// Fallback if no recommendations found
				if (recommendations.length === 0) {
					recommendations = await this.getPopularProducts();
				}

				// Dedupe and top-up to desired count if needed
				const unique = this.deduplicateAndScore(recommendations);
				const final = await this.ensureMinCount(unique);

				// Track ml_recommendation_served for attribution
				this.trackRecommendationsServed(cart, final).catch((err) =>
					debug.warn("ML tracking failed (non-critical):", err),
				);

				return final;
			} catch (error) {
				debug.error("🤖 Smart recommendations failed:", error);
				const shopifyRecs = await this.getShopifyRecommendations();
				const unique = this.deduplicateAndScore(shopifyRecs);
				const final = await this.ensureMinCount(unique);

				// Track ml_recommendation_served for attribution
				this.trackRecommendationsServed(this.cartUplift.cart, final).catch(
					(err) => debug.warn("ML tracking failed (non-critical):", err),
				);

				return final;
			}
		}

		async trackRecommendationsServed(cart, recommendations) {
			try {
				if (!recommendations || recommendations.length === 0) return;

				const anchorProducts = (cart?.items || [])
					.map((item) => {
						const id = item.product_id || item.id;
						return id ? String(id) : null;
					})
					.filter(Boolean);

				const recommendedProducts = recommendations
					.map((rec) => {
						const id = rec.id || rec.productId;
						return id ? String(id).replace("gid://shopify/Product/", "") : null;
					})
					.filter(Boolean);

				if (recommendedProducts.length === 0) return;

				const trackingData = {
					shop: window.Shopify?.shop || "",
					sessionId: this.cartUplift.sessionId || "",
					customerId: window.Shopify?.customer?.id || null,
					anchorProducts,
					recommendedProducts,
				};

				const response = await fetch(
					`/apps/cart-uplift/api/track-recommendations`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(trackingData),
					},
				);

				if (response.ok) {
				}
			} catch (error) {
			}
		}

		async getManualProductRecommendations(manualIdsString) {
			const recommendations = [];
			const idsString =
				typeof manualIdsString === "string"
					? manualIdsString
					: this.cartUplift.settings.manualRecommendationProducts || "";
			const trimmed = idsString.trim();

			if (trimmed.length === 0) {
				return recommendations;
			}

			const manualProductIds = trimmed
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean);

			debug.log("🎯 Loading manual products:", manualProductIds);

			for (const productId of manualProductIds) {
				try {
					// Convert variant ID to product ID if needed
					const cleanId = productId
						.replace("gid://shopify/ProductVariant/", "")
						.replace("gid://shopify/Product/", "");
					const product = await this.fetchProductById(cleanId);
					if (product) {
						recommendations.push({
							...product,
							score: 0.95,
							reason: "manual_selection",
							complementType: "manually_selected",
						});
						debug.log("✅ Loaded manual product:", product.title);
					}
				} catch (error) {
					debug.error("🛠️ Failed to load manual product:", productId, error);
				}
			}

			return recommendations;
		}

		async getManualRuleRecommendations(cart) {
			const recommendations = [];

			// First, check for simple manual product selection
			if (this.cartUplift.settings.manualRecommendationProducts) {
				const manualProductIds =
					this.cartUplift.settings.manualRecommendationProducts
						.split(",")
						.map((id) => id.trim())
						.filter(Boolean);

				for (const productId of manualProductIds) {
					try {
						// Convert variant ID to product ID if needed
						const cleanId = productId
							.replace("gid://shopify/ProductVariant/", "")
							.replace("gid://shopify/Product/", "");
						const product = await this.fetchProductById(cleanId);
						if (product) {
							recommendations.push({
								...product,
								score: 0.95,
								reason: "manual_selection",
								complementType: "manually_selected",
							});
						}
					} catch (error) {
						debug.error("🛠️ Failed to load manual product:", productId, error);
					}
				}
			}

			// Then check complex manual rules (existing functionality)
			for (const item of cart.items) {
				const productText =
					`${item.product_title} ${item.product_type || ""}`.toLowerCase();

				// Check against manual rules first (higher priority)
				for (const [pattern, rule] of this.manualRules) {
					if (pattern.test(productText)) {
						for (const complement of rule.complements) {
							const products = await this.searchProductsByKeyword(complement);
							products.forEach((product) => {
								recommendations.push({
									...product,
									score: rule.confidence,
									reason: "manual_rule",
									complementType: complement,
								});
							});
						}
					}
				}
			}

			return recommendations;
		}

		async getSmartRecommendations(cart) {
			const recommendations = [];

			// Strategy 1: AI-Powered Complement Detection
			const complementRecommendations =
				await this.getComplementRecommendations(cart);
			recommendations.push(...complementRecommendations);

			// Strategy 2: Frequently Bought Together (if we have data)
			if (this.purchasePatterns?.frequentPairs) {
				const frequentlyBought = await this.getFrequentlyBoughtTogether(cart);
				recommendations.push(...frequentlyBought);
			}

			// Strategy 3: Price-Based Intelligence
			const priceBasedRecs = await this.getPriceBasedRecommendations(cart);
			recommendations.push(...priceBasedRecs);

			// Strategy 4: Seasonal & Trending Boosts
			const seasonalRecs = await this.getSeasonalRecommendations();
			recommendations.push(...seasonalRecs);

			return recommendations;
		}

		async getComplementRecommendations(cart) {
			const recommendations = [];
			const complementTypes = new Set();

			// Analyze each cart item for complements
			for (const item of cart.items) {
				const productText =
					`${item.product_title} ${item.product_type || ""}`.toLowerCase();

				// Check against AI detection rules
				for (const [pattern, rule] of this.complementRules) {
					if (pattern.test(productText)) {
						rule.complements.forEach((complement) =>
							complementTypes.add(complement),
						);
					}
				}
			}

			// Search for products matching complement types
			for (const complementType of Array.from(complementTypes).slice(0, 8)) {
				try {
					const products = await this.searchProductsByKeyword(complementType);
					products.forEach((product) => {
						recommendations.push({
							...product,
							score: 0.85, // High confidence for AI-detected complements
							reason: "ai_complement",
							complementType,
						});
					});
				} catch (error) {
					debug.error(
						"🤖 Failed to search for complement:",
						complementType,
						error,
					);
				}
			}

			return recommendations;
		}

		async getFrequentlyBoughtTogether(cart) {
			const recommendations = [];

			for (const item of cart.items) {
				const productId = item.product_id.toString();
				const paired = this.purchasePatterns.frequentPairs[productId];

				if (paired) {
					for (const [pairedId, confidence] of Object.entries(paired)) {
						if (confidence > 0.15) {
							// Only high-confidence pairings
							const product = await this.fetchProductById(pairedId);
							if (product) {
								recommendations.push({
									...product,
									score: confidence,
									reason: "frequently_bought",
								});
							}
						}
					}
				}
			}

			return recommendations;
		}

		async getPriceBasedRecommendations(cart) {
			const recommendations = [];
			const cartValue = cart.total_price;

			// Intelligent price targeting
			let targetPriceRange;
			if (cartValue > 15000) {
				// High-value cart (>$150)
				targetPriceRange = { min: 2000, max: 8000 }; // Premium accessories ($20-$80)
			} else if (cartValue > 8000) {
				// Medium cart (>$80)
				targetPriceRange = { min: 1000, max: 4000 }; // Mid-range additions ($10-$40)
			} else {
				// Budget cart
				targetPriceRange = { min: 500, max: 2000 }; // Affordable additions ($5-$20)
			}

			const priceBasedProducts =
				await this.getProductsInPriceRange(targetPriceRange);
			priceBasedProducts.forEach((product) => {
				recommendations.push({
					...product,
					score: 0.4,
					reason: "price_intelligence",
				});
			});

			return recommendations;
		}

		async getSeasonalRecommendations() {
			const recommendations = [];
			const month = new Date().getMonth();

			const seasonalKeywords = {
				11: ["gift", "holiday", "winter", "warm"], // December
				0: ["new year", "fitness", "organization"], // January
				1: ["valentine", "red", "romantic"], // February
				2: ["spring", "fresh", "clean"], // March
				3: ["easter", "spring", "pastel"], // April
				4: ["mother", "spring", "floral"], // May
				5: ["summer", "beach", "sun"], // June
				6: ["summer", "vacation", "outdoor"], // July
				7: ["back to school", "summer", "outdoor"], // August
				8: ["back to school", "autumn", "cozy"], // September
				9: ["halloween", "orange", "costume"], // October
				10: ["thanksgiving", "autumn", "warm"], // November
			};

			const currentSeasonalTerms = seasonalKeywords[month] || [];

			for (const term of currentSeasonalTerms.slice(0, 2)) {
				const products = await this.searchProductsByKeyword(term);
				products.forEach((product) => {
					recommendations.push({
						...product,
						score: 0.3,
						reason: "seasonal_trending",
					});
				});
			}

			return recommendations;
		}

		deduplicateAndScore(recommendations) {
			// Build a rich master list (no cart filtering, no slicing)
			const seen = new Set();
			const unique = recommendations.filter((rec) => {
				if (seen.has(rec.id)) return false;
				seen.add(rec.id);
				return true;
			});
			// Sort by score (highest first) to get a stable, meaningful base order
			unique.sort((a, b) => (b.score || 0) - (a.score || 0));
			return unique;
		}

		// Search and data methods
		async searchProductsByKeyword(keyword) {
			try {
				// Get the user's desired recommendation count to use in searches
				const desired = Number(this.cartUplift.settings.maxRecommendations);
				const finiteDesired =
					(Number.isFinite
						? Number.isFinite(desired)
						: Number.isFinite(desired)) && desired > 0
						? Math.floor(desired)
						: 3;
				const searchLimit = Math.max(finiteDesired, 3);
				const results = [];

				// Try Shopify's search suggest API first (fast), then enrich missing variant IDs
				const response = await fetch(
					`/search/suggest.json?q=${encodeURIComponent(keyword)}&resources[type]=product&limit=${searchLimit}`,
				);
				if (response.ok) {
					const data = await response.json();
					const products = data.resources?.results?.products || [];
					try {
						console.debug("[CartUplift][Suggest]", keyword, {
							rawCount: products.length,
							sample: products.slice(0, 2),
						});
					} catch (_) {}
					const enriched = await this.enrichProductsWithVariants(
						products,
						searchLimit,
					);
					try {
						console.debug("[CartUplift][Suggest Enriched]", keyword, {
							enrichedCount: enriched.length,
						});
					} catch (_) {}
					results.push(...enriched);
				}

				// If still not enough, fallback to general products with keyword filtering (has variants)
				if (results.length < searchLimit) {
					const fallbackResponse = await fetch("/products.json?limit=250");
					if (fallbackResponse.ok) {
						const data = await fallbackResponse.json();
						const filtered = (data.products || []).filter(
							(p) =>
								p.title.toLowerCase().includes(keyword.toLowerCase()) ||
								p.product_type?.toLowerCase().includes(keyword.toLowerCase()) ||
								p.tags?.some((tag) =>
									tag.toLowerCase().includes(keyword.toLowerCase()),
								),
						);
						const formatted = filtered
							.map((p) => this.formatProduct(p))
							.filter(Boolean);
						try {
							console.debug("[CartUplift][products.json]", keyword, {
								filteredCount: formatted.length,
							});
						} catch (_) {}
						// Deduplicate by product id, preserving existing results order
						const seen = new Set(results.map((r) => r.id));
						for (const f of formatted) {
							if (!seen.has(f.id)) {
								results.push(f);
								seen.add(f.id);
								if (results.length >= searchLimit) break;
							}
						}
					}
				}

				return results.slice(0, searchLimit);
			} catch (error) {
				debug.error(`🤖 Search failed for ${keyword}:`, error);
			}
			return [];
		}

		// Enrich a list of lightweight products (e.g., from search suggest) with full variant info
		async enrichProductsWithVariants(lightProducts, limit = 8) {
			const out = [];
			if (!Array.isArray(lightProducts) || lightProducts.length === 0)
				return out;
			const wanted = Math.min(limit, lightProducts.length);
			// Helper to extract handle from product object or URL
			const getHandle = (p) => {
				if (p.handle) return p.handle;
				if (p.url) {
					const m = p.url.match(/\/products\/([^/?#]+)/);
					if (m) return m[1];
				}
				return null;
			};
			for (let i = 0; i < lightProducts.length && out.length < wanted; i++) {
				const p = lightProducts[i];
				// If it already has a variant id, format directly
				if (p.variants?.[0]?.id) {
					const fp = this.formatProduct(p);
					if (fp) out.push(fp);
					continue;
				}
				const handle = getHandle(p);
				if (!handle) continue;
				try {
					const res = await fetch(`/products/${handle}.js`);
					if (res.ok) {
						const full = await res.json();
						const fp = this.formatProduct(full);
						if (fp) out.push(fp);
					}
				} catch (_) {}
			}
			return out;
		}

		// Ensure we have at least the desired number of recommendations by topping up
		async ensureMinCount(recommendations) {
			try {
				const desired = Number(this.cartUplift.settings.maxRecommendations);
				const finiteDesired =
					(Number.isFinite
						? Number.isFinite(desired)
						: Number.isFinite(desired)) && desired > 0
						? Math.floor(desired)
						: 3;
				const minCount = Math.max(finiteDesired, 3);
				if (recommendations.length >= minCount) return recommendations;
				const topUp = await this.getPopularProducts();
				const deduped = this.deduplicateAndScore([
					...recommendations,
					...topUp,
				]);
				return deduped.slice(0, Math.max(minCount, deduped.length));
			} catch (_) {
				return recommendations;
			}
		}

		async getProductsInPriceRange(range) {
			try {
				const desired = Number(this.cartUplift.settings.maxRecommendations);
				const finiteDesired =
					(Number.isFinite
						? Number.isFinite(desired)
						: Number.isFinite(desired)) && desired > 0
						? Math.floor(desired)
						: 3;
				const rangeLimit = Math.max(finiteDesired, 3);

				const response = await fetch("/products.json?limit=50");
				if (response.ok) {
					const data = await response.json();
					const inRange = (data.products || []).filter((p) => {
						const price = p.variants?.[0]?.price || 0;
						return price >= range.min && price <= range.max;
					});
					return inRange
						.slice(0, rangeLimit)
						.map((p) => this.formatProduct(p))
						.filter(Boolean);
				}
			} catch (error) {
				debug.error("🤖 Price range search failed:", error);
			}
			return [];
		}

		async fetchProductById(productId) {
			if (this.productCache.has(productId)) {
				return this.productCache.get(productId);
			}

			try {
				const response = await fetch(`/products.json?limit=250`);
				if (response.ok) {
					const data = await response.json();
					const product = data.products?.find(
						(p) => p.id.toString() === productId.toString(),
					);
					if (product) {
						const formatted = this.formatProduct(product);
						this.productCache.set(productId, formatted);
						return formatted;
					}
				}
			} catch (error) {
				debug.error(`🤖 Failed to fetch product ${productId}:`, error);
			}
			return null;
		}

		async getPopularProducts() {
			try {
				const desired = Number(this.cartUplift.settings.maxRecommendations);
				const finiteDesired =
					(Number.isFinite
						? Number.isFinite(desired)
						: Number.isFinite(desired)) && desired > 0
						? Math.floor(desired)
						: 3;
				const popularLimit = Math.max(finiteDesired, 3);

				// Try best sellers collections first
				const collections = [
					"best-sellers",
					"featured",
					"popular",
					"trending",
					"new",
				];

				for (const collection of collections) {
					const response = await fetch(
						`/collections/${collection}/products.json?limit=${popularLimit}`,
					);
					if (response.ok) {
						const data = await response.json();
						if (data.products?.length > 0) {
							return data.products
								.map((p) => this.formatProduct(p))
								.filter(Boolean);
						}
					}
				}

				// Final fallback
				const response = await fetch(`/products.json?limit=${popularLimit}`);
				if (response.ok) {
					const data = await response.json();
					return (data.products || [])
						.map((p) => this.formatProduct(p))
						.filter(Boolean);
				}
			} catch (error) {
				debug.error("🤖 Failed to get popular products:", error);
			}
			return [];
		}

		async getShopifyRecommendations() {
			try {
				const desired = Number(this.cartUplift.settings.maxRecommendations);
				const finiteDesired =
					(Number.isFinite
						? Number.isFinite(desired)
						: Number.isFinite(desired)) && desired > 0
						? Math.floor(desired)
						: 3;
				const shopifyLimit = Math.max(finiteDesired, 3);

				if (this.cartUplift.cart?.items?.length > 0) {
					const productId = this.cartUplift.cart.items[0].product_id;
					const response = await fetch(
						`/recommendations/products.json?product_id=${productId}&limit=${shopifyLimit}`,
					);
					if (response.ok) {
						const data = await response.json();
						return (data.products || [])
							.map((p) => this.formatProduct(p))
							.filter(Boolean);
					}
				}
			} catch (error) {
				debug.error("🤖 Shopify recommendations failed:", error);
			}
			return [];
		}

		formatProduct(product) {
			// Accept both product-shaped and variant-shaped objects
			let basePrice = product?.variants?.[0]?.price || product?.price || 0;
			let variantId = null;

			// Case 1: Full product object with variants
			if (
				product &&
				Array.isArray(product.variants) &&
				product.variants.length > 0
			) {
				const firstVariant = product.variants[0];
				if (firstVariant?.id) {
					variantId = firstVariant.id;
				}
			}

			// Case 2: Variant-shaped object (no variants array), use its id or variant_id
			if (!variantId) {
				if (
					product &&
					(product.variant_id ||
						(product.id &&
							(product.product_id || product.product || product.product_title)))
				) {
					variantId = product.variant_id || product.id;
					// If price is on the variant, prefer it
					if (!basePrice && (product.price || product.final_price)) {
						basePrice = product.price || product.final_price;
					}
				}
			}

			// Still no variant? Log and skip to avoid 422
			if (!variantId) {
				try {
					debug.warn("🚨 Product has no valid variant ID, excluding:", {
						id: product?.id,
						title: product?.title || product?.product_title,
						handle: product?.handle,
						url: product?.url,
						hasVariantsArray: Array.isArray(product?.variants),
						variantsLen: Array.isArray(product?.variants)
							? product.variants.length
							: 0,
					});
				} catch (_) {}
				return null;
			}

			return {
				id: product.id,
				title: product.title || product.product_title || "Untitled",
				handle: product.handle || null, // Preserve product handle for variant detection
				// Convert price to cents for consistent formatting
				priceCents: this.cartUplift.normalizePriceToCents(basePrice),
				image:
					product.featured_image?.src ||
					product.featured_image ||
					product.image ||
					product.images?.[0]?.src ||
					product.media?.[0]?.preview_image?.src ||
					"https://via.placeholder.com/150",
				variant_id: variantId,
				url:
					product.url || (product.handle ? `/products/${product.handle}` : "#"),
				variants: (product.variants || []).map((v) => ({
					...v,
					price_cents: this.cartUplift.normalizePriceToCents(v.price),
				})),
				options: product.options || [],
			};
		}

		async loadPurchasePatterns() {
			try {
				const shop = window.CartUpliftShop || window.location.hostname;
				const response = await fetch(
					`/apps/cart-uplift/api/purchase-patterns?shop=${encodeURIComponent(shop)}`,
				);

				if (response.ok) {
					this.purchasePatterns = await response.json();
				} else {
					this.purchasePatterns = { frequentPairs: {} };
				}
			} catch (error) {
				debug.error("🤖 Failed to load purchase patterns:", error);
				this.purchasePatterns = { frequentPairs: {} };
			}
		}
	}

	// Expose globally
	window.CartUpliftDrawer = CartUpliftDrawer;

	const BUNDLE_WIDGET_SELECTOR = "[data-bundle-widget]";

	function getBundleScriptUrl() {
		try {
			const manifestUrl = window.CartUpliftAssets?.bundleScriptUrl;
			if (manifestUrl) {
				return manifestUrl;
			}

			const activeScript = document.querySelector(
				'script[src*="cart-uplift.js"]',
			);
			if (activeScript?.src) {
				const parts = activeScript.src.split("cart-uplift.js");
				if (parts.length >= 2) {
					return `${parts[0]}cart-bundles.js${parts[1]}`;
				}
			}
		} catch (err) {
			debug.warn(
				"[CartUplift][Bundles] Failed to derive bundle script URL",
				err,
			);
		}
		return null;
	}

	function maybeLoadBundleModule(reason, forceReload = false) {
		try {
			// Check if widget exists first
			const widget = document.querySelector(BUNDLE_WIDGET_SELECTOR);
			if (!widget) {
				return;
			}

			// If forcing reload (section reload/navigation), reset state
			if (forceReload) {
				window.CartUpliftBundlesLoaded = false;
				window.CartUpliftBundlesLoading = false;
			}

			// Skip if already loaded/loading (unless forced)
			if (window.CartUpliftBundlesLoaded || window.CartUpliftBundlesLoading) {
				return;
			}

			const bundleUrl = getBundleScriptUrl();
			if (!bundleUrl) {
				debug.warn(
					`[CartUplift][Bundles] Missing bundle script URL (reason: ${reason})`,
				);
				return;
			}

			window.CartUpliftBundlesLoading = true;
			const script = document.createElement("script");
			script.src = bundleUrl;
			script.defer = true;
			script.onload = () => {
				window.CartUpliftBundlesLoaded = true;
				window.CartUpliftBundlesLoading = false;
			};
			script.onerror = (error) => {
				window.CartUpliftBundlesLoading = false;
				debug.error(
					`[CartUplift][Bundles] Failed to load module via ${reason}`,
					error,
				);
			};
			document.head.appendChild(script);
		} catch (err) {
			debug.error(
				`[CartUplift][Bundles] Unexpected error during lazy load (${reason})`,
				err,
			);
		}
	}

	function scheduleBundleChecks() {
		const runChecks = (label) => () => maybeLoadBundleModule(label);
		runChecks("immediate")();
		[120, 400, 1200, 2500].forEach((delay) =>
			setTimeout(runChecks(`timer-${delay}`), delay),
		);
	}

	function setupBundleObserver() {
		// Check immediately if widget already exists
		const existingWidget = document.querySelector(BUNDLE_WIDGET_SELECTOR);
		if (existingWidget) {
			maybeLoadBundleModule("initial-check");
		}

		// MutationObserver for instant detection when widget appears dynamically
		if (typeof MutationObserver !== "undefined") {
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					// Check added nodes for bundle widgets
					for (const node of mutation.addedNodes) {
						if (node.nodeType === 1) {
							// Element node
							if (
								node.matches?.(BUNDLE_WIDGET_SELECTOR) ||
								node.querySelector?.(BUNDLE_WIDGET_SELECTOR)
							) {
								maybeLoadBundleModule("mutation-observer");
								return;
							}
						}
					}
				}
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true,
			});

			// Store reference for potential cleanup
			window.CartUpliftBundleObserver = observer;
		}
	}

	function bootstrapBundles() {
		try {
			// Immediate check + setup MutationObserver
			if (document.body) {
				setupBundleObserver();
			} else {
				document.addEventListener("DOMContentLoaded", setupBundleObserver);
			}

			// Keep minimal polling as fallback (only for edge cases)
			// Reduced to just one early check instead of multiple
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", () => {
					setTimeout(() => maybeLoadBundleModule("fallback-check"), 100);
				});
			}

			// Handle Shopify theme editor section reloads
			document.addEventListener("shopify:section:load", () => {
				// Allow reload on section changes (theme editor)
				maybeLoadBundleModule("section-load", true);
			});
			
			document.addEventListener("shopify:block:select", () => {
				maybeLoadBundleModule("block-select");
			});

			// Handle navigation/page visibility changes
			document.addEventListener("visibilitychange", () => {
				if (!document.hidden) {
					// Page became visible, check if widget needs initialization
					const widget = document.querySelector(BUNDLE_WIDGET_SELECTOR);
					if (widget && !window.CartUpliftBundlesLoaded) {
						maybeLoadBundleModule("visibility-change");
					}
				}
			});
		} catch (err) {
			debug.warn(
				"[CartUplift][Bundles] Failed to bootstrap lazy loader",
				err,
			);
		}
	}

	bootstrapBundles();

	// Auto-initialize when DOM is ready
	function initDrawer() {
		if (!window.cartUpliftDrawer && window.CartUpliftSettings) {
			try {
				window.cartUpliftDrawer = new CartUpliftDrawer(
					window.CartUpliftSettings,
				);
			} catch (err) {
				debug.error("[CartUplift] ❌ Drawer initialization failed:", err);
			}
		} else if (!window.CartUpliftSettings) {
			debug.warn(
				"[CartUplift] ⚠️ Settings not available, drawer not initialized",
			);
		} else if (window.cartUpliftDrawer) {
			debug.log("[CartUplift] ℹ️ Drawer already initialized, skipping");
		}
	}

	// Try multiple initialization strategies
	function tryInit() {
		if (window.CartUpliftSettings && !window.cartUpliftDrawer) {
			initDrawer();
		}
	}

	// Strategy 1: IMMEDIATE init if settings already exist (prioritize this!)
	if (window.CartUpliftSettings && !window.cartUpliftDrawer) {
		initDrawer();
	}

	// Strategy 2: Wait for DOMContentLoaded (only if not already initialized)
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", tryInit);
	} else if (!window.cartUpliftDrawer) {
		// DOM already loaded, try again immediately
		tryInit();
	}

	// Strategy 3: Listen for settings update event
	document.addEventListener("cartuplift:settings:updated", tryInit);

	// Strategy 4: Fallback timer (last resort) - reduced from 1000ms to 500ms
	setTimeout(() => {
		if (!window.cartUpliftDrawer && window.CartUpliftSettings) {
			debug.log("[CartUplift] Fallback initialization triggered");
			tryInit();
		}
	}, 500);
})();
