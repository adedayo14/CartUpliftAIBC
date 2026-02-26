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
      if (!Array.isArray(carts) || carts.length === 0) return ids;
      var cart = carts[0];
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

  function fetchFullCart() {
    return fetch("/api/storefront/carts?include=lineItems.physicalItems.options,lineItems.digitalItems.options", {
      method: "GET", credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (carts) {
      if (!Array.isArray(carts) || carts.length === 0) return null;
      var cart = carts[0];
      if (cart && cart.currency && cart.currency.code) {
        window.__cuCurrency = cart.currency.code;
      }
      return cart;
    })
    .catch(function (err) { warn("fetchFullCart error:", err); return null; });
  }

  function addItemToCart(lineItems, callback) {
    fetch("/api/storefront/carts", {
      method: "GET", credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (carts) {
      var cartId = Array.isArray(carts) && carts.length > 0 ? carts[0].id : null;
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
      if (res.ok) { if (callback) callback(true); }
      else {
        res.json().catch(function () { return {}; }).then(function (err) {
          warn("addItemToCart failed:", err);
          if (callback) callback(false);
        });
      }
    })
    .catch(function (err) { warn("addItemToCart error:", err); if (callback) callback(false); });
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
      ".cu-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:99998;opacity:0;visibility:hidden;transition:opacity .3s,visibility .3s}" +
      ".cu-overlay--open{opacity:1;visibility:visible}" +
      ".cu-drawer{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:100vw;background:#fff;z-index:99999;transform:translateX(100%);transition:transform .3s ease;display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,.15)}" +
      ".cu-drawer--open{transform:translateX(0)}" +

      /* Drawer header */
      ".cu-drawer-hd{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #e5e7eb;flex-shrink:0}" +
      ".cu-drawer-hd h2{margin:0;font-size:15px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#111}" +
      ".cu-drawer-x{background:none;border:none;font-size:26px;cursor:pointer;color:#111;padding:0;line-height:1}" +

      /* Drawer body (scrollable) */
      ".cu-drawer-bd{flex:1 1 0%;overflow-y:auto;min-height:0;display:flex;flex-direction:column}" +

      /* Cart items */
      ".cu-drawer-item{display:flex;align-items:flex-start;gap:12px;padding:16px 20px;border-bottom:1px solid #f3f4f6}" +
      ".cu-drawer-item-img{width:72px;height:72px;object-fit:cover;background:#f9fafb;border:1px solid #e5e7eb;flex-shrink:0}" +
      ".cu-drawer-item-mid{flex:1;min-width:0}" +
      ".cu-drawer-item-name{font-size:12px;font-weight:700;color:#111;text-transform:uppercase;line-height:1.3;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".cu-drawer-qty{display:inline-flex;align-items:center;border:1px solid #d1d5db;border-radius:20px;overflow:hidden}" +
      ".cu-drawer-qty button{background:none;border:none;padding:4px 10px;font-size:14px;cursor:pointer;color:#374151;line-height:1}" +
      ".cu-drawer-qty button:hover{background:#f3f4f6}" +
      ".cu-drawer-qty span{padding:2px 6px;font-size:13px;min-width:20px;text-align:center}" +
      ".cu-drawer-item-rt{display:flex;flex-direction:column;align-items:flex-end;gap:12px;flex-shrink:0}" +
      ".cu-drawer-item-price{font-size:14px;font-weight:600;color:#111}" +
      ".cu-drawer-item-del{background:none;border:none;cursor:pointer;font-size:18px;color:#9ca3af;padding:2px;line-height:1}" +
      ".cu-drawer-item-del:hover{color:#ef4444}" +

      /* Drawer recs */
      ".cu-drawer-recs{padding:16px 20px;border-top:1px solid #e5e7eb;margin-top:auto}" +
      ".cu-drawer-recs-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}" +
      ".cu-drawer-recs-hd h3{margin:0;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#111}" +
      ".cu-drawer-recs-scroll{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}" +
      ".cu-drawer-rc{flex:0 0 150px;scroll-snap-align:start;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px;text-align:center;display:flex;flex-direction:column;align-items:center}" +
      ".cu-drawer-rc-img{width:100%;height:90px;object-fit:contain;margin-bottom:6px;border-radius:4px}" +
      ".cu-drawer-rc-name{font-size:11px;color:#111;font-weight:500;line-height:1.3;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:28px}" +
      ".cu-drawer-rc-price{font-size:12px;font-weight:600;color:#111;margin-bottom:8px}" +
      ".cu-drawer-rc-add{display:inline-block;padding:6px 18px;background:#111;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s}" +
      ".cu-drawer-rc-add:hover{background:#333}" +
      ".cu-drawer-rc-add:disabled{background:#94a3b8;cursor:not-allowed}" +

      /* Drawer footer */
      ".cu-drawer-ft{border-top:1px solid #e5e7eb;padding:16px 20px;flex-shrink:0;background:#fff}" +
      ".cu-drawer-sub{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}" +
      ".cu-drawer-sub span{font-size:16px;font-weight:700;color:#111}" +
      ".cu-drawer-checkout{display:block;width:100%;padding:14px;text-align:center;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:.5px;border:none;border-radius:0;cursor:pointer;text-transform:uppercase;box-sizing:border-box}" +
      ".cu-drawer-checkout:hover{background:#333}" +

      /* Empty */
      ".cu-drawer-empty{padding:40px 20px;text-align:center;color:#6b7280;font-size:14px}" +

      /* Mobile */
      "@media (max-width:480px){.cu-drawer{width:100vw}}";
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
        (function (btn, pid) {
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            btn.disabled = true;
            btn.textContent = "Adding...";
            addItemToCart([{ quantity: 1, productId: Number(pid) }], function (ok) {
              if (ok) {
                btn.textContent = "Added!";
                setTimeout(function () { btn.textContent = "Add"; btn.disabled = false; }, 2000);
                openDrawer();
              } else {
                btn.textContent = "Add";
                btn.disabled = false;
                window.location.href = normalizeProductUrl(rec.handle);
              }
            });
          });
        })(addBtn, recId);
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
        var fallbackProductId = productId || (cartIds && cartIds.length ? cartIds[0] : "");
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
              return mapBundlesToRecommendations(bundleData, fallbackProductId, limit);
            })
            .catch(function () { return []; });
        }
        if (context === "cart") {
          var trendingUrl =
            scriptUrl.origin +
            "/apps/proxy/api/recommendations?store_hash=" +
            encodeURIComponent(storeHash) +
            "&limit=" + String(limit) + "&context=trending";
          return fetchJson(trendingUrl)
            .then(function (td) {
              if (td && td.currency) window.__cuCurrency = td.currency;
              return td && Array.isArray(td.recommendations) ? td.recommendations : [];
            })
            .catch(function () { return []; });
        }
        return recs;
      })
      .catch(function (err) { warn("Recommendations failed", err); return []; });
  }

  /* ════════════════════════════════════════════════════════
     ─── CART DRAWER ───
     ════════════════════════════════════════════════════════ */

  var _overlay = null;
  var _drawer = null;
  var _drawerBody = null;
  var _drawerItemCount = null;
  var _drawerSubtotalEl = null;
  var _scriptUrl = null;
  var _storeHash = "";
  var _drawerRecs = [];

  function getCartItems(cart) {
    if (!cart || !cart.lineItems) return [];
    var out = [];
    var cats = ["physicalItems", "digitalItems", "customItems"];
    for (var c = 0; c < cats.length; c += 1) {
      var items = cart.lineItems[cats[c]];
      if (Array.isArray(items)) {
        for (var i = 0; i < items.length; i += 1) out.push(items[i]);
      }
    }
    return out;
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

    _drawer = document.createElement("div");
    _drawer.className = "cu-drawer";

    /* Header */
    var hd = document.createElement("div");
    hd.className = "cu-drawer-hd";
    var h2 = document.createElement("h2");
    _drawerItemCount = h2;
    h2.textContent = "CART";
    hd.appendChild(h2);
    var xBtn = document.createElement("button");
    xBtn.className = "cu-drawer-x";
    xBtn.innerHTML = "&times;";
    xBtn.setAttribute("aria-label", "Close cart");
    xBtn.addEventListener("click", closeDrawer);
    hd.appendChild(xBtn);
    _drawer.appendChild(hd);

    /* Body (scrollable) */
    _drawerBody = document.createElement("div");
    _drawerBody.className = "cu-drawer-bd";
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

    document.body.appendChild(_overlay);
    document.body.appendChild(_drawer);
  }

  function openDrawer() {
    createDrawerShell();
    document.body.style.overflow = "hidden";
    _overlay.classList.add("cu-overlay--open");
    _drawer.classList.add("cu-drawer--open");
    refreshDrawer();
  }

  function closeDrawer() {
    if (!_overlay) return;
    document.body.style.overflow = "";
    _overlay.classList.remove("cu-overlay--open");
    _drawer.classList.remove("cu-drawer--open");
  }

  function refreshDrawer() {
    log("Refreshing drawer...");
    fetchFullCart().then(function (cart) {
      var items = getCartItems(cart);
      var totalQty = getCartTotalQty(cart);

      /* Update header count */
      if (_drawerItemCount) {
        _drawerItemCount.textContent = "CART (" + totalQty + ")";
      }
      updateHeaderCartCount(totalQty);

      /* Update subtotal */
      if (_drawerSubtotalEl) {
        _drawerSubtotalEl.textContent = cart ? formatPrice(cart.cartAmount || 0) : formatPrice(0);
      }

      /* Render body */
      if (!_drawerBody) return;
      _drawerBody.innerHTML = "";

      if (!cart || items.length === 0) {
        var empty = document.createElement("div");
        empty.className = "cu-drawer-empty";
        empty.textContent = "Your cart is empty";
        _drawerBody.appendChild(empty);
        renderDrawerRecs([]);
        return;
      }

      /* Cart items */
      var cartId = cart.id;
      for (var i = 0; i < items.length; i += 1) {
        _drawerBody.appendChild(buildDrawerItem(items[i], cartId));
      }

      /* Fetch and render recommendations */
      var productIds = [];
      var seenPids = {};
      for (var j = 0; j < items.length; j += 1) {
        var pid = String(items[j].productId || "");
        if (pid && !seenPids[pid]) { seenPids[pid] = true; productIds.push(pid); }
      }

      if (_scriptUrl && _storeHash) {
        fetchRecommendationsWithFallback(
          _scriptUrl, _storeHash, "", productIds, "cart", 6
        ).then(function (recs) {
          _drawerRecs = recs;
          renderDrawerRecs(recs);
        });
      }
    });
  }

  function buildDrawerItem(item, cartId) {
    var row = document.createElement("div");
    row.className = "cu-drawer-item";

    /* Image */
    var img = document.createElement("img");
    img.className = "cu-drawer-item-img";
    img.src = item.imageUrl || "";
    img.alt = item.name || "Product";
    img.loading = "lazy";
    row.appendChild(img);

    /* Middle: name + qty */
    var mid = document.createElement("div");
    mid.className = "cu-drawer-item-mid";

    var name = document.createElement("div");
    name.className = "cu-drawer-item-name";
    name.textContent = String(item.name || "Product");
    name.title = String(item.name || "Product");
    mid.appendChild(name);

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
    price.textContent = formatPrice(item.extendedSalePrice || item.salePrice || item.listPrice || 0);
    rt.appendChild(price);

    var delBtn = document.createElement("button");
    delBtn.className = "cu-drawer-item-del";
    delBtn.innerHTML = "&#x1D5E8;";
    delBtn.textContent = "\u2715";
    delBtn.setAttribute("aria-label", "Remove item");
    rt.appendChild(delBtn);
    row.appendChild(rt);

    /* Qty button handlers */
    (function (itemObj, cId, mBtn, pBtn, dBtn) {
      mBtn.addEventListener("click", function () {
        var newQty = (itemObj.quantity || 1) - 1;
        if (newQty < 1) {
          removeCartItem(cId, itemObj.id, function () { refreshDrawer(); });
        } else {
          updateCartItemQty(cId, itemObj.id, itemObj.productId, newQty, function () { refreshDrawer(); });
        }
      });
      pBtn.addEventListener("click", function () {
        var newQty = (itemObj.quantity || 1) + 1;
        updateCartItemQty(cId, itemObj.id, itemObj.productId, newQty, function () { refreshDrawer(); });
      });
      dBtn.addEventListener("click", function () {
        removeCartItem(cId, itemObj.id, function () { refreshDrawer(); });
      });
    })(item, cartId, minusBtn, plusBtn, delBtn);

    return row;
  }

  function renderDrawerRecs(recs) {
    if (!_drawerBody) return;

    var existing = _drawerBody.querySelector(".cu-drawer-recs");
    if (existing) existing.remove();

    if (!Array.isArray(recs) || recs.length === 0) return;

    var section = document.createElement("div");
    section.className = "cu-drawer-recs";

    var hd = document.createElement("div");
    hd.className = "cu-drawer-recs-hd";
    var h3 = document.createElement("h3");
    h3.textContent = "CUSTOMERS ALSO BOUGHT";
    hd.appendChild(h3);
    section.appendChild(hd);

    var scroll = document.createElement("div");
    scroll.className = "cu-drawer-recs-scroll";

    var currency = getCurrencyCode();
    for (var i = 0; i < recs.length; i += 1) {
      var rec = recs[i] || {};
      var card = document.createElement("div");
      card.className = "cu-drawer-rc";

      if (rec.image) {
        var img = document.createElement("img");
        img.className = "cu-drawer-rc-img";
        img.src = rec.image;
        img.alt = String(rec.title || "Product");
        img.loading = "lazy";
        card.appendChild(img);
      }

      var name = document.createElement("div");
      name.className = "cu-drawer-rc-name";
      name.textContent = String(rec.title || "Product");
      card.appendChild(name);

      var price = document.createElement("div");
      price.className = "cu-drawer-rc-price";
      price.textContent = formatMoney(rec.price, currency);
      card.appendChild(price);

      var recId = firstNumeric(rec.id || rec.product_id || rec.productId);
      if (recId) {
        var addBtn = document.createElement("button");
        addBtn.className = "cu-drawer-rc-add";
        addBtn.textContent = "Add";
        (function (btn, pid) {
          btn.addEventListener("click", function () {
            btn.disabled = true;
            btn.textContent = "Adding...";
            addItemToCart([{ quantity: 1, productId: Number(pid) }], function (ok) {
              if (ok) {
                btn.textContent = "Added!";
                setTimeout(function () { btn.textContent = "Add"; btn.disabled = false; }, 1500);
                refreshDrawer();
              } else {
                btn.textContent = "Add";
                btn.disabled = false;
              }
            });
          });
        })(addBtn, recId);
        card.appendChild(addBtn);
      }

      scroll.appendChild(card);
    }

    section.appendChild(scroll);
    _drawerBody.appendChild(section);
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
      lineItems.push({ quantity: 1, productId: pid });
    }

    if (lineItems.length === 0) {
      btn.textContent = "Error";
      return;
    }

    fetch("/api/storefront/carts", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (carts) {
        var cartId = Array.isArray(carts) && carts.length > 0 ? carts[0].id : null;

        if (cartId) {
          return fetch("/api/storefront/carts/" + cartId + "/items", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ lineItems: lineItems }),
          });
        } else {
          return fetch("/api/storefront/carts", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ lineItems: lineItems }),
          });
        }
      })
      .then(function (res) {
        if (res.ok) {
          btn.textContent = "Added to Cart!";
          btn.className = "cu-bundle-btn cu-bundle-btn--success";
          /* Open the cart drawer instead of reloading */
          if (window.__cartUpliftRecsBooted && typeof window.__cuOpenDrawer === "function") {
            setTimeout(function () { window.__cuOpenDrawer(); }, 300);
          } else {
            setTimeout(function () { window.location.reload(); }, 1500);
          }
        } else {
          return res.json().then(function (err) {
            warn("Add to cart failed", err);
            btn.textContent = "Failed - Try Again";
            btn.disabled = false;
          });
        }
      })
      .catch(function (err) {
        warn("Add to cart error", err);
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
