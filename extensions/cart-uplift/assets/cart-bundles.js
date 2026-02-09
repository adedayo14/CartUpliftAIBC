(function() {
  'use strict';

  // ========================================
  // VERSION & INITIALIZATION
  // ========================================
  const BUNDLE_VERSION = 'v1.2.0';
  const timestamp = new Date().toISOString();

  if (typeof window !== 'undefined') {
    if (!window.CART_UPLIFT_BUNDLE_VERSION || window.CART_UPLIFT_BUNDLE_VERSION !== BUNDLE_VERSION) {
      window.CART_UPLIFT_BUNDLE_VERSION = BUNDLE_VERSION;
      console.log('[CartUplift Bundles]', BUNDLE_VERSION, 'loaded at', timestamp);
    }

    if (window.CartUpliftBundlesInitialized) {
      return;
    }
    window.CartUpliftBundlesInitialized = true;
    window.CartUpliftBundlesLoaded = true;
  }

  // ========================================
  // CONSTANTS
  // ========================================

  /**
   * Currency minor unit fallback map
   * Maps currency codes to their decimal places
   * Source: ISO 4217 standard
   */
  const CURRENCY_MINOR_UNITS = {
    // Zero decimal currencies
    JPY: 0, KRW: 0, VND: 0,
    CLP: 0, XOF: 0, XAF: 0, KMF: 0, PYG: 0,
    BIF: 0, RWF: 0, GNF: 0, UGX: 0, VUV: 0,
    HUF: 0, IQD: 0,
    // Three decimal currencies
    BHD: 3, JOD: 3, KWD: 3, OMR: 3, TND: 3,
    // Default (two decimals) is handled in detectMinorUnits
  };

  const DEFAULT_CURRENCY = 'USD';
  const DEFAULT_MINOR_UNITS = 2;
  const SESSION_STORAGE_KEY = 'cart_session_id';
  function ensureSessionId() {
    try {
      if (typeof sessionStorage === 'undefined') {
        return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
      let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!sessionId) {
        sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      }
      return sessionId;
    } catch (err) {
      return `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
  }

  // Debug flag - can be enabled in localStorage
  const DEBUG = typeof window !== 'undefined' && window.localStorage?.getItem('CART_UPLIFT_DEBUG') === 'true';

  // Debug logger wrapper
  const debug = {
    log: (...args) => DEBUG && console.log('[CartUplift Bundles]', ...args),
    info: (...args) => DEBUG && console.info('[CartUplift Bundles]', ...args),
    warn: (...args) => console.warn('[CartUplift Bundles]', ...args),
    error: (...args) => console.error('[CartUplift Bundles]', ...args),
  };

  // ========================================
  // CURRENCY UTILITIES
  // ========================================

  /**
   * Detect currency minor units (decimal places) using Intl API
   * Falls back to hardcoded map for unsupported currencies
   *
   * @param {string} code - ISO 4217 currency code
   * @returns {number} Number of decimal places (0-3)
   */
  function detectMinorUnits(code) {
    try {
      const test = new Intl.NumberFormat('en', { style: 'currency', currency: code });
      const opts = test.resolvedOptions();
      if (typeof opts.minimumFractionDigits === 'number') {
        return opts.minimumFractionDigits;
      }
    } catch (e) {
      // Intl API not available or currency not supported
    }
    return CURRENCY_MINOR_UNITS[code] !== undefined ? CURRENCY_MINOR_UNITS[code] : DEFAULT_MINOR_UNITS;
  }

  /**
   * Get active store currency code
   * Priority: Shopify.currency.active > fallback to USD
   *
   * @returns {string} Currency code
   */
  function getStoreCurrency() {
    return (typeof window !== 'undefined' &&
      window.Shopify &&
      window.Shopify.currency &&
      window.Shopify.currency.active) || DEFAULT_CURRENCY;
  }

  /**
   * Format price using Shopify's formatMoney or Intl API
   *
   * @param {number} amount - Price in cents
   * @param {string} currencyCode - ISO 4217 currency code
   * @param {number} minorUnits - Number of decimal places
   * @returns {string} Formatted price string
   */
  function formatPrice(amount, currencyCode, minorUnits) {
    const validCents = typeof amount === 'number' && !isNaN(amount) && isFinite(amount) ? Math.round(amount) : 0;

    // Prefer Shopify.formatMoney when available - this respects store currency settings
    try {
      if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
        const format = window.Shopify.money_format || window.Shopify.currency?.format;
        if (format) {
          let formatted = window.Shopify.formatMoney(validCents, format);
          // Remove .00 if whole number
          if (validCents % 100 === 0) {
            formatted = formatted.replace(/\.00$/, '').replace(/,00$/, '');
          }
          return formatted;
        }
        let formatted = window.Shopify.formatMoney(validCents);
        // Remove .00 if whole number
        if (validCents % 100 === 0) {
          formatted = formatted.replace(/\.00$/, '').replace(/,00$/, '');
        }
        return formatted;
      }
    } catch (shopifyFormatError) {
      // Shopify formatMoney failed, fall through to Intl
    }

    // Fallback to Intl formatting
    try {
      const locale = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) ||
        (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode || DEFAULT_CURRENCY,
        minimumFractionDigits: minorUnits,
        maximumFractionDigits: minorUnits,
      });
      const divisor = Math.pow(10, minorUnits);
      return formatter.format((validCents || 0) / divisor);
    } catch (e) {
      // Final fallback: symbol-less formatting
      const divisor = Math.pow(10, minorUnits);
      const value = ((validCents || 0) / divisor).toFixed(minorUnits);
      const parts = value.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }
  }

  // ============================================
  // BUNDLE MANAGER - Main Controller
  // ============================================

  /**
   * BundleManager - Manages bundle widgets on product pages
   * Fetches bundles from API and renders them in designated widget containers
   */
  class BundleManager {
    constructor() {
      this.bundles = [];
      this.currency = getStoreCurrency();
      this.currentProductId = null;
      this.init();
    }

    async init() {
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve);
        });
      }

      const widgets = document.querySelectorAll('[data-bundle-widget]');
      
      if (widgets.length === 0) {
        return;
      }

      const firstWidget = widgets[0];
      this.currentProductId = firstWidget.dataset.productId;

      if (!this.currentProductId) {
        widgets.forEach(w => w.style.display = 'none');
        return;
      }

      await this.loadBundles();

      widgets.forEach((widget, index) => {
        if (this.bundles.length > 0) {
          this.renderBundlesInWidget(widget, index);
        } else {
          widget.style.display = 'none';
        }
      });

    }

    async loadBundles() {
      try {
        const timestamp = Date.now();
        const apiUrl = `/apps/cart-uplift/api/bundles?product_id=${this.currentProductId}&_t=${timestamp}`;
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          }
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      
      if (data.success && data.bundles) {
          this.bundles = data.bundles;
          // Prefer API-provided currency, else keep detected Shopify currency
          this.currency = data.currency || this.currency || 'USD';
        }
      } catch (error) {
        console.error('Error loading bundles:', error);
      }
    }

    renderBundlesInWidget(widget, widgetIndex) {
      const title = widget.dataset.bundleTitle;
      const subtitle = widget.dataset.bundleSubtitle;
      const headingAlign = widget.dataset.headingAlign || 'left';
      const widgetPriority = parseInt(widget.dataset.bundlePriority) || 5;
      
      widget._bundleTitle = title;
      widget._bundleSubtitle = subtitle;
      widget._headingAlign = headingAlign;

      const sortedBundles = [...this.bundles].sort((a, b) => {
        const priorityA = a.priority || widgetPriority || 5;
        const priorityB = b.priority || widgetPriority || 5;
        return priorityA - priorityB;
      });

      sortedBundles.forEach((bundleData, index) => {
        const bundleSource = bundleData.source || bundleData.type || 'manual';
        if (bundleData.hideIfNoML && (bundleSource !== 'ai' || !Array.isArray(bundleData.products) || bundleData.products.length === 0)) {
          return;
        }
        const bundle = new ProductBundle(widget, bundleData, index, this.currency);
        bundle.init();
      });
    }
  }

  // ============================================
  // PRODUCT BUNDLE - Individual Bundle Instance
  // ============================================

  /**
   * ProductBundle - Individual bundle instance
   * Handles rendering and interaction for a single bundle
   */
  class ProductBundle {
    constructor(containerElement, bundleData, index, currency = DEFAULT_CURRENCY) {
      this.containerElement = containerElement;
      this.config = bundleData;
      this.index = index;

      // Priority: Shopify store currency > API currency > fallback USD
      this.currencyCode = getStoreCurrency() ||
        (currency && String(currency).trim() && currency !== DEFAULT_CURRENCY ? String(currency).trim() : null) ||
        DEFAULT_CURRENCY;

      // Minor unit digits (e.g., JPY=0, USD=2, BHD=3)
      this.currencyMinorUnits = detectMinorUnits(this.currencyCode);
      this.element = null;
      this.selectedProducts = [];
      // Deduplicate products by variant ID to avoid showing same item multiple times
      const rawProducts = bundleData.products || [];
      const seenVariants = new Set();
      this.products = rawProducts.filter(product => {
        const variantId = product.variant_id || product.variantId || product.id;
        if (seenVariants.has(variantId)) {
          return false;
        }
        seenVariants.add(variantId);
        return true;
      });
      this.selectedQuantityTier = null;
      this.productQuantities = {};
      this.inlineStyleObservers = [];
      this.canDeselect = bundleData.allowDeselect !== false;
      this.minProducts = Number(bundleData.minProducts) || 0;
      this.minBundlePrice = Number(bundleData.minBundlePrice) || 0;
      this.bundleSource = bundleData.source || bundleData.type || 'manual';
      
      // Styling customization: Theme editor settings override API settings
      const themeBgColor = containerElement.dataset.bundleBgColor;
      const themeContentAlign = containerElement.dataset.contentAlignment;
      const themeSavingsColor = containerElement.dataset.savingsColor;
      const themeShowSavings = containerElement.dataset.showSavings;
      
      this.backgroundColor = themeBgColor || bundleData.backgroundColor || null;
      this.savingsColor = themeSavingsColor || bundleData.savingsColor || null;
      this.showSavingsBadge = themeShowSavings !== undefined ? (themeShowSavings === 'true' || themeShowSavings === true) : (bundleData.showSavingsBadge !== false);
    }

    init() {
      this.createElement();
      this.render();
      this.trackEvent('view');
    }

    formatVariantLabel(variant) {
      let label = (variant.title || '').trim();
      const isDefaultTitle = !label || /default title/i.test(label);

      if (isDefaultTitle) {
        if (Array.isArray(variant.selectedOptions) && variant.selectedOptions.length > 0) {
          if (variant.selectedOptions.length > 1) {
            label = variant.selectedOptions
              .map(o => {
                if (o && typeof o === 'object' && o.name && o.value) {
                  return `${o.name}: ${o.value}`;
                }
                return o?.value || o;
              })
              .filter(Boolean)
              .join(', ');
          } else {
            label = variant.selectedOptions.map(o => o?.value || o).filter(Boolean).join(' / ');
          }
        } else if (Array.isArray(variant.options) && variant.options.length > 0) {
          label = variant.options.join(' / ');
        } else if (variant.option1 || variant.option2 || variant.option3) {
          label = [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ');
        } else {
          label = 'Variant';
        }
      }

      return label;
    }

    registerInlineStyleGuard(element) {
      if (!element || typeof MutationObserver === 'undefined') {
        return;
      }

      if (element.dataset && element.dataset.gridNoInline === 'true') {
        element.removeAttribute('style');
        return;
      }

      const removeInlineStyle = () => {
        if (element.hasAttribute('style')) {
          element.removeAttribute('style');
        }
      };

      removeInlineStyle();

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'style') {
            removeInlineStyle();
          }
        }
      });

      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
      this.inlineStyleObservers.push(observer);

      if (element.dataset) {
        element.dataset.gridNoInline = 'true';
      }
    }

    createElement() {
      this.element = document.createElement('div');
      this.element.className = 'cartuplift-bundle';
      this.element.dataset.bundleId = this.config.id;
      
      // Apply background color
      if (this.backgroundColor) {
        this.element.style.backgroundColor = this.backgroundColor;
        this.element.style.padding = 'var(--cu-spacing-xxl)';
        this.element.style.borderRadius = 'var(--cu-radius-md)';
      }
      
      const bundleStyle = this.config.bundleStyle || 'grid';
      
      if (bundleStyle === 'clean' || bundleStyle === 'fbt') {
        this.element.classList.add('cartuplift-bundle-horizontal');
      }
      
      if (bundleStyle === 'tier') {
        this.element.classList.add('tier-bundle');
      }

      const widgetTitle = this.containerElement._bundleTitle;
      const widgetSubtitle = this.containerElement._bundleSubtitle;
      const headingAlign = this.containerElement._headingAlign || 'left';

      if (widgetTitle) {
        const heading = document.createElement('h2');
        heading.className = 'cartuplift-bundles-heading';
        heading.style.textAlign = headingAlign;
        heading.textContent = widgetTitle;
        this.element.appendChild(heading);
      }

      if (widgetSubtitle) {
        const subheading = document.createElement('p');
        subheading.className = 'cartuplift-bundles-subtitle';
        subheading.style.textAlign = headingAlign;
        subheading.textContent = widgetSubtitle;
        this.element.appendChild(subheading);
      }

      this.container = document.createElement('div');
      this.container.className = 'cartuplift-bundle-products';
      this.element.appendChild(this.container);

      this.footer = document.createElement('div');
      this.footer.className = 'cartuplift-bundle-footer';
      this.element.appendChild(this.footer);

      this.containerElement.appendChild(this.element);
    }

    render() {
      if (this.products.length === 0 && this.config.bundleStyle !== 'tier') {
        this.container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No products available.</p>';
        return;
      }

      const themeStyle = this.containerElement.dataset.displayStyle;
      const bundleStyle = themeStyle || this.config.bundleStyle || 'grid';

      switch (bundleStyle) {
        case 'clean':
        case 'fbt':
          this.renderCleanHorizontal();
          break;
        case 'grid':
          this.renderGridCheckboxes();
          break;
        case 'list':
          this.renderCompactList();
          break;
        case 'detailed':
        case 'carousel':
          this.renderGridCheckboxes();
          break;
        case 'tier':
          this.renderQuantityTier();
          break;
        default:
          this.renderGridCheckboxes();
      }

      if (bundleStyle !== 'clean' && bundleStyle !== 'fbt') {
        this.renderFooter();
      }
    }

    // ========================================
    // STYLE 1: CLEAN HORIZONTAL
    // ========================================
    renderCleanHorizontal() {
      const wrapper = document.createElement('div');
      wrapper.className = 'cartuplift-bundle-clean';

      this.renderDesktopHorizontalView(wrapper);
      this.renderMobileCollapsedView(wrapper);

      this.container.appendChild(wrapper);
    }

    renderDesktopHorizontalView(wrapper) {
      const productsWrapper = document.createElement('div');
      productsWrapper.className = 'bundle-products-wrapper';
      
      this.selectedProducts = this.products.map((p, i) => ({ ...p, index: i, quantity: 1 }));

      this.products.forEach((product, index) => {
        const item = document.createElement('div');
        item.className = 'cartuplift-clean-item';
        item.dataset.index = index;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.className = 'product-checkbox';
        if (!this.canToggleProduct(product)) {
          checkbox.disabled = true;
        }
        checkbox.addEventListener('change', (e) => {
          if (!this.canToggleProduct(product)) {
            e.target.checked = true;
            return;
          }
          if (e.target.checked) {
            if (!this.selectedProducts.find(p => p.index === index)) {
              this.selectedProducts.push({ ...product, index, quantity: 1 });
            }
          } else {
            this.selectedProducts = this.selectedProducts.filter(p => p.index !== index);
          }
          this.updateHorizontalSummary();
        });
        item.appendChild(checkbox);

        if (product.image) {
          const imageLink = document.createElement('a');
          imageLink.href = product.handle ? `/products/${product.handle}` : `/products/${product.id}`;
          imageLink.target = '_blank';
          imageLink.rel = 'noopener noreferrer';
          
          const img = document.createElement('img');
          img.src = product.image;
          img.alt = product.title;
          img.loading = 'lazy';
          imageLink.appendChild(img);
          item.appendChild(imageLink);
        }

        const title = document.createElement('h4');
        const titleLink = document.createElement('a');
        titleLink.href = product.handle ? `/products/${product.handle}` : `/products/${product.id}`;
        titleLink.target = '_blank';
        
        if (index === 0) {
          titleLink.innerHTML = '<strong>This item:</strong> ' + product.title;
        } else {
          titleLink.textContent = product.title;
        }
        title.appendChild(titleLink);
        item.appendChild(title);

        const ratingValue = product.rating || product.stars || product.review_rating || null;
        const reviewCount = product.reviewCount || product.reviews || product.reviews_count || product.review_count || product.total_reviews || null;
        
        if (ratingValue || reviewCount) {
          if (ratingValue) {
            const stars = document.createElement('div');
            stars.className = 'clean-stars';
            const rating = isNaN(Number(ratingValue)) ? 5 : Number(ratingValue);
            stars.textContent = '★'.repeat(Math.max(0, Math.min(5, Math.floor(rating))));
            item.appendChild(stars);
          }

          if (reviewCount) {
            const reviews = document.createElement('div');
            reviews.className = 'clean-reviews';
            reviews.textContent = `(${reviewCount} Reviews)`;
            item.appendChild(reviews);
          }
        }

        const price = this.createPriceElement(product);
        item.appendChild(price);

        if (Array.isArray(product.variants) && product.variants.length > 0) {
          let activeVariantId = this.getActiveVariantId(product);
          const activeVariant = product.variants.find((v) => String(v?.id) === String(activeVariantId)) || product.variants[0];
          
          if (activeVariant) {
            activeVariantId = activeVariant.id;
            product.variant_id = activeVariant.id;
          }

          let showVariantSelect = product.variants.length > 1;
          if (!showVariantSelect && product.variants.length === 1) {
            const v = product.variants[0];
            const hasTitle = v.title && v.title.toLowerCase() !== 'default title';
            const hasRealOptions = Array.isArray(v.selectedOptions) && 
                                    v.selectedOptions.length > 0 && 
                                    v.selectedOptions.some(opt => 
                                      opt && opt.name && opt.name.toLowerCase() !== 'title' && 
                                      opt.value && opt.value.toLowerCase() !== 'default title'
                                    );
            
            if (hasTitle && hasRealOptions) {
              showVariantSelect = true;
            }
          }

          if (showVariantSelect) {
            const variantSelect = document.createElement('select');
            variantSelect.className = 'clean-variant-selector';

            product.variants.forEach((variant) => {
              if (!variant || !variant.id) return;

              const option = document.createElement('option');
              option.value = String(variant.id);
              option.textContent = this.formatVariantLabel(variant);

              if (String(activeVariantId) === String(variant.id)) {
                option.selected = true;
              }

              variantSelect.appendChild(option);
            });

            variantSelect.addEventListener('change', (event) => {
              const selectedVariantId = event.target.value;
              this.handleVariantChange(product, index, selectedVariantId, price);
              const selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
              if (selectedVariant) {
                this.updatePriceElement(price, selectedVariant);
              }
              this.updateHorizontalSummary();
            });

            item.appendChild(variantSelect);
          }
        }

        item.addEventListener('click', (e) => {
          if (e.target !== checkbox && e.target.tagName !== 'A') {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
          }
        });

        productsWrapper.appendChild(item);

        if (index < this.products.length - 1) {
          const plus = document.createElement('span');
          plus.className = 'cartuplift-bundle-plus';
          plus.textContent = '+';
          productsWrapper.appendChild(plus);
        }
      });

      // Summary section with discount display
      const summary = document.createElement('div');
      summary.className = 'bundle-summary';

      const priceContainer = document.createElement('div');
      priceContainer.className = 'bundle-total';

      const priceLabel = document.createElement('p');
      priceLabel.className = 'total-label';
      priceLabel.textContent = 'Total price:';
      priceContainer.appendChild(priceLabel);

      this.totalPriceElement = document.createElement('p');
      this.totalPriceElement.className = 'bundle-total-price';
      this.updateHorizontalTotal();
      priceContainer.appendChild(this.totalPriceElement);

      summary.appendChild(priceContainer);

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'bundle-button-container';

      this.addButton = document.createElement('button');
      this.addButton.className = 'add-bundle-btn';
      this.updateHorizontalButtonText();
      this.addButton.addEventListener('click', () => {
        this.trackEvent('click'); // Track bundle click
        this.addBundleToCart();
      });
      buttonContainer.appendChild(this.addButton);

      summary.appendChild(buttonContainer);
      
      wrapper.appendChild(productsWrapper);
      wrapper.appendChild(summary);
    }

    renderMobileCollapsedView(wrapper) {
      this.selectedProducts = this.products.map((p, i) => ({ ...p, index: i, quantity: 1 }));

      const collapsedView = document.createElement('div');
      collapsedView.className = 'bundle-mobile-collapsed';

      const imagesRow = document.createElement('div');
      imagesRow.className = 'bundle-mobile-images';

      this.products.forEach((product, index) => {
        if (product.image) {
          const imageLink = document.createElement('a');
          imageLink.href = product.url || `/products/${product.handle || product.id}`;
          imageLink.target = '_blank';
          imageLink.rel = 'noopener noreferrer';
          
          const img = document.createElement('img');
          img.src = product.image;
          img.alt = product.title;
          img.loading = 'lazy';
          imageLink.appendChild(img);
          imagesRow.appendChild(imageLink);
        }

        if (index < this.products.length - 1) {
          const plus = document.createElement('span');
          plus.className = 'mobile-plus';
          plus.textContent = '+';
          imagesRow.appendChild(plus);
        }
      });

      collapsedView.appendChild(imagesRow);

      const pillButton = document.createElement('button');
      pillButton.className = 'bundle-mobile-pill';
      
      const { originalPrice, discountedPrice, savings } = this.calculatePrices();
      const count = this.selectedProducts.length;
      
      // Clean single-line layout
      if (savings > 0) {
        pillButton.innerHTML = `
          <span class="pill-content">
            <span class="pill-label">Buy all ${count}:</span>
            <span class="pill-prices">
              <span class="pill-price-sale">${this.formatPrice(discountedPrice)}</span>
              <span class="pill-price-original">${this.formatPrice(originalPrice)}</span>
            </span>
          </span>
          <span class="pill-arrow">›</span>
        `;
      } else {
        pillButton.innerHTML = `
          <span class="pill-content">
            <span class="pill-label">Buy all ${count}:</span>
            <span class="pill-price-sale">${this.formatPrice(discountedPrice)}</span>
          </span>
          <span class="pill-arrow">›</span>
        `;
      }
      
      pillButton.addEventListener('click', () => this.openMobileModal());
      collapsedView.appendChild(pillButton);

      wrapper.appendChild(collapsedView);

      this.createMobileModal();
    }

    createMobileModal() {
      this.modalOverlay = document.createElement('div');
      this.modalOverlay.className = 'bundle-modal-overlay';
      this.modalOverlay.addEventListener('click', () => this.closeMobileModal());

      this.modal = document.createElement('div');
      this.modal.className = 'bundle-modal';
      this.modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'bundle-modal-header';
      
      const title = document.createElement('h3');
      title.textContent = 'Frequently bought together';
      header.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'bundle-modal-close';
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', () => this.closeMobileModal());
      header.appendChild(closeBtn);

      this.modal.appendChild(header);

      const body = document.createElement('div');
      body.className = 'bundle-modal-body';

      this.products.forEach((product, index) => {
        const item = document.createElement('div');
        item.className = 'bundle-modal-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.className = 'modal-checkbox';
        checkbox.dataset.index = index;
        if (!this.canToggleProduct(product)) {
          checkbox.disabled = true;
        }
        checkbox.addEventListener('change', (e) => {
          if (!this.canToggleProduct(product)) {
            e.target.checked = true;
            return;
          }
          if (e.target.checked) {
            if (!this.selectedProducts.find(p => p.index === index)) {
              this.selectedProducts.push({ ...product, index, quantity: 1 });
            }
          } else {
            this.selectedProducts = this.selectedProducts.filter(p => p.index !== index);
          }
          this.updateModalTotal();
        });
        item.appendChild(checkbox);

        if (product.image) {
          const img = document.createElement('img');
          img.src = product.image;
          img.alt = product.title;
          item.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'modal-item-info';

        const productTitle = document.createElement('p');
        productTitle.className = 'modal-item-title';
        if (index === 0) {
          productTitle.innerHTML = '<strong>This item:</strong> ' + product.title;
        } else {
          productTitle.textContent = product.title;
        }
        info.appendChild(productTitle);

        const price = document.createElement('p');
        price.className = 'modal-item-price';
        price.textContent = this.formatPrice(product.price);
        info.appendChild(price);

        if (product.variants && product.variants.length > 0) {
          const activeVariantId = this.selectedProducts.find(p => p.index === index)?.variantId || 
                                  product.variants[0]?.id || 
                                  product.variantId;

          let showVariantSelect = product.variants.length > 1;
          if (!showVariantSelect && product.variants.length === 1) {
            const v = product.variants[0];
            const hasRealOptions = Array.isArray(v.selectedOptions) && 
                                    v.selectedOptions.length > 0 && 
                                    v.selectedOptions.some(opt => 
                                      opt && opt.value && 
                                      !/default/i.test(opt.value)
                                    );
            if (hasRealOptions) {
              showVariantSelect = true;
            }
          }

          if (showVariantSelect) {
            const variantSelect = document.createElement('select');
            variantSelect.className = 'modal-variant-selector';

            product.variants.forEach((variant) => {
              if (!variant || !variant.id) return;

              const option = document.createElement('option');
              option.value = String(variant.id);
              option.textContent = this.formatVariantLabel(variant);

              if (String(activeVariantId) === String(variant.id)) {
                option.selected = true;
              }

              variantSelect.appendChild(option);
            });

            variantSelect.addEventListener('change', (event) => {
              const selectedVariantId = event.target.value;
              const selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
              
              const selectedProduct = this.selectedProducts.find(p => p.index === index);
              if (selectedProduct && selectedVariant) {
                selectedProduct.variantId = selectedVariant.id;
                selectedProduct.price = selectedVariant.price;
                
                price.textContent = this.formatPrice(selectedVariant.price);
                this.updateModalTotal();
              }
            });

            info.appendChild(variantSelect);
          }
        }

        item.appendChild(info);
        body.appendChild(item);
      });

      this.modal.appendChild(body);

      const footer = document.createElement('div');
      footer.className = 'bundle-modal-footer';

      this.modalTotalElement = document.createElement('p');
      this.modalTotalElement.className = 'modal-total';
      this.updateModalTotal();
      footer.appendChild(this.modalTotalElement);

      this.modalAddButton = document.createElement('button');
      this.modalAddButton.className = 'modal-add-button';
      this.updateModalButtonText();
      this.modalAddButton.addEventListener('click', () => {
        this.closeMobileModal();
        this.addBundleToCart();
      });
      footer.appendChild(this.modalAddButton);

      if (this.config.displayInfo) {
        const info = document.createElement('p');
        info.className = 'modal-info';
        info.innerHTML = `<span class="info-icon">ⓘ</span> ${this.config.displayInfo}`;
        footer.appendChild(info);
      }

      this.modal.appendChild(footer);

      document.body.appendChild(this.modalOverlay);
      document.body.appendChild(this.modal);
    }

    openMobileModal() {
      this.modalOverlay.classList.add('active');
      this.modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    closeMobileModal() {
      this.modalOverlay.classList.remove('active');
      this.modal.classList.remove('active');
      document.body.style.overflow = '';
    }

    updateModalTotal() {
      if (this.modalTotalElement) {
        const { originalPrice, discountedPrice, savings } = this.calculatePrices();
        
        // Show sale price if there's a discount
        if (savings > 0) {
          this.modalTotalElement.innerHTML = `
            Total price: 
            <span class="modal-price-sale">${this.formatPrice(discountedPrice)}</span> 
            <span class="modal-price-original">${this.formatPrice(originalPrice)}</span>
          `;
        } else {
          this.modalTotalElement.textContent = `Total price: ${this.formatPrice(discountedPrice)}`;
        }
      }
      this.updateModalButtonText();
    }

    updateModalButtonText() {
      if (this.modalAddButton) {
        const count = this.selectedProducts.length;
        if (count === 0) {
          this.modalAddButton.textContent = 'Select products';
          this.modalAddButton.disabled = true;
        } else {
          this.modalAddButton.textContent = `Add all ${count} to cart`;
          this.modalAddButton.disabled = false;
        }
      }
    }

    calculateTotal() {
      return this.selectedProducts.reduce((sum, p) => sum + (p.price * (p.quantity || 1)), 0);
    }

    updateHorizontalSummary() {
      this.updateHorizontalTotal();
      this.updateHorizontalButtonText();
    }

    updateHorizontalTotal() {
      if (this.totalPriceElement) {
        const { originalPrice, discountedPrice, savings } = this.calculatePrices();
        
        this.totalPriceElement.innerHTML = '';
        
        if (savings > 0) {
          // Show discount with original price
          const priceWrapper = document.createElement('div');
          priceWrapper.className = 'price-with-discount';
          
          const discountPrice = document.createElement('span');
          discountPrice.className = 'discounted-price';
          discountPrice.textContent = this.formatPrice(discountedPrice);
          priceWrapper.appendChild(discountPrice);
          
          const originalPriceEl = document.createElement('span');
          originalPriceEl.className = 'original-price';
          originalPriceEl.textContent = this.formatPrice(originalPrice);
          priceWrapper.appendChild(originalPriceEl);
          
          this.totalPriceElement.appendChild(priceWrapper);
          
          // Add savings badge (conditional)
          if (this.showSavingsBadge) {
            const savingsBadge = document.createElement('span');
            savingsBadge.className = 'savings-badge';
            savingsBadge.textContent = `Save ${this.formatPrice(savings)}`;
            if (this.savingsColor) {
              savingsBadge.style.backgroundColor = this.savingsColor;
              savingsBadge.style.color = this.getContrastColor(this.savingsColor);
            }
            this.totalPriceElement.appendChild(savingsBadge);
          }
        } else {
          // No discount, just show price
          this.totalPriceElement.textContent = this.formatPrice(discountedPrice);
        }
        
        // Hide/show price container based on selection
        const priceContainer = this.totalPriceElement.closest('.bundle-total');
        if (priceContainer) {
          if (this.selectedProducts.length === 0) {
            priceContainer.style.display = 'none';
          } else {
            priceContainer.style.display = 'flex';
          }
        }
      }
    }

    updateHorizontalButtonText() {
      if (this.addButton && this.addButton.parentElement) {
        const count = this.selectedProducts.length;
        
        const existingEmpty = this.addButton.parentElement.querySelector('.cartuplift-bundle-empty-state');
        if (existingEmpty) {
          existingEmpty.remove();
        }

        if (count === 0) {
          this.addButton.style.display = 'none';
          const emptyMessage = document.createElement('div');
          emptyMessage.className = 'cartuplift-bundle-empty-state';
          emptyMessage.textContent = 'Choose items to buy together.';
          this.addButton.parentElement.appendChild(emptyMessage);
        } else {
          this.addButton.style.display = 'block';
          this.addButton.disabled = false;
          
          if (count === 1) {
            this.addButton.textContent = 'Add 1 to Cart';
          } else {
            this.addButton.textContent = `Add all ${count} to Cart`;
          }
        }
      } else if (this.addButton) {
        const count = this.selectedProducts.length;
        if (count === 0) {
          this.addButton.textContent = 'Select products';
          this.addButton.disabled = true;
        } else if (count === 1) {
          this.addButton.textContent = 'Add 1 to Cart';
          this.addButton.disabled = false;
        } else {
          this.addButton.textContent = `Add all ${count} to Cart`;
          this.addButton.disabled = false;
        }
      }
    }

    // ========================================
    // STYLE 2: GRID WITH CHECKBOXES
    // ========================================
    renderGridCheckboxes() {
      this.element.classList.add('cartuplift-bundle-grid-style');
      const type = this.config.type || 'manual';
      const isChoosable = type === 'choose_x_from_y' || type === 'category';

      if (isChoosable) {
        const selectMinQty = this.config.selectMinQty || 2;
        const selectMaxQty = this.config.selectMaxQty || this.products.length;
        
        const prompt = document.createElement('p');
        prompt.className = 'cartuplift-bundle-prompt';
        prompt.textContent = `Pick ${selectMinQty} to ${selectMaxQty} products`;
        this.container.appendChild(prompt);
      }

      this.selectedProducts = this.products.map((p, i) => ({ ...p, index: i, quantity: 1 }));

      const mobileImageRow = document.createElement('div');
      mobileImageRow.className = 'cartuplift-mobile-image-row';
      this.products.forEach((product) => {
        if (product.image) {
          const img = document.createElement('img');
          img.src = product.image;
          img.alt = product.title;
          mobileImageRow.appendChild(img);
        }
      });
      // Ensure image row is a direct flex child of the bundle for ordering.
      const headingEl = this.element.querySelector('.cartuplift-bundles-heading');
      if (headingEl) {
        headingEl.insertAdjacentElement('afterend', mobileImageRow);
      } else {
        // Fallback: insert at top so it still receives correct order styling.
        this.element.insertBefore(mobileImageRow, this.element.firstChild);
      }

      const grid = document.createElement('div');
      grid.className = 'cartuplift-bundle-grid';

      this.products.forEach((product, index) => {
        const card = this.createGridCard(product, index);
        grid.appendChild(card);
      });

      this.container.appendChild(grid);
    }

    canToggleProduct(product) {
      if (!this.canDeselect) {
        return false;
      }
      if (product && (product.isAnchor || product.required === true || product.isRemovable === false)) {
        return false;
      }
      return true;
    }

    createGridCard(product, index) {
      const card = document.createElement('div');
      card.className = 'cartuplift-grid-item selected';
      
      card.dataset.hasVariants = 'pending';

      const label = document.createElement('label');
      label.className = 'grid-card';
      label.htmlFor = `product-${this.index}-${index}`;

      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'grid-image';
      if (product.image) {
        const imageLink = document.createElement('a');
        imageLink.href = product.url || `/products/${product.handle || product.id}`;
        imageLink.target = '_blank';
        imageLink.rel = 'noopener noreferrer';
        
        const img = document.createElement('img');
        img.src = product.image;
        img.alt = product.title;
        imageLink.appendChild(img);
        imageWrapper.appendChild(imageLink);
      }
      label.appendChild(imageWrapper);

      const checkboxContainer = document.createElement('div');
      checkboxContainer.className = 'grid-checkbox-container';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'grid-checkbox-input';
      checkbox.id = `product-${this.index}-${index}`;
      checkbox.checked = true;
      if (!this.canToggleProduct(product)) {
        checkbox.disabled = true;
      }
      checkboxContainer.appendChild(checkbox);

      const checkboxIndicator = document.createElement('span');
      checkboxIndicator.className = 'grid-checkbox-indicator';
      checkboxContainer.appendChild(checkboxIndicator);

      const headerRow = document.createElement('div');
      headerRow.className = 'grid-header-row';
      
      checkboxContainer.classList.add('checkbox-first');
      headerRow.appendChild(checkboxContainer);

      const content = document.createElement('div');
      content.className = 'grid-content';

      let activeVariantId = null;
      if (Array.isArray(product.variants) && product.variants.length > 0) {
        activeVariantId = this.getActiveVariantId(product);
        const activeVariant = product.variants.find((variant) => String(variant?.id) === String(activeVariantId)) || product.variants[0];

        if (activeVariant) {
          activeVariantId = activeVariant.id;
          product.variant_id = activeVariant.id;
          product.variantId = activeVariant.id;
          product.variant_title = activeVariant.title;

          const defaultPrice = this.normalizePrice(activeVariant.price);
          if (defaultPrice !== null) {
            product.price = defaultPrice;
          }

          const defaultCompareAt = this.normalizePrice(activeVariant.compare_at_price || activeVariant.compareAtPrice);
          if (defaultCompareAt !== null) {
            product.compare_at_price = defaultCompareAt;
          } else {
            delete product.compare_at_price;
          }

          if (Array.isArray(activeVariant.selectedOptions)) {
            product.options = activeVariant.selectedOptions.map((option) => ({
              name: option?.name,
              value: option?.value
            })).filter((option) => option && option.name && option.value);
          }
        }
      }

      const title = document.createElement('h4');
      title.className = 'grid-product-title';
      const titleLink = document.createElement('a');
      if (product.url) {
        titleLink.href = product.url;
      } else if (product.handle) {
        titleLink.href = `/products/${product.handle}`;
      } else if (product.id) {
        titleLink.href = `/products/${product.id}`;
      } else {
        titleLink.href = '#';
      }
      titleLink.target = '_blank';

      if (index === 0) {
        const prefix = document.createElement('span');
        prefix.className = 'grid-item-prefix';
        prefix.textContent = 'This item:';
        titleLink.appendChild(prefix);
        titleLink.appendChild(document.createTextNode(' ' + (product.title || '')));
      } else {
        titleLink.textContent = product.title || '';
      }

      title.appendChild(titleLink);
      this.registerInlineStyleGuard(title);
      this.registerInlineStyleGuard(titleLink);
      
      headerRow.appendChild(title);
      label.appendChild(headerRow);

      const ratingValue = product.rating || product.stars || product.review_rating || null;
      const reviewCount = product.reviewCount || product.reviews || product.reviews_count || product.review_count || product.total_reviews || null;
      if (ratingValue || reviewCount) {
        if (ratingValue) {
          const stars = document.createElement('div');
          stars.className = 'grid-stars';
          const rating = isNaN(Number(ratingValue)) ? 5 : Number(ratingValue);
          stars.textContent = '★'.repeat(Math.max(0, Math.min(5, Math.floor(rating))));
          content.appendChild(stars);
        }

        if (reviewCount) {
          const reviews = document.createElement('div');
          reviews.className = 'grid-reviews';
          reviews.textContent = `(${reviewCount} Reviews)`;
          content.appendChild(reviews);
        }
      }

      const price = this.createPriceElement(product);
  const variantContainer = document.createElement('div');
      variantContainer.className = 'grid-variant-selector';

      let variantSelect;
      let showVariantSelect = false;
      if (Array.isArray(product.variants) && product.variants.length > 1) {
        showVariantSelect = true;
      } else if (Array.isArray(product.variants) && product.variants.length === 1) {
        const v = product.variants[0];
        const hasTitle = v.title && v.title.toLowerCase() !== 'default title';
        const hasRealOptions = Array.isArray(v.selectedOptions) && 
                                v.selectedOptions.length > 0 && 
                                v.selectedOptions.some(opt => 
                                  opt && opt.name && opt.name.toLowerCase() !== 'title' && 
                                  opt.value && opt.value.toLowerCase() !== 'default title'
                                );
        
        if (hasTitle && hasRealOptions) {
          showVariantSelect = true;
        }
      }
      if (showVariantSelect) {
        variantSelect = document.createElement('select');
        
        card.dataset.hasVariants = 'true';

        product.variants.forEach((variant) => {
          if (!variant || !variant.id) return;

          const option = document.createElement('option');
          option.value = String(variant.id);

          let label = (variant.title || '').trim();
          const isDefaultTitle = !label || /default title/i.test(label);

          if (isDefaultTitle) {
            if (Array.isArray(variant.selectedOptions) && variant.selectedOptions.length > 0) {
              label = variant.selectedOptions.map(o => o?.value || o).filter(Boolean).join(' / ');
            } else if (Array.isArray(variant.options) && variant.options.length > 0) {
              label = variant.options.join(' / ');
            } else if (variant.option1 || variant.option2 || variant.option3) {
              label = [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ');
            } else {
              label = 'Variant';
            }
          }

          option.textContent = label;

          if (String(activeVariantId) === String(variant.id)) {
            option.selected = true;
          }

          variantSelect.appendChild(option);
        });

        variantSelect.addEventListener('change', (event) => {
          const selectedVariantId = event.target.value;
          this.handleVariantChange(product, index, selectedVariantId, price);
          const selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
          if (selectedVariant) {
            this.updatePriceElement(price, selectedVariant);
          }
        });
        
        variantContainer.appendChild(variantSelect);
      } else {
        variantContainer.classList.add('grid-variant-selector-empty');
        card.dataset.hasVariants = 'false';
      }

  // Move variant selector ABOVE price when it exists
  content.appendChild(variantContainer);
  content.appendChild(price);

      const selectedReference = this.selectedProducts.find((p) => p.index === index);
      if (selectedReference) {
        Object.assign(selectedReference, { ...product, index, quantity: selectedReference.quantity || 1 });
      }
      label.appendChild(content);

      checkbox.addEventListener('change', (e) => {
        if (!this.canToggleProduct(product)) {
          e.target.checked = true;
          return;
        }
        if (e.target.checked) {
          card.classList.add('selected');
          if (!this.selectedProducts.find(p => p.index === index)) {
            this.selectedProducts.push({ ...product, index, quantity: 1 });
            this.selectedProducts.sort((a, b) => a.index - b.index);
          }
        } else {
          card.classList.remove('selected');
          this.selectedProducts = this.selectedProducts.filter(p => p.index !== index);
        }
        this.renderFooter();
      });

      card.appendChild(label);

      return card;
    }

    // ========================================
    // STYLE 3: COMPACT LIST
    // ========================================
    renderCompactList() {
      const list = document.createElement('div');
      list.className = 'cartuplift-bundle-list';

      this.selectedProducts = this.products.map((p, i) => ({ ...p, index: i, quantity: 1 }));

      this.products.forEach((product, index) => {
        const item = document.createElement('div');
        item.className = 'cartuplift-list-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        if (!this.canToggleProduct(product)) {
          checkbox.disabled = true;
        }
        checkbox.addEventListener('change', (e) => {
          if (!this.canToggleProduct(product)) {
            e.target.checked = true;
            return;
          }
          if (e.target.checked) {
            this.selectedProducts.push({ ...product, index, quantity: 1 });
          } else {
            this.selectedProducts = this.selectedProducts.filter(p => p.index !== index);
          }
          this.renderFooter();
        });
        item.appendChild(checkbox);

        if (product.image) {
          const imageLink = document.createElement('a');
          imageLink.href = product.url || `/products/${product.handle || product.id}`;
          imageLink.target = '_blank';
          imageLink.rel = 'noopener noreferrer';
          
          const img = document.createElement('img');
          img.src = product.image;
          img.alt = product.title;
          imageLink.appendChild(img);
          item.appendChild(imageLink);
        }

        const content = document.createElement('div');
        content.className = 'list-content';

        const title = document.createElement('h4');
        title.textContent = product.title;
        content.appendChild(title);

        const ratingValue = product.rating || product.stars || product.review_rating || null;
        const reviewCount = product.reviewCount || product.reviews || product.reviews_count || product.review_count || product.total_reviews || null;
        
        if (ratingValue || reviewCount) {
          if (ratingValue) {
            const stars = document.createElement('div');
            stars.className = 'list-stars';
            const rating = isNaN(Number(ratingValue)) ? 5 : Number(ratingValue);
            stars.textContent = '★'.repeat(Math.max(0, Math.min(5, Math.floor(rating))));
            content.appendChild(stars);
          }

          if (reviewCount) {
            const reviews = document.createElement('div');
            reviews.className = 'list-reviews';
            reviews.textContent = `(${reviewCount} Reviews)`;
            content.appendChild(reviews);
          }
        }

  const price = this.createPriceElement(product);

  if (Array.isArray(product.variants) && product.variants.length > 0) {
          let activeVariantId = this.getActiveVariantId(product);
          const activeVariant = product.variants.find((v) => String(v?.id) === String(activeVariantId)) || product.variants[0];
          
          if (activeVariant) {
            activeVariantId = activeVariant.id;
            product.variant_id = activeVariant.id;
          }

          let showVariantSelect = product.variants.length > 1;
          if (!showVariantSelect && product.variants.length === 1) {
            const v = product.variants[0];
            const hasTitle = v.title && v.title.toLowerCase() !== 'default title';
            const hasRealOptions = Array.isArray(v.selectedOptions) && 
                                    v.selectedOptions.length > 0 && 
                                    v.selectedOptions.some(opt => 
                                      opt && opt.name && opt.name.toLowerCase() !== 'title' && 
                                      opt.value && opt.value.toLowerCase() !== 'default title'
                                    );
            
            if (hasTitle && hasRealOptions) {
              showVariantSelect = true;
            }
          }

          if (showVariantSelect) {
            const variantSelect = document.createElement('select');
            variantSelect.className = 'list-variant-selector';

            product.variants.forEach((variant) => {
              if (!variant || !variant.id) return;

              const option = document.createElement('option');
              option.value = String(variant.id);

              let label = (variant.title || '').trim();
              const isDefaultTitle = !label || /default title/i.test(label);

              if (isDefaultTitle) {
                if (Array.isArray(variant.selectedOptions) && variant.selectedOptions.length > 0) {
                  label = variant.selectedOptions.map(o => o?.value || o).filter(Boolean).join(' / ');
                } else if (Array.isArray(variant.options) && variant.options.length > 0) {
                  label = variant.options.join(' / ');
                } else if (variant.option1 || variant.option2 || variant.option3) {
                  label = [variant.option1, variant.option2, variant.option3].filter(Boolean).join(' / ');
                } else {
                  label = 'Variant';
                }
              }

              option.textContent = label;

              if (String(activeVariantId) === String(variant.id)) {
                option.selected = true;
              }

              variantSelect.appendChild(option);
            });

            variantSelect.addEventListener('change', (event) => {
              const selectedVariantId = event.target.value;
              this.handleVariantChange(product, index, selectedVariantId, price);
              const selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
              if (selectedVariant) {
                this.updatePriceElement(price, selectedVariant);
              }
            });

            content.appendChild(variantSelect);
          }
        }

        // Ensure price appears after options (variant selector) on both desktop and mobile
        content.appendChild(price);

        item.appendChild(content);
        list.appendChild(item);
      });

      this.container.appendChild(list);
    }

    // ========================================
    // STYLE 5: QUANTITY TIER
    // ========================================
    renderQuantityTier() {
      const tiers = this.config.quantityTiers || [];
      
      if (tiers.length === 0) {
        this.container.innerHTML = '<p style="color: #999; padding: 20px;">No tiers configured.</p>';
        return;
      }

      const tiersContainer = document.createElement('div');
      tiersContainer.className = 'cartuplift-bundle-tiers';

      tiers.forEach((tier, index) => {
        const tierCard = document.createElement('div');
        tierCard.className = 'cartuplift-tier-option';
        if (tier.popular) tierCard.classList.add('popular');

        if (tier.popular) {
          const badge = document.createElement('div');
          badge.className = 'cartuplift-tier-badge';
          badge.textContent = 'Most Popular';
          tierCard.appendChild(badge);
        }

        const leftSection = document.createElement('div');
        leftSection.className = 'cartuplift-tier-left';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `tier-${this.index}`;
        radio.className = 'cartuplift-tier-radio';
        radio.value = index;
        radio.addEventListener('change', () => {
          document.querySelectorAll('.cartuplift-tier-option').forEach(t => t.classList.remove('selected'));
          tierCard.classList.add('selected');
          this.selectedQuantityTier = tier;
          this.selectedProducts = this.products.map((p, i) => ({ ...p, index: i, quantity: tier.quantity }));
          this.renderFooter();
        });
        leftSection.appendChild(radio);

        if (this.products.length > 0) {
          const imagesContainer = document.createElement('div');
          imagesContainer.className = 'cartuplift-tier-images';
          this.products.slice(0, 3).forEach(product => {
            if (product.image) {
              const imageLink = document.createElement('a');
              imageLink.href = product.url || `/products/${product.handle || product.id}`;
              imageLink.target = '_blank';
              imageLink.rel = 'noopener noreferrer';
              
              const img = document.createElement('img');
              img.src = product.image;
              img.alt = product.title;
              imageLink.appendChild(img);
              imagesContainer.appendChild(imageLink);
            }
          });
          leftSection.appendChild(imagesContainer);
        }

        const info = document.createElement('div');
        info.className = 'cartuplift-tier-info';

        const title = document.createElement('h4');
        title.textContent = `Buy ${tier.quantity}`;
        
        if (tier.discountPercent > 0) {
          const badge = document.createElement('span');
          badge.className = 'cartuplift-tier-discount-badge';
          badge.textContent = `Save ${tier.discountPercent}%`;
          title.appendChild(badge);
        }
        info.appendChild(title);

        if (tier.description) {
          const desc = document.createElement('p');
          desc.className = 'cartuplift-tier-description';
          desc.textContent = tier.description;
          info.appendChild(desc);
        }

        leftSection.appendChild(info);
        tierCard.appendChild(leftSection);

        const rightSection = document.createElement('div');
        rightSection.className = 'cartuplift-tier-right';

        const price = document.createElement('p');
        price.className = 'cartuplift-tier-price';
        price.textContent = this.formatPrice(tier.discountedPrice);
        rightSection.appendChild(price);

        if (tier.originalPrice > tier.discountedPrice) {
          const originalPrice = document.createElement('p');
          originalPrice.className = 'cartuplift-tier-original-price';
          originalPrice.textContent = this.formatPrice(tier.originalPrice);
          rightSection.appendChild(originalPrice);
        }

        const unitPrice = document.createElement('p');
        unitPrice.className = 'cartuplift-tier-unit-price';
        unitPrice.textContent = `${this.formatPrice(tier.discountedPrice / tier.quantity)} each`;
        rightSection.appendChild(unitPrice);

        tierCard.appendChild(rightSection);

        tierCard.addEventListener('click', (e) => {
          if (e.target !== radio) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change'));
          }
        });

        tiersContainer.appendChild(tierCard);
      });

      this.container.appendChild(tiersContainer);
    }

    // ========================================
    // FOOTER (FOR NON-HORIZONTAL STYLES)
    // ========================================
    renderFooter() {
      this.footer.innerHTML = '';

      if (this.selectedProducts.length === 0 && this.config.bundleStyle !== 'tier') {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'cartuplift-bundle-empty-state';
        emptyMessage.textContent = 'Choose items to buy together.';
        emptyMessage.style.cssText = 'text-align: center; padding: 16px; color: #666; font-size: 14px; font-style: italic;';
        this.footer.appendChild(emptyMessage);
        return;
      }

      const { originalPrice, discountedPrice, savings, savingsPercent } = this.calculatePrices();
      const failsMinProductRequirement = this.minProducts > 0 && this.selectedProducts.length < this.minProducts;
      const failsMinPriceRequirement = this.minBundlePrice > 0 && discountedPrice < this.minBundlePrice;

      const summary = document.createElement('div');
      summary.className = 'cartuplift-bundle-price-summary';

      if (this.minProducts > 0) {
        const quantityRequirement = document.createElement('div');
        quantityRequirement.className = 'cartuplift-bundle-requirement';
        quantityRequirement.textContent = `Requires at least ${this.minProducts} item${this.minProducts === 1 ? '' : 's'}`;
        summary.appendChild(quantityRequirement);
      }

      if (this.minBundlePrice > 0) {
        const priceRequirement = document.createElement('div');
        priceRequirement.className = 'cartuplift-bundle-requirement';
        priceRequirement.textContent = `Requires bundle total of ${this.formatPrice(this.minBundlePrice)}`;
        summary.appendChild(priceRequirement);
      }

      const priceInfo = document.createElement('div');
      priceInfo.className = 'cartuplift-price-info';

      if (savings > 0 && this.showSavingsBadge) {
        const savingsBadge = document.createElement('div');
        savingsBadge.className = 'cartuplift-bundle-savings';
        let savingsText = this.config.savingsBadgeText || 'Save {amount}!';
        savingsText = savingsText
          .replace('{amount}', this.formatPrice(savings))
          .replace('{percent}', `${savingsPercent}%`);
        savingsBadge.textContent = savingsText;
        if (this.savingsColor) {
          savingsBadge.style.backgroundColor = this.savingsColor;
          savingsBadge.style.color = this.getContrastColor(this.savingsColor);
        }
        priceInfo.appendChild(savingsBadge);
      }

      const priceDisplay = document.createElement('div');
      priceDisplay.className = 'cartuplift-price-display';

      const totalLabel = document.createElement('span');
      totalLabel.className = 'label';
      totalLabel.textContent = 'Total price:';
      priceDisplay.appendChild(totalLabel);

      const finalPrice = document.createElement('span');
      finalPrice.className = 'final-price';
      finalPrice.textContent = this.formatPrice(discountedPrice);
      priceDisplay.appendChild(finalPrice);

      if (savings > 0 && originalPrice > 0) {
        const originalPriceEl = document.createElement('span');
        originalPriceEl.className = 'original-price';
        originalPriceEl.textContent = this.formatPrice(originalPrice);
        priceDisplay.appendChild(originalPriceEl);
      }

      priceInfo.appendChild(priceDisplay);
      summary.appendChild(priceInfo);

      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'cartuplift-button-container';

      const button = document.createElement('button');
      button.className = 'cartuplift-bundle-add-button';
      button.textContent = this.config.buttonText || 'Add Bundle to Cart';
      
      const bundleStyle = this.config.bundleStyle || 'clean';
      const selectMinQty = this.config.selectMinQty || this.config.minProducts || 0;
      const selectMaxQty = this.config.selectMaxQty || this.config.maxProducts || this.products.length;
      
      let isValid = true;
      
      if (bundleStyle === 'tier') {
        isValid = this.selectedQuantityTier !== null;
        if (!isValid) {
          button.textContent = 'Select a quantity';
        }
      } else {
        const type = this.config.type || 'manual';
        const isChoosable = type === 'choose_x_from_y' || type === 'category';
        
        if (isChoosable) {
          isValid = this.selectedProducts.length >= selectMinQty && this.selectedProducts.length <= selectMaxQty;
          if (!isValid) {
            button.textContent = `Select ${selectMinQty}-${selectMaxQty} products`;
          }
        } else {
          isValid = this.selectedProducts.length > 0;
        }
      }
      
      if (failsMinProductRequirement) {
        isValid = false;
        button.textContent = `Pick ${this.minProducts}+ items`;
      }

      if (failsMinPriceRequirement) {
        isValid = false;
        button.textContent = `Add more products to reach ${this.formatPrice(this.minBundlePrice)}`;
      }

      button.disabled = !isValid;
      button.addEventListener('click', () => {
        this.trackEvent('click'); // Track bundle click
        this.addBundleToCart();
      });

      buttonContainer.appendChild(button);
      summary.appendChild(buttonContainer);
      this.footer.appendChild(summary);
    }

    // ========================================
    // HELPER METHODS
    // ========================================
    createPriceElement(product) {
      const priceEl = document.createElement('p');
      priceEl.className = 'price';
      priceEl.textContent = this.formatPrice(product.price);

      if (product.compare_at_price && product.compare_at_price > product.price) {
        const comparePrice = document.createElement('span');
        comparePrice.className = 'compare-price';
        comparePrice.textContent = this.formatPrice(product.compare_at_price);
        priceEl.appendChild(comparePrice);
      }

      return priceEl;
    }

    handleVariantChange(product, index, variantId, priceElement) {
      if (!Array.isArray(product.variants) || product.variants.length === 0) {
        return;
      }

      const selectedVariant = product.variants.find((variant) => String(variant?.id) === String(variantId));

      if (!selectedVariant) {
        return;
      }

      const priceInCents = this.normalizePrice(selectedVariant.price);
      const compareAtInCents = this.normalizePrice(selectedVariant.compare_at_price || selectedVariant.compareAtPrice);

      product.variant_id = selectedVariant.id;
      product.variantId = selectedVariant.id;
      product.variant_title = selectedVariant.title;
      if (priceInCents !== null) {
        product.price = priceInCents;
      }
      if (compareAtInCents !== null) {
        product.compare_at_price = compareAtInCents;
      } else {
        delete product.compare_at_price;
      }

      if (Array.isArray(selectedVariant.selectedOptions)) {
        product.options = selectedVariant.selectedOptions.map((option) => ({
          name: option?.name,
          value: option?.value
        })).filter((option) => option && option.name && option.value);
      }

      const selectedProduct = this.selectedProducts.find((p) => p.index === index);
      if (selectedProduct) {
        Object.assign(selectedProduct, { ...product, index, quantity: selectedProduct.quantity || 1 });
      }

      this.updatePriceElement(priceElement, product);
      this.renderFooter();
    }

    getActiveVariantId(product) {
      const explicitVariant = product.variant_id || product.variantId;
      if (explicitVariant) {
        return explicitVariant;
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        return product.variants[0].id;
      }

      return null;
    }

    normalizePrice(value) {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === 'number') {
        // If value looks like raw minor units already (integer and larger than 0), keep.
        if (Number.isInteger(value)) {
          return value;
        }
        // If it's a decimal in major units, convert using detected minor units.
        const factor = Math.pow(10, this.currencyMinorUnits);
        return Math.round(value * factor);
      }

      const raw = String(value).trim();
      const cleaned = raw.replace(/[^0-9.\-]/g, '');
      const hasDecimal = cleaned.includes('.');
      const numeric = parseFloat(cleaned);
      if (Number.isNaN(numeric)) {
        return null;
      }
      const factor = Math.pow(10, this.currencyMinorUnits);
      if (hasDecimal) {
        return Math.round(numeric * factor);
      }
      // For integer-like strings, assume: if already large enough, it's minor units; otherwise it's major units.
      return numeric >= factor ? Math.round(numeric) : Math.round(numeric * factor);
    }

    updatePriceElement(priceElement, product) {
      if (!priceElement) {
        return;
      }

      priceElement.innerHTML = '';
      priceElement.textContent = this.formatPrice(product.price);

      if (product.compare_at_price && product.compare_at_price > product.price) {
        const comparePrice = document.createElement('span');
        comparePrice.className = 'compare-price';
        comparePrice.textContent = this.formatPrice(product.compare_at_price);
        priceElement.appendChild(comparePrice);
      }
    }

    /**
     * Format price using the shared utility function
     * @param {number} amount - Price in cents
     * @returns {string} Formatted price string
     */
    formatPrice(amount) {
      return formatPrice(amount, this.currencyCode, this.currencyMinorUnits);
    }

    calculatePrices() {
      let originalPrice = 0;
      let discountedPrice = 0;

      const bundleStyle = this.config.bundleStyle || 'clean';
      const discountType = this.config.discountType || 'percentage';
      const discountValue = this.config.discountValue || 0;

      if (bundleStyle === 'tier' && this.selectedQuantityTier) {
        originalPrice = this.selectedQuantityTier.originalPrice;
        discountedPrice = this.selectedQuantityTier.discountedPrice;
      } else {
        this.selectedProducts.forEach(p => {
          const qty = p.quantity || 1;
          originalPrice += p.price * qty;
        });

        if (discountType === 'percentage') {
          discountedPrice = originalPrice * (1 - discountValue / 100);
        } else if (discountType === 'fixed') {
          discountedPrice = originalPrice - (discountValue * 100);
        } else {
          discountedPrice = originalPrice;
        }
      }

      const savings = Math.max(0, originalPrice - discountedPrice);
      const savingsPercent = originalPrice > 0 ? Math.round((savings / originalPrice) * 100) : 0;

      return {
        originalPrice,
        discountedPrice,
        savings,
        savingsPercent,
        discountApplied: savingsPercent > 0
      };
    }

    // Helper to determine contrast text color for custom background
    getContrastColor(hexColor) {
      if (!hexColor) return '#ffffff';
      
      // Remove # if present
      const hex = hexColor.replace('#', '');
      
      // Convert to RGB
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      
      // Calculate perceived brightness
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      
      // Return white for dark colors, black for light colors
      return brightness > 128 ? '#000000' : '#ffffff';
    }

    // ========================================
    // ADD TO CART
    // ========================================
    async addBundleToCart() {
      this.trackEvent('add_to_cart');

      // Store original button text and change to "Adding..."
      const originalButtonText = this.addButton ? this.addButton.textContent : '';
      const originalModalButtonText = this.modalAddButton ? this.modalAddButton.textContent : '';

      if (this.addButton) {
        this.addButton.textContent = 'Adding...';
        this.addButton.disabled = true;
      }
      if (this.modalAddButton) {
        this.modalAddButton.textContent = 'Adding...';
        this.modalAddButton.disabled = true;
      }


      if (this.minProducts > 0 && this.selectedProducts.length < this.minProducts) {
        alert(`Add at least ${this.minProducts} item${this.minProducts === 1 ? '' : 's'} from this bundle.`);
        return;
      }

      if (this.minBundlePrice > 0) {
        const { discountedPrice } = this.calculatePrices();
        if (discountedPrice < this.minBundlePrice) {
          alert(`Add more products to reach a bundle value of ${this.formatPrice(this.minBundlePrice)}.`);
          return;
        }
      }

      try {
        // First, fetch current cart to check for existing items
        const cartResponse = await fetch('/cart.js');
        const currentCart = cartResponse.ok ? await cartResponse.json() : { items: [] };

        // Build a map of variant_id -> existing cart line item
        const existingItemsMap = new Map();
        (currentCart.items || []).forEach(item => {
          const variantId = String(item.variant_id || item.id);
          existingItemsMap.set(variantId, item);
        });

        const items = [];
        const itemsToUpdate = []; // Track items that need quantity updates

        this.selectedProducts.forEach(product => {
          const qty = product.quantity || 1;

          let variantId = product.variant_id || product.variantId;
          if (!variantId && product.variants && product.variants[0]) {
            variantId = product.variants[0].id;
          } else if (!variantId) {
            variantId = product.id;
          }

          const numericVariantId = String(variantId).replace(/[^0-9]/g, '');
          const existingItem = existingItemsMap.get(numericVariantId);

          if (existingItem) {
            // Item already exists in cart - we'll update quantity and track sources
            const existingProps = existingItem.properties || {};

            // Parse existing source quantities
            let manualQty = parseInt(existingProps._source_manual_qty || 0);
            let recQty = parseInt(existingProps._source_rec_qty || 0);
            let bundleQty = parseInt(existingProps._source_bundle_qty || 0);

            // If no source tracking exists, assume it was manually added
            if (manualQty === 0 && recQty === 0 && bundleQty === 0) {
              manualQty = existingItem.quantity;
            }

            // Add bundle quantity
            bundleQty += qty;
            const newTotalQty = manualQty + recQty + bundleQty;

            // Track for update after removal
            itemsToUpdate.push({
              key: existingItem.key,
              variantId: numericVariantId,
              newQuantity: newTotalQty,
              properties: {
                '_bundle_id': this.config.id,
                '_bundle_name': this.config.name || this.config.displayTitle,
                '_source_manual_qty': manualQty > 0 ? String(manualQty) : undefined,
                '_source_rec_qty': recQty > 0 ? String(recQty) : undefined,
                '_source_bundle_qty': String(bundleQty)
              }
            });
          } else {
            // New item - add normally with bundle tracking
            items.push({
              id: numericVariantId,
              quantity: qty,
              properties: {
                '_bundle_id': this.config.id,
                '_bundle_name': this.config.name || this.config.displayTitle,
                '_source_bundle_qty': String(qty)
              }
            });
          }
        });

        // First, remove existing items that need updates (to avoid duplicate line items)
        for (const item of itemsToUpdate) {
          await fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: item.key,
              quantity: 0
            })
          });
        }

        // Then add all items (new ones + updated ones)
        const allItemsToAdd = [
          ...items,
          ...itemsToUpdate.map(item => ({
            id: item.variantId,
            quantity: item.newQuantity,
            properties: Object.fromEntries(
              Object.entries(item.properties).filter(([_, v]) => v !== undefined)
            )
          }))
        ];

        if (allItemsToAdd.length > 0) {
          const response = await fetch('/cart/add.js', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ items: allItemsToAdd })
          });

          if (response.ok) {
            const result = await response.json();
            this.refreshCart();
          } else {
            const errorData = await response.json().catch(() => ({ description: 'Unknown error' }));
            const errorMessage = errorData.description || errorData.message || 'Failed to add to cart';
            debug.error('Cart API error:', errorData);
            throw new Error(errorMessage);
          }
        }
      } catch (error) {
        debug.error('Failed to add bundle:', error);
        alert(`Failed to add bundle to cart: ${error.message}`);
      } finally {
        // Restore button text
        if (this.addButton) {
          this.addButton.textContent = originalButtonText;
          this.addButton.disabled = false;
        }
        if (this.modalAddButton) {
          this.modalAddButton.textContent = originalModalButtonText;
          this.modalAddButton.disabled = false;
        }
      }

    }

    async refreshCart() {
      
      // First, fetch the cart to get updated count
      try {
        const cartResponse = await fetch('/cart.js');
        if (cartResponse.ok) {
          const cartData = await cartResponse.json();
          
          // Update cart count in header if element exists
          const cartCountElements = document.querySelectorAll('.cart-count, [data-cart-count], .cart-count-bubble');
          cartCountElements.forEach(el => {
            el.textContent = cartData.item_count;
            if (el.classList.contains('hidden') && cartData.item_count > 0) {
              el.classList.remove('hidden');
            }
          });
        }
      } catch (err) {
      }
      
      // Try CartUplift drawer first
      if (window.cartUpliftDrawer && typeof window.cartUpliftDrawer.open === 'function') {
        try {
          if (typeof window.cartUpliftDrawer.fetchCart === 'function') {
            await window.cartUpliftDrawer.fetchCart();
          }
          if (typeof window.cartUpliftDrawer.updateDrawerContent === 'function') {
            await window.cartUpliftDrawer.updateDrawerContent();
          }
          window.cartUpliftDrawer.open();
          return;
        } catch (err) {
        }
      }

      // Try Dawn theme cart-drawer
      const themeCartDrawer = document.querySelector('cart-drawer');
      if (themeCartDrawer) {
        try {
          // Trigger Dawn's cart update
          if (typeof themeCartDrawer.getSectionsToRender === 'function') {
            themeCartDrawer.getSectionsToRender().forEach((section) => {
              fetch(`${window.location.pathname}?section_id=${section.id}`)
                .then((response) => response.text())
                .then((html) => {
                  const parser = new DOMParser();
                  const doc = parser.parseFromString(html, 'text/html');
                  const sectionElement = doc.querySelector(section.selector);
                  if (sectionElement) {
                    document.querySelector(section.selector).innerHTML = sectionElement.innerHTML;
                  }
                });
            });
          }
          
          if (typeof themeCartDrawer.open === 'function') {
            themeCartDrawer.open();
            return;
          }
        } catch (err) {
          debug.warn('Theme cart drawer failed:', err);
        }
      }

      // Try mini-cart
      const miniCart = document.querySelector('mini-cart, cart-notification, [data-mini-cart]');
      if (miniCart && typeof miniCart.open === 'function') {
        try {
          miniCart.open();
          return;
        } catch (err) {
        }
      }

      // Dispatch all cart events
      try {
        document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.body.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
        window.dispatchEvent(new CustomEvent('cart:refresh'));
        window.dispatchEvent(new CustomEvent('cart:updated'));
      } catch (err) {
      }

      // Try Shopify theme callbacks
      if (typeof Shopify !== 'undefined' && Shopify.theme) {
        try {
          if (typeof Shopify.theme.cartUpdateCallbacks !== 'undefined') {
            Shopify.theme.cartUpdateCallbacks.forEach(callback => callback());
          }
        } catch (err) {
        }
      }

      // Last resort: reload the page if nothing worked
      
    }

    trackEvent(eventType) {
      const sessionId = ensureSessionId();
      const payload = {
        shop: window.Shopify?.shop || window.location.hostname,
        bundleId: this.config.id,
        bundleName: this.config.name,
        bundleType: this.config.type || 'manual',
        bundleStyle: this.config.bundleStyle || 'clean',
        event: eventType,
        sessionId,
        products: this.selectedProducts.map(p => p.id),
        timestamp: Date.now()
      };

      this.sendBundleAnalytics(payload).catch(() => {
        this.sendTrackingFallback(eventType, sessionId);
      });
    }

    sendBundleAnalytics(data) {
      return fetch('/apps/cart-uplift/api/bundle-analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      }).then(response => {
        if (!response.ok) {
          throw new Error('Bundle analytics request failed');
        }
      });
    }

    sendTrackingFallback(eventType, sessionId) {
      const translatedEvent = eventType === 'view' ? 'impression' : eventType;
      const data = {
        event: translatedEvent,
        productId: this.config.id,
        productTitle: this.config.name,
        source: 'bundle',
        sessionId
      };

      return fetch('/apps/cart-uplift/api/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      }).catch(() => {});
    }
  }

  // ============================================
  // INITIALIZE
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.bundleManager = new BundleManager();
    });
  } else {
    window.bundleManager = new BundleManager();
  }

})();