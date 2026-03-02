import type { LoaderFunctionArgs } from "@remix-run/node";

const CACHE_CONTROL = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

const CART_UPLIFT_SCRIPT = String.raw`(function () {
  if (window.__cartUpliftRecsBooted) return;
  window.__cartUpliftRecsBooted = true;

  /* ─── Debug ─── */
  var DEBUG = (function () {
    try {
      var qp = new URL(window.location.href).searchParams;
      return qp.get("cu_debug") === "1" || window.localStorage.getItem("cu_debug") === "1";
    } catch (_err) {
      return false;
    }
  })();

  function log() {
    if (!DEBUG || !window.console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CartUplift]");
    console.log.apply(console, args);
  }

  function warn() {
    if (!window.console || !console.warn) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CartUplift]");
    console.warn.apply(console, args);
  }

  /* ─── Script / Store Detection ─── */
  function findScriptByPath(path) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      var src = scripts[i] && scripts[i].src ? scripts[i].src : "";
      if (src.indexOf(path) !== -1) return scripts[i];
    }
    return null;
  }

  function getScriptUrl(path) {
    var scriptEl = document.currentScript || findScriptByPath(path);
    var src = scriptEl && scriptEl.src ? scriptEl.src : window.location.origin + path;
    try {
      return new URL(src, window.location.href);
    } catch (_err) {
      return new URL(window.location.href);
    }
  }

  function readMeta(names) {
    for (var i = 0; i < names.length; i += 1) {
      var meta = document.querySelector('meta[name="' + names[i] + '"]');
      var content = meta && meta.getAttribute("content");
      if (content && /^[a-z0-9]{5,20}$/i.test(content)) return content;
    }
    return "";
  }

  function firstNumeric(value) {
    var raw = String(value || "").trim();
    if (/^\d+$/.test(raw)) return raw;
    var match = raw.match(/\b(\d{2,})\b/);
    return match ? match[1] : "";
  }

  function detectStoreHash(scriptUrl) {
    var fromSrc = scriptUrl.searchParams.get("store_hash") || scriptUrl.searchParams.get("shop");
    if (fromSrc && /^[a-z0-9]{5,20}$/i.test(fromSrc)) return fromSrc;

    var bcData = window.BCData || window.bcData || {};
    var fromGlobal =
      bcData.store_hash ||
      bcData.storeHash ||
      bcData.contextId ||
      (bcData.context && (bcData.context.store_hash || bcData.context.storeHash));
    if (fromGlobal && /^[a-z0-9]{5,20}$/i.test(String(fromGlobal))) return String(fromGlobal);

    var fromMeta = readMeta(["bc-store-hash", "store-hash", "bigcommerce-store-hash"]);
    if (fromMeta) return fromMeta;

    var match = (window.location.hostname || "").match(/^store-([a-z0-9]+)\.mybigcommerce\.com$/i);
    if (match && match[1]) return match[1];

    return "";
  }

  /* ─── Product Detection ─── */
  function detectProductIdFromGlobals() {
    var bcData = window.BCData || window.bcData || {};
    var candidates = [
      bcData.product_id, bcData.productId,
      bcData.product && (bcData.product.id || bcData.product.entityId || bcData.product.product_id),
      window.product_id, window.productId,
      window.__PRODUCT_ID__, window.__PRODUCT_ENTITY_ID__,
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var id = firstNumeric(candidates[i]);
      if (id) return id;
    }
    return "";
  }

  function detectProductIdFromDom() {
    var selectors = [
      'input[name="product_id"]', 'input[name="product-id"]',
      '[data-product-id]', '[data-entity-id]', '[data-product-entity-id]',
      '[data-product]', '[data-product-view] [data-product-id]',
      '[data-product-view] [data-entity-id]',
      '[data-product-details] [data-product-id]',
    ];
    for (var i = 0; i < selectors.length; i += 1) {
      var node = document.querySelector(selectors[i]);
      if (!node) continue;
      var candidate =
        (node.value && firstNumeric(node.value)) ||
        firstNumeric(node.getAttribute("data-product-id")) ||
        firstNumeric(node.getAttribute("data-entity-id")) ||
        firstNumeric(node.getAttribute("data-product-entity-id")) ||
        firstNumeric(node.getAttribute("data-product"));
      if (candidate) return candidate;
    }
    return "";
  }

  function detectProductIdFromInlineData() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"], script:not([src])');
    var patterns = [
      /"product_id"\s*[:=]\s*"?(\d{2,})"?/i,
      /"productId"\s*[:=]\s*"?(\d{2,})"?/i,
      /"entityId"\s*[:=]\s*"?(\d{2,})"?/i,
      /"productID"\s*[:=]\s*"?(\d{2,})"?/i,
    ];
    for (var i = 0; i < scripts.length; i += 1) {
      var text = scripts[i] && scripts[i].textContent ? scripts[i].textContent : "";
      if (!text) continue;
      for (var j = 0; j < patterns.length; j += 1) {
        var match = text.match(patterns[j]);
        if (match && match[1]) return match[1];
      }
    }
    return "";
  }

  function detectProductId() {
    var parsed = null;
    try { parsed = new URL(window.location.href); } catch (_err) { parsed = null; }
    if (parsed) {
      var urlKeys = ["product_id", "productId", "pid", "id"];
      for (var i = 0; i < urlKeys.length; i += 1) {
        var value = firstNumeric(parsed.searchParams.get(urlKeys[i]));
        if (value) return value;
      }
    }
    var fromGlobals = detectProductIdFromGlobals();
    if (fromGlobals) return fromGlobals;
    var fromDom = detectProductIdFromDom();
    if (fromDom) return fromDom;
    var fromInline = detectProductIdFromInlineData();
    if (fromInline) return fromInline;
    var bodyClass = document.body ? document.body.className : "";
    var classMatch = bodyClass.match(/\bproduct[-_ ]?(\d{2,})\b/i);
    if (classMatch && classMatch[1]) return classMatch[1];
    return "";
  }

  function detectCartProductIds() {
    var ids = [];
    var seen = {};
    function add(value) {
      var id = firstNumeric(value);
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    }
    var bcCart = window.BOLD && window.BOLD.cart;
    if (!bcCart) {
      var bcData = window.BCData || window.bcData || {};
      bcCart = bcData.cart || bcData.cartData;
    }
    if (bcCart && Array.isArray(bcCart.items || bcCart.lineItems || bcCart.line_items)) {
      var items = bcCart.items || bcCart.lineItems || bcCart.line_items;
      for (var k = 0; k < items.length; k += 1) {
        add(items[k].product_id || items[k].productId || items[k].id);
      }
      if (ids.length > 0) return ids;
    }
    var selectors = [
      "[data-item-product-id]", "[data-cart-product-id]", "[data-product-id]",
      "[data-entity-id]", "[data-product-entity-id]", 'input[name="product_id"]',
      'input[name^="item-"][name$="-product-id"]', 'a[href*="product_id="]',
      ".cart-item [data-product-id]", "[data-item-row] [data-product-id]",
    ];
    for (var i = 0; i < selectors.length; i += 1) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j += 1) {
        var node = nodes[j];
        add(node.getAttribute("data-item-product-id"));
        add(node.getAttribute("data-cart-product-id"));
        add(node.getAttribute("data-product-id"));
        add(node.getAttribute("data-entity-id"));
        add(node.getAttribute("data-product-entity-id"));
        add(node.value);
        add(node.getAttribute("value"));
        var href = node.getAttribute("href") || "";
        var hrefMatch = href.match(/[?&]product_id=(\d+)/i);
        if (hrefMatch && hrefMatch[1]) add(hrefMatch[1]);
      }
    }
    return ids;
  }

  /* ─── Cart API (Storefront) ─── */
  function fetchCartProductIds() {
    log("Fetching cart from /api/storefront/carts...");
    return fetch("/api/storefront/carts", {
      method: "GET", credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    .then(function (res) {
      if (!res.ok) return [];
      return res.json();
    })
    .then(function (carts) {
      var ids = [];
      var seen = {};
      var cart = null;
      if (Array.isArray(carts)) {
        cart = carts.length > 0 ? carts[0] : null;
      } else if (carts && Array.isArray(carts.data)) {
        cart = carts.data.length > 0 ? carts.data[0] : null;
      } else if (carts && carts.data && typeof carts.data === "object") {
        cart = carts.data;
      } else if (carts && typeof carts === "object") {
        cart = carts;
      }
      if (!cart) return ids;
      var lineTypes = ["lineItems", "line_items"];
      var itemCats = ["physicalItems", "digitalItems", "customItems", "physical_items", "digital_items"];
      for (var t = 0; t < lineTypes.length; t += 1) {
        var li = cart[lineTypes[t]];
        if (!li) continue;
        for (var c = 0; c < itemCats.length; c += 1) {
          var items = li[itemCats[c]];
          if (!Array.isArray(items)) continue;
          for (var i = 0; i < items.length; i += 1) {
            var pid = String(items[i].productId || items[i].product_id || "");
            if (pid && !seen[pid]) { seen[pid] = true; ids.push(pid); }
          }
        }
      }
      log("Cart product IDs found:", ids);
      return ids;
    })
    .catch(function (err) { log("Cart API error:", err); return []; });
  }

  var _pendingCart = null;  /* cart data from last addItemToCart (avoids extra GET) */

  function fetchFullCart() {
    /* Use cached cart from addItemToCart if available (most reliable) */
    if (_pendingCart) {
      var cached = _pendingCart;
      _pendingCart = null;
      /* Handle possible wrapper: { data: cart } or direct cart */
      if (cached.data && (cached.data.lineItems || cached.data.line_items)) cached = cached.data;
      if (cached.currency && (cached.currency.code || cached.currency.iso_code)) {
        window.__cuCurrency = cached.currency.code || cached.currency.iso_code;
      }
      if (cached.lineItems || cached.line_items) {
        log("Using cached cart from addItemToCart, id=" + cached.id);
        return Promise.resolve(cached);
      }
      /* Cached data doesn't look like a cart — fall through to GET */
      log("Cached cart invalid, falling back to GET");
    }
    return fetch("/api/storefront/carts?_t=" + Date.now(), {
      method: "GET", credentials: "same-origin",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
    })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (payload) {
      if (!payload) return null;
      var cart = null;
      if (Array.isArray(payload)) {
        cart = payload.length > 0 ? payload[0] : null;
      } else if (payload.data && Array.isArray(payload.data)) {
        cart = payload.data.length > 0 ? payload.data[0] : null;
      } else if (payload.data && typeof payload.data === "object") {
        cart = payload.data;
      } else if (typeof payload === "object") {
        cart = payload;
      }
      if (cart && cart.currency && (cart.currency.code || cart.currency.iso_code)) {
        window.__cuCurrency = cart.currency.code || cart.currency.iso_code;
      }
      return cart;
    })
    .catch(function (err) { warn("fetchFullCart error:", err); return null; });
  }

  function addItemToCart(lineItems, callback) {
    fetch("/api/storefront/carts?_t=" + Date.now(), {
      method: "GET", credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (carts) {
      var existingCart = null;
      if (Array.isArray(carts)) {
        existingCart = carts.length > 0 ? carts[0] : null;
      } else if (carts && Array.isArray(carts.data)) {
        existingCart = carts.data.length > 0 ? carts.data[0] : null;
      } else if (carts && carts.data && typeof carts.data === "object") {
        existingCart = carts.data;
      } else if (carts && typeof carts === "object") {
        existingCart = carts;
      }
      var cartId = existingCart && existingCart.id ? existingCart.id : null;
      if (cartId) {
        return fetch("/api/storefront/carts/" + cartId + "/items", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ lineItems: lineItems }),
        });
      } else {
        return fetch("/api/storefront/carts", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ lineItems: lineItems }),
        });
      }
    })
    .then(function (res) {
      if (res.ok) {
        /* Parse the response — it contains the updated cart, cache it for refreshDrawer */
        return res.json().then(function (cartData) {
          _pendingCart = cartData || null;
          log("addItemToCart success, cached cart:", !!_pendingCart);
          if (callback) callback(true);
        }).catch(function () {
          /* JSON parse failed but response was OK — item was added */
          _pendingCart = null;
          if (callback) callback(true);
        });
      } else {
        res.json().catch(function () { return {}; }).then(function (err) {
          warn("addItemToCart failed:", err);
          if (callback) callback(false);
        });
      }
    })
    .catch(function (err) { warn("addItemToCart error:", err); if (callback) callback(false); });
  }

  /* ─── Analytics Tracking ─── */
  var _cuSessionId = (function () {
    try {
      var key = "cu_sid";
      var sid = sessionStorage.getItem(key);
      if (sid) return sid;
      sid = "cu_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(key, sid);
      return sid;
    } catch (_e) { return "cu_" + Date.now().toString(36); }
  })();

  function trackEvent(eventType, productId, productTitle, extra) {
    if (!_scriptUrl || !_storeHash) return;
    try {
      var payload = {
        event: eventType,
        productId: String(productId || ""),
        productTitle: String(productTitle || ""),
        source: "cart_drawer",
        sessionId: _cuSessionId,
        storeHash: _storeHash
      };
      if (extra) {
        for (var k in extra) {
          if (extra.hasOwnProperty(k)) payload[k] = extra[k];
        }
      }
      var url = _scriptUrl.origin +
        "/apps/proxy/api/track?store_hash=" + encodeURIComponent(_storeHash);
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_e) { /* best-effort */ }
  }

  var _trackedImpressions = {};
  var _trackedViews = {};
  function trackImpressions(recs) {
    if (!recs || !recs.length) return;
    for (var i = 0; i < recs.length; i += 1) {
      var r = recs[i] || {};
      var pid = firstNumeric(r.id || r.product_id || r.productId);
      if (pid && !_trackedImpressions[pid]) {
        _trackedImpressions[pid] = true;
        trackEvent("impression", pid, r.title, { position: i });
      }
    }
  }

  function updateCartItemQty(cartId, itemId, productId, qty, callback) {
    fetch("/api/storefront/carts/" + cartId + "/items/" + itemId, {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ lineItem: { quantity: qty, productId: productId } }),
    })
    .then(function (res) { if (callback) callback(res.ok); })
    .catch(function () { if (callback) callback(false); });
  }

  function removeCartItem(cartId, itemId, callback) {
    fetch("/api/storefront/carts/" + cartId + "/items/" + itemId, {
      method: "DELETE", credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    .then(function (res) { if (callback) callback(res.ok); })
    .catch(function () { if (callback) callback(false); });
  }

  /* ─── Page & Formatting Utilities ─── */
  function isCartPage() {
    var path = String(window.location.pathname || "").toLowerCase();
    if (path.indexOf("/cart.php") !== -1 || path === "/cart" || path.indexOf("/cart/") === 0) return true;
    var bodyClass = document.body ? document.body.className.toLowerCase() : "";
    return bodyClass.indexOf("cart") !== -1;
  }

  function waitForValue(readFn, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      function tick() {
        var value = readFn();
        if ((Array.isArray(value) && value.length > 0) || (!Array.isArray(value) && value)) {
          resolve(value); return;
        }
        if (Date.now() - started >= timeoutMs) { resolve(Array.isArray(value) ? [] : ""); return; }
        setTimeout(tick, intervalMs);
      }
      tick();
    });
  }

  function getCurrencyCode() {
    if (window.__cuCurrency) return String(window.__cuCurrency).toUpperCase();
    var bcData = window.BCData || window.bcData || {};
    var code =
      (bcData.currency && bcData.currency.code) ||
      (bcData.shopSettings && bcData.shopSettings.currency) ||
      "GBP";
    return String(code || "GBP").toUpperCase();
  }

  function formatMoney(valueInCents, currencyCode) {
    var amount = Number(valueInCents) / 100;
    if (!isFinite(amount)) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency: currencyCode || getCurrencyCode(),
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (_err) {
      return (currencyCode || getCurrencyCode()) === "GBP"
        ? "\u00a3" + amount.toFixed(2) : "$" + amount.toFixed(2);
    }
  }

  function formatPrice(amount) {
    var n = Number(amount);
    if (!isFinite(n)) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency", currency: getCurrencyCode(),
        maximumFractionDigits: 2,
      }).format(n);
    } catch (_err) {
      return getCurrencyCode() === "GBP"
        ? "\u00a3" + n.toFixed(2) : "$" + n.toFixed(2);
    }
  }

  function normalizeProductUrl(handle) {
    var raw = String(handle || "").trim();
    if (!raw) return "#";
    if (/^https?:\/\//i.test(raw)) return raw;
    return raw.charAt(0) === "/" ? raw : "/" + raw;
  }

  /* ─── Styles ─── */
  function ensureStyles() {
    if (document.getElementById("cu-recommendations-style")) return;
    var style = document.createElement("style");
    style.id = "cu-recommendations-style";
    style.textContent =
      /* Inline recommendations (product page) */
      ".cu-recs-wrap{border:1px solid #e5e7eb;padding:16px;margin-top:18px;background:#fff}" +
      ".cu-recs-wrap--cart{margin-bottom:18px}" +
      ".cu-recs-title{margin:0 0 10px;font-size:18px;line-height:1.3;color:#111827}" +
      ".cu-recs-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}" +
      ".cu-rec-card{display:flex;gap:10px;padding:10px;border:1px solid #e5e7eb;color:inherit;background:#fafafa;flex-direction:column;text-decoration:none}" +
      ".cu-rec-thumb{width:100%;height:120px;object-fit:contain;background:#fff;border:1px solid #e5e7eb;flex-shrink:0}" +
      ".cu-rec-info{min-width:0;display:flex;flex-direction:column;gap:4px}" +
      ".cu-rec-name{font-size:13px;line-height:1.35;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none}" +
      ".cu-rec-price{font-size:13px;color:#4b5563;font-weight:600}" +
      ".cu-rec-add{display:inline-block;padding:6px 16px;background:#111;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;transition:background 0.15s;text-align:center;margin-top:4px}" +
      ".cu-rec-add:hover{background:#333}" +
      ".cu-rec-add:disabled{background:#94a3b8;cursor:not-allowed}" +
      "@media (max-width:700px){.cu-recs-grid{grid-template-columns:1fr 1fr}}" +

      /* ─── Cart Drawer ─── */
      ".cu-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:99998;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}" +
      ".cu-overlay--open{opacity:1;visibility:visible}" +

      /* Wrapper — holds side panel + cart */
      ".cu-drawer-wrap{position:fixed;top:0;right:0;bottom:0;z-index:99999;display:flex;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);box-shadow:-6px 0 24px rgba(0,0,0,.12)}" +
      ".cu-drawer-wrap--open{transform:translateX(0)}" +
      ".cu-drawer-wrap *{box-sizing:border-box;font-family:inherit}" +

      /* Side panel — recommendations (left of cart) */
      ".cu-drawer-side{width:300px;background:#f7f7f5;display:none;flex-direction:column;overflow:hidden;border-right:1px solid #eee;order:-1}" +
      ".cu-drawer-side-hd{padding:20px 18px 14px;flex-shrink:0}" +
      ".cu-drawer-side-hd h3{margin:0;font-size:17px;font-weight:700;color:#111}" +
      ".cu-drawer-side-bd{flex:1 1 0%;overflow-y:auto;padding:0 14px 14px;display:flex;flex-direction:column;gap:10px}" +
      ".cu-drawer-side-empty{display:none}" +

      /* Unified rec cards — used by both side and bottom layouts */
      ".cu-rcard{background:var(--cu-card-bg,#f5f5f5);border-radius:2px;overflow:hidden;transition:opacity .3s,transform .3s}" +
      ".cu-rcard--out{opacity:0;transform:scale(.9);pointer-events:none}" +
      ".cu-rcard--hidden{display:none}" +
      ".cu-rcard--reveal{animation:cu-rc-reveal .35s ease}" +
      "@keyframes cu-rc-reveal{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}" +
      ".cu-rcard-img-wrap{position:relative;background:#fff}" +
      ".cu-rcard-img{width:100%;height:150px;object-fit:contain;display:block}" +
      ".cu-rcard-info{padding:6px 10px 8px}" +
      ".cu-rcard-row{margin-bottom:2px}" +
      ".cu-rcard-price{font-size:14px;font-weight:700;color:var(--cu-card-text,#111)}" +
      ".cu-rcard-add{position:absolute;right:8px;bottom:8px;z-index:2;width:34px;height:34px;border-radius:50%;background:var(--cu-card-accent,#333);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s;box-shadow:0 2px 6px rgba(0,0,0,.15);flex-shrink:0}" +
      ".cu-rcard-add:hover{opacity:.85}" +
      ".cu-rcard-add:disabled{background:#94a3b8;cursor:not-allowed}" +
      ".cu-rcard-add svg{width:16px;height:16px}" +
      ".cu-rcard-name{font-size:13px;color:var(--cu-card-text,#111);opacity:.7;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word}" +
      ".cu-rcard-opts{display:flex;gap:6px;margin-top:4px;align-items:center;flex-wrap:wrap}" +
      ".cu-rcard-swatch{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:border-color .15s;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1)}" +
      ".cu-rcard-swatch:hover,.cu-rcard-swatch--active{border-color:var(--cu-card-accent,#333)}" +
      ".cu-rcard-opt-sel{font-size:11px;padding:3px 6px;border:1px solid #ccc;border-radius:3px;background:#fff;cursor:pointer;max-width:120px}" +

      /* Cart panel (right) */
      ".cu-drawer{width:420px;max-width:100vw;background:#fff;display:flex;flex-direction:column;flex-shrink:0}" +

      /* Header */
      ".cu-drawer-hd{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #eee;flex-shrink:0}" +
      ".cu-drawer-hd h2{margin:0;font-size:17px;font-weight:700;color:#111;display:flex;align-items:center;gap:10px}" +
      ".cu-drawer-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;border-radius:50%;border:1.5px solid #111;font-size:12px;font-weight:700;color:#111;padding:0 4px}" +
      ".cu-drawer-x{background:none;border:none;font-size:22px;cursor:pointer;color:#555;padding:4px;line-height:1;transition:color .15s}" +
      ".cu-drawer-x:hover{color:#111}" +

      /* Free-shipping bar */
      ".cu-drawer-ship{padding:10px 20px;background:#f8f8f6;flex-shrink:0;display:none}" +
      ".cu-drawer-ship--vis{display:block}" +
      ".cu-drawer-ship-text{font-size:13px;color:#444;text-align:center;margin-bottom:6px;font-weight:500;line-height:1.4}" +
      ".cu-drawer-ship-text b{color:#111;font-weight:700}" +
      ".cu-drawer-ship-track{height:5px;background:#e5e5e2;border-radius:3px;overflow:hidden}" +
      ".cu-drawer-ship-fill{height:100%;background:#111;border-radius:3px;transition:width .5s ease;width:0%}" +
      ".cu-drawer-ship--done .cu-drawer-ship-fill{background:#22c55e}" +
      ".cu-drawer-ship--done .cu-drawer-ship-text{color:#16a34a}" +

      /* Body (scrollable) */
      ".cu-drawer-bd{flex:1 1 0%;overflow-y:auto;min-height:0;display:flex;flex-direction:column}" +

      /* Cart items */
      ".cu-drawer-item{display:flex;align-items:flex-start;gap:14px;padding:16px 20px;border-bottom:1px solid #f0f0f0;transition:opacity .3s,transform .3s;opacity:1}" +
      ".cu-drawer-item--adding{animation:cu-slide-in .35s ease}" +
      "@keyframes cu-slide-in{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}" +
      ".cu-drawer-item-img{width:80px;height:80px;object-fit:cover;background:#f9fafb;border-radius:8px;border:1px solid #eee;flex-shrink:0}" +
      ".cu-drawer-item-mid{flex:1;min-width:0;padding-top:2px}" +
      ".cu-drawer-item-name{font-size:13px;font-weight:600;color:#111;line-height:1.4;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
      ".cu-drawer-item-opts{font-size:11px;color:#777;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".cu-drawer-qty{display:inline-flex;align-items:center;border:1px solid #d1d5db;border-radius:20px;overflow:hidden}" +
      ".cu-drawer-qty button{background:none;border:none;padding:5px 12px;font-size:14px;cursor:pointer;color:#374151;line-height:1;transition:background .1s}" +
      ".cu-drawer-qty button:hover{background:#f3f4f6}" +
      ".cu-drawer-qty span{padding:2px 4px;font-size:13px;min-width:22px;text-align:center}" +
      ".cu-drawer-item-rt{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;padding-top:2px}" +
      ".cu-drawer-item-price{font-size:14px;font-weight:700;color:#111}" +
      ".cu-drawer-item-del{background:none;border:none;cursor:pointer;color:#bbb;padding:2px;line-height:1;transition:color .15s}" +
      ".cu-drawer-item-del:hover{color:#ef4444}" +
      ".cu-drawer-item-del svg{width:16px;height:16px;display:block}" +

      /* Bottom recs (horizontal scroll inside cart body) */
      ".cu-drawer-recs{padding:18px 20px 14px;border-top:2px solid #f0f0f0;margin-top:auto;background:#fafaf8}" +
      ".cu-drawer-recs-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}" +
      ".cu-drawer-recs-hd h3{margin:0;font-size:13px;font-weight:700;letter-spacing:.3px;color:#111}" +
      ".cu-drawer-recs-scroll{display:flex;gap:12px;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}" +
      ".cu-drawer-recs-scroll::-webkit-scrollbar{display:none}" +
      ".cu-drawer-recs .cu-rcard{flex:0 0 170px;scroll-snap-align:start}" +
      ".cu-drawer-recs .cu-rcard-img{height:100px}" +
      /* Sticky bottom recs mode */
      ".cu-drawer-bd--sticky{display:flex;flex-direction:column;overflow:hidden}" +
      ".cu-drawer-bd-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}" +
      ".cu-drawer-recs--sticky{flex-shrink:0;max-height:35vh;overflow-y:auto}" +

      /* Footer */
      ".cu-drawer-ft{border-top:1px solid #eee;padding:16px 20px;flex-shrink:0;background:#fff}" +
      ".cu-drawer-sub{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}" +
      ".cu-drawer-sub span:first-child{font-size:15px;font-weight:600;color:#111}" +
      ".cu-drawer-sub span:last-child{font-size:16px;font-weight:700;color:#111}" +
      ".cu-drawer-checkout{display:block;width:100%;padding:15px;text-align:center;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:.3px;border:none;border-radius:8px;cursor:pointer;text-transform:uppercase;transition:background .15s}" +
      ".cu-drawer-checkout:hover{background:#333}" +

      /* Empty */
      ".cu-drawer-empty{padding:48px 20px;text-align:center;color:#999;font-size:14px}" +

      /* Mobile: hide side panel, full-width cart */
      "@media(max-width:768px){.cu-drawer-side{display:none}.cu-drawer{width:100vw}}";
    document.head.appendChild(style);
  }

  /* ─── Inline Recommendations Mount ─── */
  function mountNode(context) {
    if (context === "cart") {
      return (
        document.querySelector("[data-cart-content]") ||
        document.querySelector("[data-cart]") ||
        document.querySelector(".cart-content") ||
        document.querySelector("#cart-content") ||
        document.querySelector(".page-type-cart .page-content") ||
        document.querySelector(".page-type-cart main") ||
        document.querySelector(".cart") ||
        document.querySelector(".page-content") ||
        document.querySelector("main")
      );
    }
    return (
      document.querySelector(".productView-details") ||
      document.querySelector(".productView-description") ||
      document.querySelector(".productView") ||
      document.querySelector("main")
    );
  }

  /* ─── Inline Recommendations Render (with Add buttons) ─── */
  function renderRecommendations(recommendations, context) {
    if (!Array.isArray(recommendations) || recommendations.length === 0) return false;
    var mount = mountNode(context);
    if (!mount) return false;

    var hostId = context === "cart" ? "cartuplift-cart-recommendations" : "cartuplift-recommendations";
    var host = document.getElementById(hostId);
    if (host) host.remove();

    ensureStyles();
    host = document.createElement("section");
    host.id = hostId;
    host.className = "cu-recs-wrap" + (context === "cart" ? " cu-recs-wrap--cart" : "");

    var title = document.createElement("h3");
    title.className = "cu-recs-title";
    title.textContent = context === "cart" ? "Recommended for your cart" : "You might also like";
    host.appendChild(title);

    var grid = document.createElement("div");
    grid.className = "cu-recs-grid";
    var currency = getCurrencyCode();

    for (var i = 0; i < recommendations.length; i += 1) {
      var rec = recommendations[i] || {};
      var card = document.createElement("div");
      card.className = "cu-rec-card";

      if (rec.image) {
        var imgLink = document.createElement("a");
        imgLink.href = normalizeProductUrl(rec.handle);
        var img = document.createElement("img");
        img.className = "cu-rec-thumb";
        img.src = rec.image;
        img.alt = String(rec.title || "Recommended product");
        img.loading = "lazy";
        imgLink.appendChild(img);
        card.appendChild(imgLink);
      }

      var info = document.createElement("div");
      info.className = "cu-rec-info";

      var nameLink = document.createElement("a");
      nameLink.className = "cu-rec-name";
      nameLink.href = normalizeProductUrl(rec.handle);
      nameLink.textContent = String(rec.title || "Recommended product");
      info.appendChild(nameLink);

      var price = document.createElement("div");
      price.className = "cu-rec-price";
      price.textContent = formatMoney(rec.price, currency);
      info.appendChild(price);

      var recId = firstNumeric(rec.id || rec.product_id || rec.productId);
      if (recId) {
        var addBtn = document.createElement("button");
        addBtn.className = "cu-rec-add";
        addBtn.textContent = "Add";
        addBtn.setAttribute("data-cu-product-id", recId);
        var inlineVid = rec.variant_id || rec.variantId || "";
        var inlineTitle = String(rec.title || "Product");
        (function (btn, pid, vid, pTitle) {
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = "Adding...";
            trackEvent("click", pid, pTitle);
            var item = { quantity: 1, productId: Number(pid) };
            if (vid) item.variantId = Number(vid);
            addItemToCart([item], function (ok) {
              if (ok) {
                trackEvent("add_to_cart", pid, pTitle);
                btn.textContent = "Added!";
                setTimeout(function () { btn.textContent = "Add"; btn.disabled = false; }, 2000);
                openDrawer();
              } else {
                btn.textContent = "Add";
                btn.disabled = false;
              }
            });
          });
        })(addBtn, recId, inlineVid, inlineTitle);
        info.appendChild(addBtn);
      }

      card.appendChild(info);
      grid.appendChild(card);
    }

    host.appendChild(grid);

    if (context === "cart" && mount.firstChild) {
      mount.insertBefore(host, mount.firstChild);
    } else {
      mount.appendChild(host);
    }
    /* Track inline recommendation impressions */
    trackImpressions(recommendations);
    return true;
  }

  /* ─── API Helpers ─── */
  function fetchJson(url) {
    return fetch(url, {
      method: "GET", mode: "cors", credentials: "omit",
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function buildRecommendationsUrl(scriptUrl, storeHash, productId, cartIds, limit, context) {
    var apiUrl =
      scriptUrl.origin +
      "/apps/proxy/api/recommendations?store_hash=" +
      encodeURIComponent(storeHash) +
      "&limit=" + String(limit || 4);
    if (productId) apiUrl += "&product_id=" + encodeURIComponent(productId);
    if (cartIds && cartIds.length) apiUrl += "&cart=" + encodeURIComponent(cartIds.join(","));
    if (context) apiUrl += "&context=" + encodeURIComponent(context);
    return apiUrl;
  }

  function mapBundlesToRecommendations(bundleData, currentProductId, limit) {
    var bundles = bundleData && Array.isArray(bundleData.bundles) ? bundleData.bundles : [];
    if (!bundles.length) return [];
    var products = Array.isArray(bundles[0].products) ? bundles[0].products : [];
    var out = [];
    var seen = {};
    for (var i = 0; i < products.length; i += 1) {
      var p = products[i] || {};
      var id = firstNumeric(p.id || p.product_id || p.productId);
      if (!id || id === currentProductId || seen[id]) continue;
      seen[id] = true;
      out.push({
        id: id,
        title: String(p.title || p.name || "Recommended product"),
        handle: String(p.handle || p.url || "#"),
        image: p.image || p.image_url,
        price: Number(p.price || 0),
        variant_id: p.variant_id || p.variantId || "",
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  function fetchRecommendationsWithFallback(scriptUrl, storeHash, productId, cartIds, context, limit) {
    var recUrl = buildRecommendationsUrl(scriptUrl, storeHash, productId, cartIds, limit, context);
    return fetchJson(recUrl)
      .then(function (data) {
        var recs = data && Array.isArray(data.recommendations) ? data.recommendations : [];
        if (data && data.currency) window.__cuCurrency = data.currency;
        if (recs.length > 0) return recs;
        /* Fallback: try bundles, then trending catalog products */
        var fallbackProductId = productId || (cartIds && cartIds.length ? cartIds[0] : "");
        var tryTrending = function () {
          var trendingUrl =
            scriptUrl.origin +
            "/apps/proxy/api/recommendations?store_hash=" +
            encodeURIComponent(storeHash) +
            "&limit=" + String(limit) + "&context=trending" +
            (cartIds && cartIds.length ? "&cart=" + encodeURIComponent(cartIds.join(",")) : "") +
            (productId ? "&product_id=" + encodeURIComponent(productId) : "");
          return fetchJson(trendingUrl)
            .then(function (td) {
              if (td && td.currency) window.__cuCurrency = td.currency;
              return td && Array.isArray(td.recommendations) ? td.recommendations : [];
            })
            .catch(function () { return []; });
        };
        if (fallbackProductId) {
          var bundleUrl =
            scriptUrl.origin +
            "/apps/proxy/api/bundles?store_hash=" +
            encodeURIComponent(storeHash) +
            "&product_id=" + encodeURIComponent(fallbackProductId) +
            "&context=product";
          return fetchJson(bundleUrl)
            .then(function (bundleData) {
              if (bundleData && bundleData.currency) window.__cuCurrency = bundleData.currency;
              var bundleRecs = mapBundlesToRecommendations(bundleData, fallbackProductId, limit);
              if (bundleRecs.length > 0) return bundleRecs;
              /* Bundles also empty — try trending/catalog products */
              return tryTrending();
            })
            .catch(function () { return tryTrending(); });
        }
        return tryTrending();
      })
      .catch(function (err) { warn("Recommendations failed", err); return []; });
  }

  /* ════════════════════════════════════════════════════════
     ─── CART DRAWER ───
     ════════════════════════════════════════════════════════ */

  var _overlay = null;
  var _drawerWrap = null;
  var _drawer = null;
  var _drawerBody = null;
  var _drawerItemCount = null;
  var _drawerCountBadge = null;
  var _drawerSubtotalEl = null;
  var _drawerShipEl = null;
  var _drawerShipTextEl = null;
  var _drawerShipFillEl = null;
  var _sidePanel = null;
  var _sideBody = null;
  var _sideTitleEl = null;
  var _scriptUrl = null;
  var _storeHash = "";
  var _drawerRecs = [];
  var _drawerRecsAll = [];       /* unfiltered master list */
  var _lastRecsFetchKey = "";    /* tracks when to re-fetch vs reuse cache */
  var _recsBuiltKey = "";        /* tracks which recs the DOM was built for */

  /* Store settings (fetched from proxy) */
  var _settingsFetched = false;
  var _shipEnabled = false;
  var _shipThreshold = 0;
  var _shipText = "You\u2019re {amount} away from free shipping!";
  var _shipDoneText = "\u2713 Free shipping unlocked!";
  var _recsTitle = "Hand picked for you";
  var _recsPosition = "bottom";  /* "bottom" = horizontal scroll in cart, "side" = left panel */
  var _sideDeviceMode = "desktop_only";
  var _bottomRecsSticky = false;
  var _cardBg = "#f5f5f5";
  var _cardText = "#111111";
  var _cardAccent = "#333333";
  var _prewarmStarted = false;
  var _prewarmPromise = null;

  function getCartItems(cart) {
    if (!cart) return [];
    var lineItems = cart.lineItems || cart.line_items || (cart.data && (cart.data.lineItems || cart.data.line_items));
    if (!lineItems) return [];

    var out = [];
    var cats = ["physicalItems", "digitalItems", "customItems", "physical_items", "digital_items", "custom_items"];
    for (var c = 0; c < cats.length; c += 1) {
      var items = lineItems[cats[c]];
      if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i += 1) out.push(items[i]);
      }
    }
    return out;
  }

  function getCartAmount(cart) {
    if (!cart) return 0;
    var amount =
      cart.cartAmount ||
      cart.cart_amount ||
      cart.baseAmount ||
      cart.base_amount ||
      (cart.data && (cart.data.cartAmount || cart.data.cart_amount || cart.data.baseAmount || cart.data.base_amount)) ||
      0;
    var n = Number(amount);
    return isFinite(n) ? n : 0;
  }

  function getCartTotalQty(cart) {
    var items = getCartItems(cart);
    var count = 0;
    for (var i = 0; i < items.length; i += 1) count += (items[i].quantity || 1);
    return count;
  }

  function updateHeaderCartCount(count) {
    var badges = document.querySelectorAll(
      ".countPill, .cart-quantity, [data-cart-quantity], .navUser-action--cart .countPill"
    );
    for (var i = 0; i < badges.length; i += 1) {
      badges[i].textContent = String(count);
      if (count > 0) {
        badges[i].style.display = "";
        badges[i].classList.add("countPill--positive");
      }
    }
  }

  function createDrawerShell() {
    if (_overlay) return;
    ensureStyles();

    _overlay = document.createElement("div");
    _overlay.className = "cu-overlay";
    _overlay.addEventListener("click", closeDrawer);

    /* ── Outer wrapper (holds side panel + cart) ── */
    _drawerWrap = document.createElement("div");
    _drawerWrap.className = "cu-drawer-wrap";

    /* ── Side panel — recommendations ── */
    _sidePanel = document.createElement("div");
    _sidePanel.className = "cu-drawer-side";
    var sideHd = document.createElement("div");
    sideHd.className = "cu-drawer-side-hd";
    var sideH3 = document.createElement("h3");
    sideH3.textContent = _recsTitle;
    _sideTitleEl = sideH3;
    sideHd.appendChild(sideH3);
    _sidePanel.appendChild(sideHd);
    _sideBody = document.createElement("div");
    _sideBody.className = "cu-drawer-side-bd";
    _sidePanel.appendChild(_sideBody);
    _drawerWrap.appendChild(_sidePanel);

    /* ── Cart panel ── */
    _drawer = document.createElement("div");
    _drawer.className = "cu-drawer";

    /* Header */
    var hd = document.createElement("div");
    hd.className = "cu-drawer-hd";
    var h2 = document.createElement("h2");
    _drawerItemCount = h2;
    h2.textContent = "Your Cart ";
    var countBadge = document.createElement("span");
    countBadge.className = "cu-drawer-cnt";
    countBadge.textContent = "0";
    _drawerCountBadge = countBadge;
    h2.appendChild(countBadge);
    hd.appendChild(h2);
    var xBtn = document.createElement("button");
    xBtn.className = "cu-drawer-x";
    xBtn.innerHTML = "&times;";
    xBtn.setAttribute("aria-label", "Close cart");
    xBtn.addEventListener("click", closeDrawer);
    hd.appendChild(xBtn);
    _drawer.appendChild(hd);

    /* Free-shipping bar */
    var ship = document.createElement("div");
    ship.className = "cu-drawer-ship";
    var shipText = document.createElement("div");
    shipText.className = "cu-drawer-ship-text";
    ship.appendChild(shipText);
    var shipTrack = document.createElement("div");
    shipTrack.className = "cu-drawer-ship-track";
    var shipFill = document.createElement("div");
    shipFill.className = "cu-drawer-ship-fill";
    shipTrack.appendChild(shipFill);
    ship.appendChild(shipTrack);
    _drawerShipEl = ship;
    _drawerShipTextEl = shipText;
    _drawerShipFillEl = shipFill;
    _drawer.appendChild(ship);

    /* Body (scrollable) */
    _drawerBody = document.createElement("div");
    _drawerBody.className = "cu-drawer-bd" + (_bottomRecsSticky ? " cu-drawer-bd--sticky" : "");
    _drawer.appendChild(_drawerBody);

    /* Footer */
    var ft = document.createElement("div");
    ft.className = "cu-drawer-ft";
    var sub = document.createElement("div");
    sub.className = "cu-drawer-sub";
    var subLabel = document.createElement("span");
    subLabel.textContent = "Subtotal";
    var subAmount = document.createElement("span");
    subAmount.textContent = formatPrice(0);
    _drawerSubtotalEl = subAmount;
    sub.appendChild(subLabel);
    sub.appendChild(subAmount);
    ft.appendChild(sub);
    var coBtn = document.createElement("a");
    coBtn.className = "cu-drawer-checkout";
    coBtn.href = "/checkout";
    coBtn.textContent = "CHECKOUT";
    ft.appendChild(coBtn);
    _drawer.appendChild(ft);

    _drawerWrap.appendChild(_drawer);

    /* Inject card color CSS variables */
    _drawerWrap.style.setProperty("--cu-card-bg", _cardBg);
    _drawerWrap.style.setProperty("--cu-card-text", _cardText);
    _drawerWrap.style.setProperty("--cu-card-accent", _cardAccent);

    document.body.appendChild(_overlay);
    document.body.appendChild(_drawerWrap);
  }

  function openDrawer() {
    createDrawerShell();
    document.body.style.overflow = "hidden";
    _overlay.classList.add("cu-overlay--open");
    _drawerWrap.classList.add("cu-drawer-wrap--open");
    refreshDrawer();
  }

  function closeDrawer() {
    if (!_overlay) return;
    document.body.style.overflow = "";
    _overlay.classList.remove("cu-overlay--open");
    _drawerWrap.classList.remove("cu-drawer-wrap--open");
  }

  function fetchStoreSettings() {
    if (_settingsFetched || !_scriptUrl || !_storeHash) return;
    _settingsFetched = true;
    var url = _scriptUrl.origin +
      "/apps/proxy/api/settings?store_hash=" + encodeURIComponent(_storeHash);
    fetchJson(url).then(function (s) {
      if (!s || s.error) return;
      _shipEnabled = !!s.enableFreeShipping;
      _shipThreshold = Number(s.freeShippingThreshold) || 0;
      if (s.freeShippingText) _shipText = s.freeShippingText;
      if (s.freeShippingAchievedText) _shipDoneText = s.freeShippingAchievedText;
      if (typeof s.recommendationsTitle === "string" && s.recommendationsTitle.trim()) {
        _recsTitle = s.recommendationsTitle;
      } else if (typeof s.drawerSideRecsTitle === "string" && s.drawerSideRecsTitle.trim()) {
        /* Backward-compat: use old side title if the unified title is not set yet. */
        _recsTitle = s.drawerSideRecsTitle;
      }
      if (s.drawerRecsPosition === "side" || s.drawerRecsPosition === "bottom") _recsPosition = s.drawerRecsPosition;
      if (s.sideRecsDeviceMode === "desktop_only" || s.sideRecsDeviceMode === "all_devices") _sideDeviceMode = s.sideRecsDeviceMode;
      _bottomRecsSticky = !!s.bottomRecsStickyEnabled;
      if (s.recsCardBackground) _cardBg = s.recsCardBackground;
      if (s.recsCardTextColor) _cardText = s.recsCardTextColor;
      if (s.recsCardAccentColor) _cardAccent = s.recsCardAccentColor;
      log("Settings loaded: shipping=" + _shipEnabled + " threshold=" + _shipThreshold + " recsPos=" + _recsPosition);
      /* Inject card color CSS variables */
      if (_drawerWrap) {
        _drawerWrap.style.setProperty("--cu-card-bg", _cardBg);
        _drawerWrap.style.setProperty("--cu-card-text", _cardText);
        _drawerWrap.style.setProperty("--cu-card-accent", _cardAccent);
      }
      /* Apply sticky mode class */
      if (_bottomRecsSticky && _drawerBody) {
        _drawerBody.classList.add("cu-drawer-bd--sticky");
      }
      if (_sideTitleEl) _sideTitleEl.textContent = _recsTitle;
      var drawerTitle = _drawerBody ? _drawerBody.querySelector(".cu-drawer-recs-hd h3") : null;
      if (drawerTitle) drawerTitle.textContent = _recsTitle;
      /* Show/hide side panel based on position setting */
      if (_sidePanel) _sidePanel.style.display = _recsPosition === "side" ? "flex" : "none";
      /* Re-render shipping bar if drawer is open */
      if (_drawerShipEl && _drawerWrap && _drawerWrap.classList.contains("cu-drawer-wrap--open")) {
        updateShippingBar(0);
      }
    }).catch(function () { /* best-effort */ });
  }

  function updateShippingBar(cartAmount) {
    if (!_drawerShipEl) return;
    if (!_shipEnabled || _shipThreshold <= 0) {
      _drawerShipEl.classList.remove("cu-drawer-ship--vis");
      return;
    }
    _drawerShipEl.classList.add("cu-drawer-ship--vis");
    var amount = Number(cartAmount) || 0;
    var remaining = Math.max(0, _shipThreshold - amount);
    var pct = Math.min(100, (amount / _shipThreshold) * 100);
    if (remaining <= 0) {
      _drawerShipEl.classList.add("cu-drawer-ship--done");
      _drawerShipTextEl.innerHTML = _shipDoneText;
    } else {
      _drawerShipEl.classList.remove("cu-drawer-ship--done");
      var formatted = formatPrice(remaining);
      _drawerShipTextEl.innerHTML = _shipText.replace("{amount}", "<b>" + formatted + "</b>");
    }
    _drawerShipFillEl.style.width = pct + "%";
  }

  function getCartProductIdSet(cart) {
    var set = {};
    var items = getCartItems(cart);
    for (var i = 0; i < items.length; i += 1) {
      var pid = String(items[i].productId || items[i].product_id || items[i].id || "");
      if (pid) set[pid] = true;
    }
    return set;
  }

  /* ─── Prewarm Recommendations ─── */
  function prewarmRecommendations() {
    if (_prewarmStarted || _drawerRecsAll.length > 0) return;
    if (!_scriptUrl || !_storeHash) return;
    _prewarmStarted = true;
    log("Prewarming recommendations...");
    _prewarmPromise = fetchFullCart().then(function (cart) {
      if (!cart) return [];
      var cartPidSet = getCartProductIdSet(cart);
      var productIds = Object.keys(cartPidSet).sort();
      if (productIds.length === 0) return [];
      return fetchRecommendationsWithFallback(
        _scriptUrl, _storeHash, "", productIds, "cart", 10
      ).then(function (recs) {
        if (recs && recs.length > 0) {
          _drawerRecsAll = recs;
          _lastRecsFetchKey = productIds.join(",");
          log("Prewarmed " + recs.length + " recommendations");
        }
        return recs || [];
      });
    }).catch(function () { return []; });
  }

  function refreshDrawer() {
    log("Refreshing drawer…");
    fetchFullCart().then(function (cart) {
      log("Cart data:", cart ? "id=" + cart.id + " amount=" + getCartAmount(cart) : "null");
      var items = getCartItems(cart);
      log("Cart items count:", items.length);
      var totalQty = getCartTotalQty(cart);
      var cartPidSet = getCartProductIdSet(cart);

      /* Update header count badge */
      if (_drawerCountBadge) {
        _drawerCountBadge.textContent = String(totalQty);
      }
      updateHeaderCartCount(totalQty);

      /* Update subtotal */
      if (_drawerSubtotalEl) {
        _drawerSubtotalEl.textContent = cart ? formatPrice(getCartAmount(cart)) : formatPrice(0);
      }

      /* Update free-shipping bar */
      updateShippingBar(getCartAmount(cart));

      /* Render body */
      if (!_drawerBody) return;

      /* Track existing product IDs before clearing, to detect new items */
      var prevPids = {};
      var prevItemEls = _drawerBody.querySelectorAll(".cu-drawer-item[data-cu-pid]");
      for (var p = 0; p < prevItemEls.length; p += 1) {
        var ppid = prevItemEls[p].getAttribute("data-cu-pid");
        if (ppid) prevPids[ppid] = true;
      }

      /* Remove item rows (keep .cu-drawer-recs in place for now) */
      var existingItems = _drawerBody.querySelectorAll(".cu-drawer-item, .cu-drawer-empty");
      for (var r = 0; r < existingItems.length; r += 1) existingItems[r].remove();

      /* Detach bottom recs section so items are inserted before it */
      var _existingRecsSection = _drawerBody.querySelector(".cu-drawer-recs");
      if (_existingRecsSection) _existingRecsSection.remove();

      /* Ensure scroll wrapper exists in sticky mode */
      if (_bottomRecsSticky && !_drawerBody.querySelector(".cu-drawer-bd-scroll")) {
        var scrollWrap = document.createElement("div");
        scrollWrap.className = "cu-drawer-bd-scroll";
        _drawerBody.appendChild(scrollWrap);
      }

      if (!cart || items.length === 0) {
        var empty = document.createElement("div");
        empty.className = "cu-drawer-empty";
        _drawerBody.appendChild(empty);
        empty.textContent = "Your cart is empty";
        /* Show all recs (nothing in cart to filter) */
        renderRecs(_drawerRecsAll, {});
        return;
      }

      /* Cart items */
      var cartId = cart.id || cart.cartId || cart.cart_id || (cart.data && (cart.data.id || cart.data.cartId || cart.data.cart_id));
      for (var i = 0; i < items.length; i += 1) {
        var rowPid = String(items[i].productId || items[i].product_id || items[i].id || "");
        var isNew = !prevPids[rowPid];
        var row = buildDrawerItem(items[i], cartId, isNew);
        var _itemTarget = _bottomRecsSticky ? (_drawerBody.querySelector(".cu-drawer-bd-scroll") || _drawerBody) : _drawerBody;
        _itemTarget.appendChild(row);
      }

      /* Re-attach bottom recs section AFTER items so it stays at the bottom */
      if (_existingRecsSection) {
        if (_bottomRecsSticky) {
          _existingRecsSection.classList.add("cu-drawer-recs--sticky");
        }
        _drawerBody.appendChild(_existingRecsSection);
      }

      /* ─── Side panel recommendations: fetch once, then toggle ─── */
      var productIds = [];
      var sortedPids = Object.keys(cartPidSet).sort();
      for (var j = 0; j < sortedPids.length; j += 1) productIds.push(sortedPids[j]);

      /* Build name-stem set from cart items to exclude same-family products */
      var cartStems = {};
      for (var ci = 0; ci < items.length; ci++) {
        var cName = String(items[ci].name || items[ci].title || "").toLowerCase().trim();
        var cStem = cName.replace(/\s*[-\u2013]\s*[^-\u2013]*$/, "").trim();
        if (cStem.length > 3) cartStems[cStem] = true;
      }

      function filterRecsForCart(recs) {
        var out = [];
        for (var fi = 0; fi < recs.length; fi++) {
          var rName = String(recs[fi].title || "").toLowerCase().trim();
          var rStem = rName.replace(/\s*[-\u2013]\s*[^-\u2013]*$/, "").trim();
          if (rStem.length > 3 && cartStems[rStem]) continue;
          out.push(recs[fi]);
        }
        return out;
      }

      if (_drawerRecsAll.length > 0) {
        renderRecs(filterRecsForCart(_drawerRecsAll), cartPidSet);
      } else if (_prewarmPromise) {
        /* Prewarm in flight — wait for it instead of starting a duplicate fetch */
        _prewarmPromise.then(function () {
          if (_drawerRecsAll.length > 0) {
            renderRecs(filterRecsForCart(_drawerRecsAll), getCartProductIdSet(cart));
          } else if (_scriptUrl && _storeHash) {
            fetchRecommendationsWithFallback(
              _scriptUrl, _storeHash, "", productIds, "cart", 10
            ).then(function (recs) {
              _drawerRecsAll = recs;
              _lastRecsFetchKey = productIds.join(",");
              renderRecs(filterRecsForCart(_drawerRecsAll), getCartProductIdSet(cart));
            });
          }
        });
      } else if (_scriptUrl && _storeHash) {
        fetchRecommendationsWithFallback(
          _scriptUrl, _storeHash, "", productIds, "cart", 10
        ).then(function (recs) {
          _drawerRecsAll = recs;
          _lastRecsFetchKey = productIds.join(",");
          renderRecs(filterRecsForCart(_drawerRecsAll), getCartProductIdSet(cart));
        });
      }
    });
  }

  function buildDrawerItem(item, cartId, animate) {
    var itemProductId = item.productId || item.product_id || 0;
    var itemId = item.id || item.itemId || item.item_id || 0;
    var itemName = String(item.name || item.title || "Product");
    var itemImage = item.imageUrl || item.image_url || "";
    var itemOptions = item.options || item.optionSelections || item.option_selections || [];
    var itemPrice = item.extendedSalePrice || item.extended_sale_price || item.salePrice || item.sale_price || item.listPrice || item.list_price || 0;

    var row = document.createElement("div");
    row.className = "cu-drawer-item" + (animate ? " cu-drawer-item--adding" : "");
    row.setAttribute("data-cu-pid", String(itemProductId || ""));

    /* Image */
    var img = document.createElement("img");
    img.className = "cu-drawer-item-img";
    img.src = itemImage;
    img.alt = itemName;
    img.loading = "lazy";
    row.appendChild(img);

    /* Middle: name + options + qty */
    var mid = document.createElement("div");
    mid.className = "cu-drawer-item-mid";

    var name = document.createElement("div");
    name.className = "cu-drawer-item-name";
    name.textContent = itemName;
    name.title = itemName;
    mid.appendChild(name);

    /* Variant options (e.g. "Size: Medium / Color: Blue") */
    if (Array.isArray(itemOptions) && itemOptions.length > 0) {
      var optsText = [];
      for (var oi = 0; oi < itemOptions.length; oi += 1) {
        var opt = itemOptions[oi];
        var optName = opt && (opt.name || opt.display_name || "");
        var optValue = opt && (opt.value || opt.label || opt.value_name || "");
        if (optValue) optsText.push(optName ? optName + ": " + optValue : optValue);
      }
      if (optsText.length > 0) {
        var optsEl = document.createElement("div");
        optsEl.className = "cu-drawer-item-opts";
        optsEl.textContent = optsText.join(" / ");
        mid.appendChild(optsEl);
      }
    }

    var qtyWrap = document.createElement("div");
    qtyWrap.className = "cu-drawer-qty";

    var minusBtn = document.createElement("button");
    minusBtn.textContent = "\u2212";
    minusBtn.setAttribute("aria-label", "Decrease quantity");
    var qtySpan = document.createElement("span");
    qtySpan.textContent = String(item.quantity || 1);
    var plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Increase quantity");

    qtyWrap.appendChild(minusBtn);
    qtyWrap.appendChild(qtySpan);
    qtyWrap.appendChild(plusBtn);
    mid.appendChild(qtyWrap);
    row.appendChild(mid);

    /* Right: price + delete */
    var rt = document.createElement("div");
    rt.className = "cu-drawer-item-rt";

    var price = document.createElement("div");
    price.className = "cu-drawer-item-price";
    price.textContent = formatPrice(itemPrice);
    rt.appendChild(price);

    var delBtn = document.createElement("button");
    delBtn.className = "cu-drawer-item-del";
    delBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14M10 11v6M14 11v6"/></svg>';
    delBtn.setAttribute("aria-label", "Remove item");
    rt.appendChild(delBtn);
    row.appendChild(rt);

    /* Qty button handlers */
    (function (itemObj, cId, mBtn, pBtn, dBtn) {
      mBtn.addEventListener("click", function () {
        var newQty = (itemObj.quantity || 1) - 1;
        if (newQty < 1) {
          removeCartItem(cId, itemObj.id || itemObj.itemId || itemObj.item_id, function () { refreshDrawer(); });
        } else {
          updateCartItemQty(
            cId,
            itemObj.id || itemObj.itemId || itemObj.item_id,
            itemObj.productId || itemObj.product_id,
            newQty,
            function () { refreshDrawer(); }
          );
        }
      });
      pBtn.addEventListener("click", function () {
        var newQty = (itemObj.quantity || 1) + 1;
        updateCartItemQty(
          cId,
          itemObj.id || itemObj.itemId || itemObj.item_id,
          itemObj.productId || itemObj.product_id,
          newQty,
          function () { refreshDrawer(); }
        );
      });
      dBtn.addEventListener("click", function () {
        removeCartItem(cId, itemObj.id || itemObj.itemId || itemObj.item_id, function () { refreshDrawer(); });
      });
    })(item, cartId, minusBtn, plusBtn, delBtn);

    return row;
  }

  /* ─── Side Panel Recommendations ─── */

  function recsKey(allRecs) {
    var k = "";
    for (var i = 0; i < allRecs.length; i += 1) {
      var r = allRecs[i] || {};
      k += (firstNumeric(r.id || r.product_id || r.productId) || "") + ",";
    }
    return k;
  }

  var _addBagSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>';

  var _colorNameMap = {
    "black":"#000","white":"#fff","red":"#e53e3e","blue":"#3182ce","green":"#38a169",
    "yellow":"#ecc94b","orange":"#ed8936","purple":"#805ad5","pink":"#ed64a6",
    "grey":"#a0aec0","gray":"#a0aec0","brown":"#8b6914","navy":"#2a4365",
    "beige":"#f5f0e1","cream":"#fffdd0","silver":"#c0c0c0","gold":"#d4a017",
    "teal":"#319795","coral":"#f56565","ivory":"#fffff0","tan":"#d2b48c",
    "maroon":"#800000","olive":"#808000","aqua":"#00bcd4","charcoal":"#36454f",
    "burgundy":"#800020","khaki":"#c3b091","lavender":"#b794f4","mint":"#48bb78",
    "peach":"#fbb6ce","rust":"#b7410e","sage":"#87ae73","slate":"#708090",
    "wine":"#722f37","indigo":"#4c51bf","magenta":"#d53f8c","turquoise":"#38b2ac",
    "sand":"#c2b280","stone":"#928e85","natural":"#e8dcc8","denim":"#1560bd",
    "rose":"#f687b3","sky":"#63b3ed","forest":"#276749","chocolate":"#7b3f00",
    "espresso":"#3c1414","lemon":"#fefcbf","lilac":"#c4b5fd","mauve":"#d6bcfa",
    "pewter":"#96a3a6","plum":"#553c9a","smoke":"#a0aec0","steel":"#718096"
  };

  function resolveSwatchColor(label) {
    if (!label) return null;
    var lower = label.toLowerCase().trim();
    if (_colorNameMap[lower]) return _colorNameMap[lower];
    /* If it looks like a hex color */
    if (/^#[0-9a-f]{3,6}$/i.test(lower)) return lower;
    /* Multi-word: try each word */
    var words = lower.split(/[\s\/\-]+/);
    for (var w = 0; w < words.length; w++) {
      if (_colorNameMap[words[w]]) return _colorNameMap[words[w]];
    }
    return null;
  }

  function buildUnifiedCard(rec, layout) {
    var card = document.createElement("div");
    card.className = "cu-rcard";
    var recId = firstNumeric(rec.id || rec.product_id || rec.productId);
    if (recId) card.setAttribute("data-cu-rec-pid", recId);

    /* Selected variant tracking */
    var selectedVid = rec.variant_id || rec.variantId || "";

    /* Image wrapper */
    var imgWrap = document.createElement("div");
    imgWrap.className = "cu-rcard-img-wrap";
    if (rec.image) {
      var imgLink = document.createElement("a");
      imgLink.href = normalizeProductUrl(rec.handle);
      var img = document.createElement("img");
      img.className = "cu-rcard-img";
      img.src = rec.image;
      img.alt = String(rec.title || "Product");
      img.loading = "lazy";
      imgLink.appendChild(img);
      imgWrap.appendChild(imgLink);
    }
    card.appendChild(imgWrap);

    /* Info section */
    var info = document.createElement("div");
    info.className = "cu-rcard-info";

    /* Price + Add icon row */
    var row = document.createElement("div");
    row.className = "cu-rcard-row";
    var price = document.createElement("div");
    price.className = "cu-rcard-price";
    price.textContent = formatMoney(rec.price, getCurrencyCode());
    row.appendChild(price);

    var addBtn = null;
    if (recId) {
      addBtn = document.createElement("button");
      addBtn.className = "cu-rcard-add";
      addBtn.innerHTML = _addBagSvg;
      addBtn.setAttribute("aria-label", "Add to cart");
      imgWrap.appendChild(addBtn);
    }
    info.appendChild(row);

    /* Product name */
    var name = document.createElement("div");
    name.className = "cu-rcard-name";
    name.textContent = String(rec.title || "Product");
    info.appendChild(name);

    /* Option swatches / dropdowns */
    var variants = rec.variants || [];
    if (variants.length > 1) {
      /* Group option values by option_display_name */
      var optionGroups = {};
      var optionOrder = [];
      for (var vi = 0; vi < variants.length; vi++) {
        if (variants[vi].purchasing_disabled) continue;
        var ovs = variants[vi].option_values || [];
        for (var oi = 0; oi < ovs.length; oi++) {
          var optName = ovs[oi].option_display_name || "";
          if (!optionGroups[optName]) {
            optionGroups[optName] = { values: [], seen: {} };
            optionOrder.push(optName);
          }
          var lbl = ovs[oi].label;
          if (!optionGroups[optName].seen[lbl]) {
            optionGroups[optName].seen[lbl] = true;
            optionGroups[optName].values.push({ label: lbl, optionId: ovs[oi].option_id, valueId: ovs[oi].id });
          }
        }
      }

      if (optionOrder.length > 0) {
        var optsContainer = document.createElement("div");
        optsContainer.className = "cu-rcard-opts";

        for (var gi = 0; gi < optionOrder.length; gi++) {
          var gName = optionOrder[gi];
          var gVals = optionGroups[gName].values;
          var isColor = /colou?r/i.test(gName);

          if (isColor && gVals.length > 0) {
            /* Render color swatches */
            for (var si = 0; si < gVals.length && si < 6; si++) {
              var sw = document.createElement("span");
              sw.className = "cu-rcard-swatch" + (si === 0 ? " cu-rcard-swatch--active" : "");
              sw.title = gVals[si].label;
              var bgColor = resolveSwatchColor(gVals[si].label);
              sw.style.backgroundColor = bgColor || "#ccc";
              if (!bgColor) sw.textContent = gVals[si].label.charAt(0);
              /* Click to select variant */
              (function (swEl, optLabel, allVariants) {
                swEl.addEventListener("click", function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  /* Highlight active swatch */
                  var siblings = optsContainer.querySelectorAll(".cu-rcard-swatch");
                  for (var sx = 0; sx < siblings.length; sx++) siblings[sx].classList.remove("cu-rcard-swatch--active");
                  swEl.classList.add("cu-rcard-swatch--active");
                  /* Find matching variant */
                  for (var mv = 0; mv < allVariants.length; mv++) {
                    var ov = allVariants[mv].option_values || [];
                    for (var x = 0; x < ov.length; x++) {
                      if (ov[x].label === optLabel && !allVariants[mv].purchasing_disabled) {
                        selectedVid = allVariants[mv].id;
                        break;
                      }
                    }
                  }
                });
              })(sw, gVals[si].label, variants);
              optsContainer.appendChild(sw);
            }
          } else if (gVals.length > 1) {
            /* Render dropdown for non-color options */
            var sel = document.createElement("select");
            sel.className = "cu-rcard-opt-sel";
            sel.title = gName;
            for (var di = 0; di < gVals.length; di++) {
              var opt = document.createElement("option");
              opt.value = gVals[di].label;
              opt.textContent = gVals[di].label;
              sel.appendChild(opt);
            }
            (function (selEl, allVariants) {
              selEl.addEventListener("change", function () {
                var val = selEl.value;
                for (var mv = 0; mv < allVariants.length; mv++) {
                  var ov = allVariants[mv].option_values || [];
                  for (var x = 0; x < ov.length; x++) {
                    if (ov[x].label === val && !allVariants[mv].purchasing_disabled) {
                      selectedVid = allVariants[mv].id;
                      break;
                    }
                  }
                }
              });
            })(sel, variants);
            optsContainer.appendChild(sel);
          }
        }
        info.appendChild(optsContainer);
      }
    }

    card.appendChild(info);

    /* Add-to-cart click handler */
    if (addBtn && recId) {
      var recTitle = String(rec.title || "Product");
      (function (btn, pid, cardEl, title) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          btn.disabled = true;
          trackEvent("click", pid, title);
          var lineItem = { quantity: 1, productId: Number(pid) };
          var vid = selectedVid;
          if (vid) lineItem.variantId = Number(vid);

          function onAdded() {
            trackEvent("add_to_cart", pid, title);
            cardEl.classList.add("cu-rcard--out");
            setTimeout(function () {
              cardEl.classList.remove("cu-rcard--out");
              cardEl.classList.add("cu-rcard--hidden");
              btn.disabled = false;
              refreshDrawer();
            }, 320);
          }
          function onFailed() { btn.disabled = false; }

          addItemToCart([lineItem], function (ok) {
            if (ok) { onAdded(); }
            else if (_scriptUrl && _storeHash) {
              var prodUrl = _scriptUrl.origin +
                "/apps/proxy/api/products?store_hash=" + encodeURIComponent(_storeHash) +
                "&product_id=" + encodeURIComponent(pid);
              fetchJson(prodUrl).then(function (pData) {
                var product = null;
                if (pData && Array.isArray(pData.products)) {
                  for (var pi = 0; pi < pData.products.length; pi++) {
                    if (String(pData.products[pi].id) === String(pid)) { product = pData.products[pi]; break; }
                  }
                  if (!product && pData.products.length > 0) product = pData.products[0];
                } else if (pData && pData.product) {
                  product = pData.product;
                }
                var vars = product && Array.isArray(product.variants) ? product.variants : [];
                var firstVar = vars.length > 0 ? vars[0] : null;
                var fetchedVid = firstVar ? Number(firstVar.id || firstVar.variant_id) : 0;
                if (fetchedVid) {
                  addItemToCart([{ quantity: 1, productId: Number(pid), variantId: fetchedVid }], function (ok2) {
                    if (ok2) { onAdded(); } else { onFailed(); }
                  });
                } else { onFailed(); }
              }).catch(function () { onFailed(); });
            } else { onFailed(); }
          });
        });
      })(addBtn, recId, card, recTitle);
    }

    return card;
  }

  /* Legacy alias for side cards — now uses unified builder */
  function buildSideCard(rec) { return buildUnifiedCard(rec, "side"); }

  function renderSideRecs(allRecs, cartPidSet) {
    if (!_sideBody) return;
    var key = recsKey(allRecs);

    /* Rebuild if recs changed */
    if (_recsBuiltKey !== key && allRecs.length > 0) {
      _sideBody.innerHTML = "";

      var visCount = 0;
      for (var i = 0; i < allRecs.length; i += 1) {
        var card = buildSideCard(allRecs[i]);
        var cpid = card.getAttribute("data-cu-rec-pid");
        if (cpid && cartPidSet && cartPidSet[cpid]) {
          card.classList.add("cu-rcard--hidden");
        } else {
          visCount += 1;
        }
        _sideBody.appendChild(card);
      }

      _recsBuiltKey = key;
      if (_sidePanel) _sidePanel.style.display = visCount > 0 ? "flex" : "none";
      if (visCount > 0) trackImpressions(allRecs);
      return;
    }

    /* Toggle visibility on existing cards */
    var cards = _sideBody.querySelectorAll(".cu-rcard[data-cu-rec-pid]");
    var visibleCount = 0;

    for (var j = 0; j < cards.length; j += 1) {
      var pid = cards[j].getAttribute("data-cu-rec-pid");
      var inCart = cartPidSet && cartPidSet[pid];
      var wasHidden = cards[j].classList.contains("cu-rcard--hidden");

      if (inCart && !wasHidden) {
        cards[j].classList.add("cu-rcard--hidden");
        cards[j].classList.remove("cu-rcard--out");
        cards[j].classList.remove("cu-rcard--reveal");
      } else if (!inCart && wasHidden) {
        cards[j].classList.remove("cu-rcard--hidden");
        cards[j].classList.remove("cu-rcard--out");
        cards[j].classList.add("cu-rcard--reveal");
        visibleCount += 1;
      } else if (!inCart) {
        cards[j].classList.remove("cu-rcard--out");
        visibleCount += 1;
      }
    }

    if (_sidePanel) _sidePanel.style.display = visibleCount > 0 ? "flex" : "none";
  }

  /* ─── Bottom Recs (horizontal scroll inside cart body) ─── */

  function buildRecCard(rec) { return buildUnifiedCard(rec, "bottom"); }

  var _bottomRecsKey = "";

  function renderDrawerRecs(allRecs, cartPidSet) {
    if (!_drawerBody) return;
    var section = _drawerBody.querySelector(".cu-drawer-recs");
    var key = recsKey(allRecs);

    if ((_bottomRecsKey !== key || !section) && allRecs.length > 0) {
      if (section) section.remove();
      section = document.createElement("div");
      section.className = "cu-drawer-recs";

      var hd = document.createElement("div");
      hd.className = "cu-drawer-recs-hd";
      var h3 = document.createElement("h3");
      h3.textContent = _recsTitle;
      hd.appendChild(h3);
      section.appendChild(hd);

      var scroll = document.createElement("div");
      scroll.className = "cu-drawer-recs-scroll";
      var visCards = 0;
      for (var i = 0; i < allRecs.length; i += 1) {
        var card = buildRecCard(allRecs[i]);
        var cpid = card.getAttribute("data-cu-rec-pid");
        if (cpid && cartPidSet && cartPidSet[cpid]) {
          card.classList.add("cu-rcard--hidden");
        } else { visCards += 1; }
        scroll.appendChild(card);
      }
      section.appendChild(scroll);
      _drawerBody.appendChild(section);
      _bottomRecsKey = key;
      section.style.display = visCards > 0 ? "" : "none";
      if (visCards > 0) trackImpressions(allRecs);
      return;
    }

    if (!section) return;
    var cards = section.querySelectorAll(".cu-rcard[data-cu-rec-pid]");
    var visibleCount = 0;
    for (var j = 0; j < cards.length; j += 1) {
      var pid = cards[j].getAttribute("data-cu-rec-pid");
      var inCart = cartPidSet && cartPidSet[pid];
      var wasHidden = cards[j].classList.contains("cu-rcard--hidden");
      if (inCart && !wasHidden) {
        cards[j].classList.add("cu-rcard--hidden");
        cards[j].classList.remove("cu-rcard--out");
      } else if (!inCart && wasHidden) {
        cards[j].classList.remove("cu-rcard--hidden");
        cards[j].classList.add("cu-rcard--reveal");
        visibleCount += 1;
      } else if (!inCart) { visibleCount += 1; }
    }
    section.style.display = visibleCount > 0 ? "" : "none";
  }

  /* Router — delegates to the correct render based on settings */
  function renderRecs(allRecs, cartPidSet) {
    if (_recsPosition === "side") {
      /* On mobile with "all_devices" mode, render as bottom horizontal scroll */
      var isMobile = window.innerWidth <= 768;
      if (isMobile && _sideDeviceMode === "all_devices") {
        renderDrawerRecs(allRecs, cartPidSet);
        if (_sidePanel) _sidePanel.style.display = "none";
      } else {
        if (_sidePanel) _sidePanel.style.display = "flex";
        renderSideRecs(allRecs, cartPidSet);
        /* Clear any bottom recs */
        var oldBottom = _drawerBody && _drawerBody.querySelector(".cu-drawer-recs");
        if (oldBottom) oldBottom.remove();
      }
    } else {
      renderDrawerRecs(allRecs, cartPidSet);
      /* Hide side panel */
      if (_sidePanel) _sidePanel.style.display = "none";
    }
  }

  /* ─── Intercepts ─── */
  function interceptAddToCart() {
    document.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form || !form.matches) return;
      if (!form.matches('form[data-cart-item-add], form[action*="/cart.php"]')) return;

      /* Check this is actually an add-to-cart, not coupon etc */
      var actionInput = form.querySelector('input[name="action"]');
      if (actionInput && actionInput.value !== "add") return;

      var productIdInput = form.querySelector('input[name="product_id"]');
      var productId = productIdInput ? Number(productIdInput.value) : null;
      if (!productId) return; /* let default handle it */

      e.preventDefault();
      e.stopPropagation();

      var qty = 1;
      var qtyInput = form.querySelector('input[name="qty[]"], input[name="quantity"], input[name="qty"]');
      if (qtyInput) qty = Number(qtyInput.value) || 1;

      /* Extract option selections for variants */
      var optionSelections = [];
      var selects = form.querySelectorAll('select[name^="attribute["]');
      for (var i = 0; i < selects.length; i += 1) {
        var sm = selects[i].name.match(/attribute\[(\d+)\]/);
        if (sm && selects[i].value) {
          optionSelections.push({ optionId: Number(sm[1]), optionValue: Number(selects[i].value) });
        }
      }
      var radios = form.querySelectorAll('input[type="radio"][name^="attribute["]:checked');
      for (var j = 0; j < radios.length; j += 1) {
        var rm = radios[j].name.match(/attribute\[(\d+)\]/);
        if (rm && radios[j].value) {
          optionSelections.push({ optionId: Number(rm[1]), optionValue: Number(radios[j].value) });
        }
      }

      var lineItem = { quantity: qty, productId: productId };
      if (optionSelections.length > 0) lineItem.optionSelections = optionSelections;

      /* Visual feedback on the submit button */
      var submitBtn = form.querySelector('[type="submit"], .form-action-addToCart, #form-action-addToCart, button.add-to-cart-button');
      var origText = submitBtn ? submitBtn.value || submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        if (submitBtn.value) submitBtn.value = "Adding...";
        else submitBtn.textContent = "Adding...";
      }

      addItemToCart([lineItem], function (ok) {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtn.value !== undefined && origText) submitBtn.value = origText;
          else if (origText) submitBtn.textContent = origText;
        }
        if (ok) {
          openDrawer();
        } else {
          /* Fallback: submit form normally if API fails */
          warn("Drawer add-to-cart failed, submitting form normally");
          form.submit();
        }
      });
    }, true);
  }

  function interceptCartIcon() {
    document.addEventListener("click", function (e) {
      var target = e.target;
      var link = null;

      /* Walk up to find a matching anchor */
      var node = target;
      for (var depth = 0; node && depth < 6; depth += 1) {
        if (node.tagName === "A" || node.matches) {
          try {
            if (node.matches && node.matches(
              'a[href*="/cart.php"], a[href="/cart"], .navUser-action--cart, [data-cart-preview], .navUser-item--cart a'
            )) {
              link = node;
              break;
            }
          } catch (_err) { /* ignore */ }
        }
        node = node.parentElement;
      }

      if (!link) return;

      /* Don't intercept checkout links */
      var href = link.getAttribute("href") || "";
      if (href.indexOf("/checkout") !== -1) return;

      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    }, true);
  }

  /* ─── Main Run ─── */
  var lastKey = "";
  var isRendering = false;

  function run() {
    if (isRendering) return;
    isRendering = true;

    var scriptUrl = getScriptUrl("/storefront/cart-uplift.js");
    _scriptUrl = scriptUrl;
    var storeHash = detectStoreHash(scriptUrl);
    _storeHash = storeHash;

    if (!storeHash) {
      warn("Missing store hash, skipping render");
      isRendering = false;
      return;
    }

    /* Start prewarming recs immediately (don't wait for settings) */
    prewarmRecommendations();
    /* Fetch store settings (once) for shipping bar, recs title, etc. */
    fetchStoreSettings();

    var cartPage = isCartPage();

    Promise.all([
      waitForValue(detectProductId, cartPage ? 2000 : 9000, 350),
      fetchCartProductIds().then(function (apiIds) {
        if (apiIds.length > 0) return apiIds;
        var domIds = detectCartProductIds();
        return domIds.length > 0 ? domIds : [];
      }),
    ])
    .then(function (values) {
      var productId = values[0] || "";
      var cartIds = Array.isArray(values[1]) ? values[1] : [];
      var context = productId ? "product" : (cartPage || cartIds.length > 0) ? "cart" : "";

      log("Context:", context, "productId:", productId, "cartIds:", cartIds, "isCartPage:", cartPage);

      if (!context) {
        log("No product/cart context found");
        return;
      }

      var key = [storeHash, context, productId, cartIds.join(",")].join("|");
      if (key === lastKey) return;
      lastKey = key;

      /* ─── Co-view tracking: fire product_view once per product per session ─── */
      if (context === "product" && productId && !_trackedViews[productId]) {
        _trackedViews[productId] = true;
        trackEvent("product_view", productId, "", { source: "product_page" });
      }

      var limit = context === "cart" ? 6 : 4;

      /* Only render inline recommendations on product pages */
      if (context === "product") {
        fetchRecommendationsWithFallback(scriptUrl, storeHash, productId, cartIds, context, limit).then(
          function (recs) {
            var mounted = renderRecommendations(recs, context);
            if (!mounted) log("No inline recommendations rendered", { context: context, count: recs.length });
          }
        );
      }
    })
    .finally(function () {
      isRendering = false;
    });
  }

  function watchDom() {
    if (!window.MutationObserver) return;
    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { run(); }, 400);
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  /* Expose openDrawer globally so bundles script can use it */
  window.__cuOpenDrawer = openDrawer;

  /* ─── Initialize ─── */
  function init() {
    createDrawerShell();
    interceptAddToCart();
    interceptCartIcon();
    run();
    watchDom();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); });
  } else {
    init();
  }

  window.addEventListener("load", function () {
    setTimeout(run, 250);
    setTimeout(run, 1200);
  });
})();`;

