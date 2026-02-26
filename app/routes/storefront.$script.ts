import type { LoaderFunctionArgs } from "@remix-run/node";

const CACHE_CONTROL = "public, max-age=300, s-maxage=300, stale-while-revalidate=86400";

const CART_UPLIFT_SCRIPT = String.raw`(function () {
  if (window.__cartUpliftRecsBooted) return;
  window.__cartUpliftRecsBooted = true;

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
      if (content && /^[a-z0-9]{5,20}$/i.test(content)) {
        return content;
      }
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
    if (fromGlobal && /^[a-z0-9]{5,20}$/i.test(String(fromGlobal))) {
      return String(fromGlobal);
    }

    var fromMeta = readMeta(["bc-store-hash", "store-hash", "bigcommerce-store-hash"]);
    if (fromMeta) return fromMeta;

    var match = (window.location.hostname || "").match(/^store-([a-z0-9]+)\.mybigcommerce\.com$/i);
    if (match && match[1]) return match[1];

    return "";
  }

  function detectProductIdFromGlobals() {
    var bcData = window.BCData || window.bcData || {};
    var candidates = [
      bcData.product_id,
      bcData.productId,
      bcData.product && (bcData.product.id || bcData.product.entityId || bcData.product.product_id),
      window.product_id,
      window.productId,
      window.__PRODUCT_ID__,
      window.__PRODUCT_ENTITY_ID__,
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var id = firstNumeric(candidates[i]);
      if (id) return id;
    }

    return "";
  }

  function detectProductIdFromDom() {
    var selectors = [
      'input[name="product_id"]',
      'input[name="product-id"]',
      '[data-product-id]',
      '[data-entity-id]',
      '[data-product-entity-id]',
      '[data-product]',
      '[data-product-view] [data-product-id]',
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
    try {
      parsed = new URL(window.location.href);
    } catch (_err) {
      parsed = null;
    }

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

    // Try BigCommerce cart data from global
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

    // Try DOM selectors
    var selectors = [
      "[data-item-product-id]",
      "[data-cart-product-id]",
      "[data-product-id]",
      "[data-entity-id]",
      "[data-product-entity-id]",
      'input[name="product_id"]',
      'input[name^="item-"][name$="-product-id"]',
      'a[href*="product_id="]',
      ".cart-item [data-product-id]",
      "[data-item-row] [data-product-id]",
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

  // Fetch cart product IDs from BigCommerce Storefront Cart API
  function fetchCartProductIds() {
    log("Fetching cart from /api/storefront/carts...");
    return fetch("/api/storefront/carts", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        log("Cart API response status:", res.status);
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (carts) {
        var ids = [];
        var seen = {};
        log("Cart API data:", Array.isArray(carts) ? carts.length + " carts" : typeof carts);
        if (!Array.isArray(carts) || carts.length === 0) return ids;

        var cart = carts[0];
        var lineTypes = ["lineItems", "line_items"];
        var itemCategories = ["physicalItems", "digitalItems", "customItems", "physical_items", "digital_items"];

        for (var t = 0; t < lineTypes.length; t += 1) {
          var lineItems = cart[lineTypes[t]];
          if (!lineItems) continue;

          for (var c = 0; c < itemCategories.length; c += 1) {
            var items = lineItems[itemCategories[c]];
            if (!Array.isArray(items)) continue;

            for (var i = 0; i < items.length; i += 1) {
              var pid = String(items[i].productId || items[i].product_id || "");
              if (pid && !seen[pid]) {
                seen[pid] = true;
                ids.push(pid);
              }
            }
          }
        }

        log("Cart product IDs found:", ids);
        return ids;
      })
      .catch(function (err) {
        log("Cart API error:", err);
        return [];
      });
  }

  function isCartPage() {
    var path = String(window.location.pathname || "").toLowerCase();
    if (path.indexOf("/cart.php") !== -1 || path === "/cart" || path.indexOf("/cart/") === 0) {
      return true;
    }
    var bodyClass = document.body ? document.body.className.toLowerCase() : "";
    return bodyClass.indexOf("cart") !== -1;
  }

  function waitForValue(readFn, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      var started = Date.now();

      function tick() {
        var value = readFn();
        if ((Array.isArray(value) && value.length > 0) || (!Array.isArray(value) && value)) {
          resolve(value);
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          resolve(Array.isArray(value) ? [] : "");
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

  function formatMoney(valueInCents, currencyCode) {
    var amount = Number(valueInCents) / 100;
    if (!isFinite(amount)) return "";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode || getCurrencyCode(),
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (_err) {
      return currencyCode === "GBP" ? "\u00a3" + amount.toFixed(2) : "$" + amount.toFixed(2);
    }
  }

  function normalizeProductUrl(handle) {
    var raw = String(handle || "").trim();
    if (!raw) return "#";
    if (/^https?:\/\//i.test(raw)) return raw;
    return raw.charAt(0) === "/" ? raw : "/" + raw;
  }

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

  function ensureStyles() {
    if (document.getElementById("cu-recommendations-style")) return;
    var style = document.createElement("style");
    style.id = "cu-recommendations-style";
    style.textContent =
      ".cu-recs-wrap{border:1px solid #e5e7eb;padding:16px;margin-top:18px;background:#fff}" +
      ".cu-recs-wrap--cart{margin-bottom:18px}" +
      ".cu-recs-title{margin:0 0 10px;font-size:18px;line-height:1.3;color:#111827}" +
      ".cu-recs-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}" +
      ".cu-rec-card{display:flex;gap:10px;padding:10px;border:1px solid #e5e7eb;text-decoration:none;color:inherit;background:#fafafa}" +
      ".cu-rec-thumb{width:56px;height:56px;object-fit:cover;background:#fff;border:1px solid #e5e7eb;flex-shrink:0}" +
      ".cu-rec-info{min-width:0;display:flex;flex-direction:column;gap:4px}" +
      ".cu-rec-name{font-size:13px;line-height:1.35;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".cu-rec-price{font-size:13px;color:#4b5563;font-weight:600}" +
      "@media (max-width:700px){.cu-recs-grid{grid-template-columns:1fr}}";
    document.head.appendChild(style);
  }

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
      var card = document.createElement("a");
      card.className = "cu-rec-card";
      card.href = normalizeProductUrl(rec.handle);

      if (rec.image) {
        var img = document.createElement("img");
        img.className = "cu-rec-thumb";
        img.src = rec.image;
        img.alt = String(rec.title || "Recommended product");
        img.loading = "lazy";
        card.appendChild(img);
      }

      var info = document.createElement("div");
      info.className = "cu-rec-info";

      var name = document.createElement("div");
      name.className = "cu-rec-name";
      name.textContent = String(rec.title || "Recommended product");
      info.appendChild(name);

      var price = document.createElement("div");
      price.className = "cu-rec-price";
      price.textContent = formatMoney(rec.price, currency);
      info.appendChild(price);

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

  function buildRecommendationsUrl(scriptUrl, storeHash, productId, cartIds, limit, context) {
    var apiUrl =
      scriptUrl.origin +
      "/apps/proxy/api/recommendations?store_hash=" +
      encodeURIComponent(storeHash) +
      "&limit=" +
      String(limit || 4);

    if (productId) {
      apiUrl += "&product_id=" + encodeURIComponent(productId);
    }

    if (cartIds && cartIds.length) {
      apiUrl += "&cart=" + encodeURIComponent(cartIds.join(","));
    }

    if (context) {
      apiUrl += "&context=" + encodeURIComponent(context);
    }

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

        // Fallback: use bundle products as recommendations
        var fallbackProductId = productId || (cartIds && cartIds.length ? cartIds[0] : "");
        if (fallbackProductId) {
          var bundleUrl =
            scriptUrl.origin +
            "/apps/proxy/api/bundles?store_hash=" +
            encodeURIComponent(storeHash) +
            "&product_id=" +
            encodeURIComponent(fallbackProductId) +
            "&context=product";

          return fetchJson(bundleUrl)
            .then(function (bundleData) {
              if (bundleData && bundleData.currency) window.__cuCurrency = bundleData.currency;
              return mapBundlesToRecommendations(bundleData, fallbackProductId, limit);
            })
            .catch(function () {
              return [];
            });
        }

        // Cart page with no specific product: try trending/popular
        if (context === "cart") {
          var trendingUrl =
            scriptUrl.origin +
            "/apps/proxy/api/recommendations?store_hash=" +
            encodeURIComponent(storeHash) +
            "&limit=" + String(limit) +
            "&context=trending";

          return fetchJson(trendingUrl)
            .then(function (trendingData) {
              if (trendingData && trendingData.currency) window.__cuCurrency = trendingData.currency;
              return trendingData && Array.isArray(trendingData.recommendations) ? trendingData.recommendations : [];
            })
            .catch(function () {
              return [];
            });
        }

        return recs;
      })
      .catch(function (err) {
        warn("Recommendations failed", err);
        return [];
      });
  }

  var lastKey = "";
  var isRendering = false;

  function run() {
    if (isRendering) return;
    isRendering = true;

    var scriptUrl = getScriptUrl("/storefront/cart-uplift.js");
    var storeHash = detectStoreHash(scriptUrl);

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

        fetchRecommendationsWithFallback(scriptUrl, storeHash, productId, cartIds, context, limit).then(
          function (recs) {
            var mounted = renderRecommendations(recs, context);
            if (!mounted) {
              log("No recommendations to render", { context: context, count: recs.length });
            }
          }
        );
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
      timer = setTimeout(function () {
        run();
      }, 400);
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

    // Try to get existing cart first
    fetch("/api/storefront/carts", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (carts) {
        var cartId = Array.isArray(carts) && carts.length > 0 ? carts[0].id : null;

        if (cartId) {
          // Add to existing cart
          return fetch("/api/storefront/carts/" + cartId + "/items", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ lineItems: lineItems }),
          });
        } else {
          // Create new cart
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
          // Refresh the page after a short delay to update cart count
          setTimeout(function () { window.location.reload(); }, 1500);
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

    // Title
    var title = document.createElement("h3");
    title.className = "cu-bundle-title";
    title.textContent = "Frequently Bought Together";
    host.appendChild(title);

    // Product row with images + plus signs
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

    // Footer: savings + add to cart button
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
