#!/usr/bin/env node
/**
 * Bulk Inventory Increase Script
 *
 * Increases available inventory by +N (default 100) for every variant in every location.
 * Uses Shopify Admin REST API inventory_levels/adjust.json.
 * Supports dry-run, throttling, and batching.
 *
 * Usage:
 *   node scripts/bulk-inventory-increase.js \
 *     --shop your-store.myshopify.com \
 *     --token shpat_xxx \
 *     --by 100 \
 *     --intervalMs 300 \
 *     [--dry-run]
 *
 * Env vars:
 *   SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN, INVENTORY_INCREMENT, INTERVAL_MS, DRY_RUN
 */

import https from 'node:https';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.replace(/^--/, '')] = true;
  }
  return out;
}

const args = parseArgs();
const SHOP = (args.shop || process.env.SHOPIFY_SHOP || '').trim();
const TOKEN = (args.token || process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
const BY = parseInt(args.by || process.env.INVENTORY_INCREMENT || '100', 10);
const INTERVAL_MS = parseInt(args.intervalMs || process.env.INTERVAL_MS || '300', 10);
const DRY_RUN = !!args['dry-run'] || String(process.env.DRY_RUN||'').toLowerCase()==='true';
const API_VERSION = '2025-01';

if (!SHOP || !TOKEN) {
  console.error('Missing --shop and/or --token. Set SHOPIFY_SHOP and SHOPIFY_ADMIN_TOKEN env vars or pass CLI flags.');
  process.exit(1);
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function requestJson(method, path, body){
  const payload = body ? JSON.stringify(body) : undefined;
  const opts = {
    hostname: SHOP,
    method,
    path,
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`${method} ${path} -> ${res.statusCode} ${res.statusMessage}\n${buf}`));
        }
  try { resolve(buf ? JSON.parse(buf) : {}); }
  catch (_e) { resolve({ raw: buf }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchLocations() {
  const res = await requestJson('GET', `/admin/api/${API_VERSION}/locations.json`, undefined);
  return Array.isArray(res.locations) ? res.locations : [];
}

async function fetchInventoryVariants(limitTotal = 5000) {
  // Gather inventory_item_id per variant
  const items = [];
  let endpoint = `/admin/api/${API_VERSION}/products.json?limit=100&fields=id,variants`;
  while (items.length < limitTotal && endpoint) {
    const res = await requestJson('GET', endpoint, undefined);
    const products = Array.isArray(res.products) ? res.products : [];
    for (const p of products) {
      for (const v of (p.variants||[])) {
        if (typeof v.inventory_item_id !== 'undefined') {
          items.push({ variant_id: v.id, inventory_item_id: v.inventory_item_id });
          if (items.length >= limitTotal) break;
        }
      }
      if (items.length >= limitTotal) break;
    }
    if (!products.length || products.length < 100) break;
    const lastId = products[products.length-1]?.id;
    if (!lastId) break;
    endpoint = `/admin/api/${API_VERSION}/products.json?limit=100&fields=id,variants&since_id=${lastId}`;
  }
  return items;
}

async function adjustInventory({ location_id, inventory_item_id, available_adjustment }) {
  const body = { location_id, inventory_item_id, available_adjustment };
  if (DRY_RUN) {
    console.log('[DRY RUN] inventory_levels/adjust', body);
    return { dryRun: true };
  }
  return requestJson('POST', `/admin/api/${API_VERSION}/inventory_levels/adjust.json`, body);
}

async function main(){
  console.log('Shop:', SHOP);
  console.log('Increase by:', BY);
  console.log('Interval ms:', INTERVAL_MS);
  console.log('Dry run:', DRY_RUN);

  const locations = await fetchLocations();
  if (!locations.length) throw new Error('No locations found');
  console.log('Locations:', locations.map(l=>`${l.id}:${l.name}`).join(', '));

  const variants = await fetchInventoryVariants();
  console.log('Variants found:', variants.length);

  let ops = 0, fail = 0;
  for (const loc of locations) {
    for (const it of variants) {
      try {
        await adjustInventory({ location_id: loc.id, inventory_item_id: it.inventory_item_id, available_adjustment: BY });
        ops++;
        if (ops % 50 === 0) console.log(`Adjusted ${ops} levels so far...`);
      } catch (e) {
        fail++;
        console.warn('Adjust failed for', { location_id: loc.id, inventory_item_id: it.inventory_item_id }, e.message);
      }
      await sleep(INTERVAL_MS);
    }
  }
  console.log('Done. Adjusted levels:', ops, 'Failures:', fail);
}

main().catch(err => { console.error(err); process.exit(1); });