const CART_BUNDLES_SCRIPT = String.raw`(function () {
  if (window.__cartUpliftBundlesBooted) return;
  window.__cartUpliftBundlesBooted = true;

  var DEBUG = (function () {
    try {
      var qp = new URL(window.location.href).searchParams;
      return qp.get("cu_debug") === "1" || window.localStorage.getItem("cu_debug") === "1";
    } catch (_err) {
      return false;
    }
  })();

  function log() {
    if (!DEBUG || !window.console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CartUplift Bundles]");
    console.log.apply(console, args);
  }

  function warn() {
    if (!window.console || !console.warn) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[CartUplift Bundles]");
    console.warn.apply(console, args);
  }

  function findScriptByPath(path) {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      var src = scripts[i] && scripts[i].src ? scripts[i].src : "";
      if (src.indexOf(path) !== -1) return scripts[i];
    }
    return null;
  }

  function getScriptUrl(path) {
    var scriptEl = document.currentScript || findScriptByPath(path);
    var src = scriptEl && scriptEl.src ? scriptEl.src : window.location.origin + path;
    try {
      return new URL(src, window.location.href);
    } catch (_err) {
      return new URL(window.location.href);
    }
  }

  function firstNumeric(value) {
    var raw = String(value || "").trim();
    if (/^\d+$/.test(raw)) return raw;
    var match = raw.match(/\b(\d{2,})\b/);
    return match ? match[1] : "";
  }

  function readMeta(names) {
    for (var i = 0; i < names.length; i += 1) {
      var meta = document.querySelector('meta[name="' + names[i] + '"]');
      var content = meta && meta.getAttribute("content");
      if (content && /^[a-z0-9]{5,20}$/i.test(content)) {
        return content;
      }
    }
    return "";
  }

  function detectStoreHash(scriptUrl) {
    var fromSrc = scriptUrl.searchParams.get("store_hash") || scriptUrl.searchParams.get("shop");
    if (fromSrc && /^[a-z0-9]{5,20}$/i.test(fromSrc)) return fromSrc;

    var bcData = window.BCData || window.bcData || {};
    var fromGlobal =
      bcData.store_hash ||
      bcData.storeHash ||
      (bcData.context && (bcData.context.store_hash || bcData.context.storeHash));
    if (fromGlobal && /^[a-z0-9]{5,20}$/i.test(String(fromGlobal))) {
      return String(fromGlobal);
    }

    var fromMeta = readMeta(["bc-store-hash", "store-hash", "bigcommerce-store-hash"]);
    if (fromMeta) return fromMeta;

    var match = (window.location.hostname || "").match(/^store-([a-z0-9]+)\.mybigcommerce\.com$/i);
    return match && match[1] ? match[1] : "";
  }

  function detectProductId() {
    var parsed = null;
    try {
      parsed = new URL(window.location.href);
    } catch (_err) {
      parsed = null;
    }

    if (parsed) {
      var urlId = firstNumeric(parsed.searchParams.get("product_id") || parsed.searchParams.get("pid"));
      if (urlId) return urlId;
    }

    var bcData = window.BCData || window.bcData || {};
    var globalId =
      firstNumeric(bcData.product_id) ||
      firstNumeric(bcData.productId) ||
      firstNumeric(bcData.product && (bcData.product.id || bcData.product.entityId));
    if (globalId) return globalId;

    var selectors = [
      'input[name="product_id"]',
      'input[name="product-id"]',
      '[data-product-id]',
      '[data-entity-id]',
      '[data-product-entity-id]',
      '[data-product-view] [data-product-id]',
      '[data-product-view] [data-entity-id]',
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var node = document.querySelector(selectors[i]);
      if (!node) continue;

      var id =
        firstNumeric(node.value) ||
        firstNumeric(node.getAttribute("data-product-id")) ||
        firstNumeric(node.getAttribute("data-entity-id")) ||
        firstNumeric(node.getAttribute("data-product-entity-id"));

      if (id) return id;
    }

    var scripts = document.querySelectorAll('script[type="application/ld+json"], script:not([src])');
    for (var j = 0; j < scripts.length; j += 1) {
      var text = scripts[j] && scripts[j].textContent ? scripts[j].textContent : "";
      if (!text) continue;
      var match = text.match(/"(?:product_id|productId|entityId|productID)"\s*[:=]\s*"?(\d{2,})"?/i);
      if (match && match[1]) return match[1];
    }

    return "";
  }

  function waitForProductId(timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      var started = Date.now();

      function tick() {
        var id = detectProductId();
        if (id) {
          resolve(id);
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          resolve("");
          return;
        }

        setTimeout(tick, intervalMs);
      }

      tick();
    });
  }

  function getCurrencyCode() {
    if (window.__cuCurrency) return String(window.__cuCurrency).toUpperCase();
    var bcData = window.BCData || window.bcData || {};
    var code =
      (bcData.currency && bcData.currency.code) ||
      (bcData.shopSettings && bcData.shopSettings.currency) ||
      "GBP";
    return String(code || "GBP").toUpperCase();
  }

  function formatMoney(valueInCents) {
    var amount = Number(valueInCents) / 100;
    if (!isFinite(amount)) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: getCurrencyCode(),
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (_err) {
      return getCurrencyCode() === "GBP" ? "\u00a3" + amount.toFixed(2) : "$" + amount.toFixed(2);
    }
  }

  function ensureStyles() {
    if (document.getElementById("cu-bundles-style")) return;
    var style = document.createElement("style");
    style.id = "cu-bundles-style";
    style.textContent =
      ".cu-bundle-wrap{border:2px solid #2563eb;border-radius:8px;padding:16px 20px;margin-top:18px;background:#f0f6ff}" +
      ".cu-bundle-title{margin:0 0 12px;font-size:16px;line-height:1.3;color:#111827;font-weight:700}" +
      ".cu-bundle-products{display:flex;align-items:center;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px}" +
      ".cu-bundle-product{display:flex;flex-direction:column;align-items:center;min-width:90px;max-width:110px;text-align:center}" +
      ".cu-bundle-thumb{width:80px;height:80px;object-fit:contain;background:#fff;border:1px solid #e5e7eb;border-radius:6px}" +
      ".cu-bundle-name{font-size:11px;line-height:1.2;color:#374151;margin-top:4px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".cu-bundle-price{font-size:11px;color:#6b7280;font-weight:600}" +
      ".cu-bundle-plus{font-size:20px;color:#9ca3af;font-weight:700;flex-shrink:0;padding:0 2px}" +
      ".cu-bundle-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}" +
      ".cu-bundle-savings{font-size:14px;color:#059669;font-weight:600}" +
      ".cu-bundle-btn{display:inline-block;padding:10px 24px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;border:none;border-radius:6px;cursor:pointer;white-space:nowrap;text-align:center;transition:background 0.15s}" +
      ".cu-bundle-btn:hover{background:#1d4ed8}" +
      ".cu-bundle-btn:disabled{background:#94a3b8;cursor:not-allowed}" +
      ".cu-bundle-btn--success{background:#059669}" +
      ".cu-bundle-btn--success:hover{background:#059669}";
    document.head.appendChild(style);
  }

  function mountNode() {
    return (
      document.querySelector(".productView-details") ||
      document.querySelector(".productView-description") ||
      document.querySelector(".productView") ||
      document.querySelector("main")
    );
  }

  function addBundleToCart(products, btn) {
    btn.disabled = true;
    btn.textContent = "Adding...";

    var lineItems = [];
    for (var i = 0; i < products.length; i += 1) {
      var p = products[i] || {};
      var pid = Number(p.id || p.product_id || p.productId);
      if (!pid) continue;
      var item = { quantity: 1, productId: pid };
      /* Include variantId when available — required for products with options */
      var vid = Number(p.variant_id || p.variantId || p.variant_id);
      if (vid) item.variantId = vid;
      lineItems.push(item);
    }

    if (lineItems.length === 0) {
      btn.textContent = "Error";
      return;
    }

    /* Helper: get or create cart, returns cartId */
    function getOrCreateCartId() {
      return fetch("/api/storefront/carts", {
        method: "GET", credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (carts) {
        return Array.isArray(carts) && carts.length > 0 ? carts[0].id : null;
      });
    }

    /* Helper: add a batch of line items to existing or new cart */
    function addItems(cartId, items) {
      if (cartId) {
        return fetch("/api/storefront/carts/" + cartId + "/items", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ lineItems: items }),
        });
      } else {
        return fetch("/api/storefront/carts", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ lineItems: items }),
        });
      }
    }

    /* Try bulk add first, fall back to one-by-one */
    getOrCreateCartId()
      .then(function (cartId) {
        return addItems(cartId, lineItems).then(function (res) {
          if (res.ok) return { added: lineItems.length, total: lineItems.length };
          /* Bulk failed — try one at a time (products with required options will fail) */
          warn("Bulk add failed, trying individually...");
          var added = 0;
          var chain = Promise.resolve();
          for (var k = 0; k < lineItems.length; k += 1) {
            (function (item) {
              chain = chain.then(function () {
                return getOrCreateCartId().then(function (cId) {
                  return addItems(cId, [item]).then(function (r) {
                    if (r.ok) added += 1;
                    else warn("Skipping product " + item.productId + " (requires options)");
                  });
                });
              });
            })(lineItems[k]);
          }
          return chain.then(function () { return { added: added, total: lineItems.length }; });
        });
      })
      .then(function (result) {
        if (result.added > 0) {
          btn.textContent = result.added === result.total
            ? "Added to Cart!"
            : "Added " + result.added + " of " + result.total + "!";
          btn.className = "cu-bundle-btn cu-bundle-btn--success";
          if (window.__cartUpliftRecsBooted && typeof window.__cuOpenDrawer === "function") {
            setTimeout(function () { window.__cuOpenDrawer(); }, 300);
          } else {
            setTimeout(function () { window.location.reload(); }, 1500);
          }
        } else {
          btn.textContent = "Failed - Try Again";
          btn.disabled = false;
        }
      })
      .catch(function (err) {
        warn("Add bundle to cart error", err);
        btn.textContent = "Failed - Try Again";
        btn.disabled = false;
      });
  }

  function renderBundle(data) {
    var bundles = data && Array.isArray(data.bundles) ? data.bundles : [];
    if (bundles.length === 0) return false;

    var bundle = bundles[0] || {};
    var products = Array.isArray(bundle.products) ? bundle.products : [];
    if (products.length < 2) return false;

    var mount = mountNode();
    if (!mount) return false;

    var host = document.getElementById("cartuplift-bundles");
    if (host) host.remove();

    ensureStyles();
    host = document.createElement("section");
    host.id = "cartuplift-bundles";
    host.className = "cu-bundle-wrap";

    var title = document.createElement("h3");
    title.className = "cu-bundle-title";
    title.textContent = "Frequently Bought Together";
    host.appendChild(title);

    var row = document.createElement("div");
    row.className = "cu-bundle-products";

    for (var i = 0; i < products.length; i += 1) {
      if (i > 0) {
        var plus = document.createElement("span");
        plus.className = "cu-bundle-plus";
        plus.textContent = "+";
        row.appendChild(plus);
      }

      var item = products[i] || {};
      var product = document.createElement("div");
      product.className = "cu-bundle-product";

      if (item.image || item.image_url) {
        var img = document.createElement("img");
        img.className = "cu-bundle-thumb";
        img.src = item.image || item.image_url;
        img.alt = String(item.title || "Product");
        img.loading = "lazy";
        product.appendChild(img);
      }

      var name = document.createElement("div");
      name.className = "cu-bundle-name";
      name.title = String(item.title || "Product");
      name.textContent = String(item.title || "Product");
      product.appendChild(name);

      var price = document.createElement("div");
      price.className = "cu-bundle-price";
      price.textContent = formatMoney(item.price);
      product.appendChild(price);

      row.appendChild(product);
    }

    host.appendChild(row);

    var footer = document.createElement("div");
    footer.className = "cu-bundle-footer";

    var savingsAmount = bundle.savings_amount || 0;
    if (savingsAmount > 0) {
      var savings = document.createElement("div");
      savings.className = "cu-bundle-savings";
      savings.textContent = "Save " + formatMoney(savingsAmount) + " when you buy together";
      footer.appendChild(savings);
    }

    var btn = document.createElement("button");
    btn.className = "cu-bundle-btn";
    btn.textContent = "Add All " + products.length + " to Cart";
    btn.addEventListener("click", function () {
      addBundleToCart(products, btn);
    });
    footer.appendChild(btn);

    host.appendChild(footer);
    mount.appendChild(host);
    return true;
  }

  function fetchJson(url) {
    return fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  var lastKey = "";
  var inFlight = false;

  function run() {
    if (inFlight) return;
    inFlight = true;

    var scriptUrl = getScriptUrl("/storefront/cart-bundles.js");
    var storeHash = detectStoreHash(scriptUrl);

    if (!storeHash) {
      warn("Missing store hash, skipping bundle render");
      inFlight = false;
      return;
    }

    waitForProductId(9000, 350)
      .then(function (productId) {
        if (!productId) {
          log("No product ID found for bundles");
          return;
        }

        var key = [storeHash, productId].join("|");
        if (key === lastKey) return;
        lastKey = key;

        var apiUrl =
          scriptUrl.origin +
          "/apps/proxy/api/bundles?store_hash=" +
          encodeURIComponent(storeHash) +
          "&product_id=" +
          encodeURIComponent(productId) +
          "&context=product";

        return fetchJson(apiUrl)
          .then(function (data) {
            if (data && data.currency) window.__cuCurrency = data.currency;
            var mounted = renderBundle(data);
            if (!mounted) {
              log("No bundles rendered for product", productId);
            }
          })
          .catch(function (err) {
            warn("Bundles failed", err);
          });
      })
      .finally(function () {
        inFlight = false;
      });
  }

  function watchDom() {
    if (!window.MutationObserver) return;

    var timer = null;
    var observer = new MutationObserver(function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 450);
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      run();
      watchDom();
    });
  } else {
    run();
    watchDom();
  }

  window.addEventListener("load", function () {
    setTimeout(run, 250);
    setTimeout(run, 1200);
  });
})();`;

export async function loader({ params }: LoaderFunctionArgs) {
  const script = params.script;

  if (script === "cart-uplift.js") {
    return new Response(CART_UPLIFT_SCRIPT, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  if (script === "cart-bundles.js") {
    return new Response(CART_BUNDLES_SCRIPT, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  return new Response("Not found", { status: 404 });
}
