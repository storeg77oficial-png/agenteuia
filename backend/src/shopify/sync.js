/**
 * Shopify catalog sync: full sync on a schedule + live stock checks per product.
 * Stores one row per variant with its own size/color/stock.
 */
const axios = require('axios');
const { query } = require('../db');
const { logger } = require('../utils/logger');

const SIZE_RE = /^(xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl|\d{2}(?:[.,]5)?|unica|unico|única|único)$/i;
const KNOWN_BRANDS = ['Nike', 'Adidas', 'Calvin Klein', 'Burberry', 'Gucci', 'Louis Vuitton', 'Armani',
  'Coach', 'Lacoste', 'Purple', 'Michael Kors', 'Emotion', 'Godspeed', 'Off White', 'Guess'];

let syncing = false;
let columnsChecked = false;

function getConfig(tenant) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN || tenant?.shopify_access_token;
  const domain = String(process.env.SHOPIFY_STORE_URL || tenant?.shopify_store_url || '')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!token || !domain) return null;
  const version = process.env.SHOPIFY_API_VERSION || '2024-01';
  return { token, base: `https://${domain}/admin/api/${version}` };
}

async function ensureColumns() {
  if (columnsChecked) return;
  columnsChecked = true;
  try {
    const has = await query("SELECT name FROM pragma_table_info('products') WHERE name = 'handle'");
    if (!has.rows.length) await query('ALTER TABLE products ADD COLUMN handle TEXT');
  } catch (error) {
    // PostgreSQL has no pragma_table_info
    await query('ALTER TABLE products ADD COLUMN IF NOT EXISTS handle TEXT').catch(() => {});
  }
}

async function fetchAllProducts(cfg) {
  const all = [];
  let url = `${cfg.base}/products.json`;
  let params = { limit: 250, status: 'active' };
  while (url) {
    const res = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': cfg.token },
      params,
      timeout: 30000
    });
    all.push(...res.data.products);
    const next = (res.headers.link || '').match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    params = undefined;
  }
  return all;
}

function extractBrand(title, vendor) {
  const lower = title.toLowerCase();
  const known = KNOWN_BRANDS.find(b => lower.includes(b.toLowerCase()));
  if (known) return known;
  const v = (vendor || '').trim();
  return v || 'Sin marca';
}

function extractCategory(type, tags, title = '') {
  const lowerTitle = title.toLowerCase();
  // In Colombia "sudadera" is the lower garment (jogger); the upper one is "buzo"
  if (/(buzo|buso|hoodie|canguro)/.test(lowerTitle)) return 'buzos';
  if (/\b(sudadera|jogger)s?\b/.test(lowerTitle)) return 'sudaderas';
  if (/\b(leggins|leggings|licra|lycra)\b/.test(lowerTitle)) return 'leggins';
  if (/\b(pantaloneta|short|bermuda)s?\b/.test(lowerTitle)) return 'pantalonetas';
  const t = (type || '').toLowerCase();
  const tg = String(tags || '').toLowerCase();
  const map = [
    ['conjunto', 'conjuntos'], ['camiseta', 'camisetas'], ['camisa', 'camisetas'],
    ['zapato', 'zapatos'], ['tenis', 'zapatos'], ['jean', 'jeans'], ['pantalon', 'jeans'],
    ['gorra', 'gorras'], ['blusa', 'blusas'], ['biker', 'bikers'], ['sudadera', 'sudaderas'],
    ['chaqueta', 'chaquetas'],
    ['billetera', 'billeteras'], ['babero', 'baberos'], ['bolso', 'bolsos']
  ];
  for (const [needle, cat] of map) {
    if (t.includes(needle)) return cat;
  }
  for (const [needle, cat] of map) {
    if (tg.includes(needle)) return cat;
  }
  return t || 'otros';
}

function splitOptions(product, variant) {
  let size = null;
  let color = null;
  (product.options || []).forEach((opt, i) => {
    const value = variant[`option${i + 1}`];
    if (!value || value === 'Default Title') return;
    if (/talla|size/i.test(opt.name)) size = value;
    else if (/color|colour/i.test(opt.name)) color = value;
    else if (!size && SIZE_RE.test(value.trim())) size = value.trim();
    else if (!color) color = value;
  });
  return { size: size ? String(size).trim().toUpperCase() : null, color };
}

// Variants without inventory tracking are always purchasable
function stockOf(variant) {
  if (!variant.inventory_management) return 999;
  return Math.max(0, variant.inventory_quantity || 0);
}

async function upsertVariant(tenantId, product, variant) {
  const { size, color } = splitOptions(product, variant);
  const qty = stockOf(variant);
  const values = {
    title: product.title,
    description: product.body_html ? product.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500) : '',
    brand: extractBrand(product.title, product.vendor),
    category: extractCategory(product.product_type, product.tags, product.title),
    subcategory: product.product_type || null,
    price: parseFloat(variant.price),
    compare_at_price: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
    sku: variant.sku || null,
    stock_quantity: qty,
    in_stock: qty > 0 ? 1 : 0,
    sizes: JSON.stringify(size ? [size] : []),
    colors: JSON.stringify(color ? [color] : []),
    images: JSON.stringify((product.images || []).slice(0, 3).map(i => ({ url: i.src, alt: i.alt }))),
    tags: JSON.stringify(product.tags ? product.tags.split(', ').filter(Boolean) : []),
    weight: variant.weight || null,
    available_for_sale: qty > 0 ? 1 : 0,
    requires_shipping: variant.requires_shipping ? 1 : 0,
    handle: product.handle || null
  };
  const cols = Object.keys(values);
  const params = Object.values(values);

  const existing = await query(
    'SELECT id FROM products WHERE tenant_id = $1 AND shopify_variant_id = $2',
    [tenantId, variant.id]
  );

  if (existing.rows[0]) {
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await query(
      `UPDATE products SET ${sets}, last_synced_at = NOW(), updated_at = NOW() WHERE id = $${cols.length + 1}`,
      [...params, existing.rows[0].id]
    );
    return 'updated';
  }

  const allCols = ['tenant_id', 'shopify_product_id', 'shopify_variant_id', ...cols];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(', ');
  await query(
    `INSERT INTO products (${allCols.join(', ')}, last_synced_at) VALUES (${placeholders}, NOW())`,
    [tenantId, product.id, variant.id, ...params]
  );
  return 'inserted';
}

async function syncCatalog(tenant) {
  if (syncing) return { skipped: true };
  const cfg = getConfig(tenant);
  if (!cfg) {
    logger.warn('Shopify sync skipped: missing store URL or access token');
    return { skipped: true };
  }

  syncing = true;
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await ensureColumns();
    const products = await fetchAllProducts(cfg);
    const counts = { inserted: 0, updated: 0 };
    for (const product of products) {
      for (const variant of product.variants) {
        counts[await upsertVariant(tenant.id, product, variant)]++;
      }
    }

    // Anything not seen in this sync was removed or unpublished in Shopify
    await query(
      'UPDATE products SET in_stock = 0, available_for_sale = 0, stock_quantity = 0 WHERE tenant_id = $1 AND (last_synced_at IS NULL OR last_synced_at < $2)',
      [tenant.id, startedAt]
    );

    require('../ai/catalog').invalidateKnowledge();
    logger.info('Shopify catalog synced', { products: products.length, ...counts });
    return { products: products.length, ...counts };
  } catch (error) {
    logger.error('Shopify sync failed', { error: error.response?.data?.errors || error.message });
    return { error: error.message };
  } finally {
    syncing = false;
  }
}

/** Re-read stock/price of specific products straight from Shopify. Returns true if anything changed. */
async function refreshProductsLive(tenant, shopifyProductIds) {
  const cfg = getConfig(tenant);
  if (!cfg || !shopifyProductIds.length) return false;

  let changed = false;
  const results = await Promise.allSettled(shopifyProductIds.map(id =>
    axios.get(`${cfg.base}/products/${id}.json`, {
      headers: { 'X-Shopify-Access-Token': cfg.token },
      params: { fields: 'id,variants' },
      timeout: 4000
    })
  ));

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const variant of result.value.data.product.variants) {
      const qty = stockOf(variant);
      const current = await query(
        'SELECT stock_quantity, price FROM products WHERE tenant_id = $1 AND shopify_variant_id = $2',
        [tenant.id, variant.id]
      );
      const row = current.rows[0];
      if (!row) continue;
      const price = parseFloat(variant.price);
      if (row.stock_quantity !== qty || row.price !== price) {
        await query(
          'UPDATE products SET stock_quantity = $1, in_stock = $2, available_for_sale = $3, price = $4, last_synced_at = NOW() WHERE tenant_id = $5 AND shopify_variant_id = $6',
          [qty, qty > 0 ? 1 : 0, qty > 0 ? 1 : 0, price, tenant.id, variant.id]
        );
        changed = true;
      }
    }
  }

  if (changed) require('../ai/catalog').invalidateKnowledge();
  return changed;
}

function startAutoSync() {
  const minutes = Math.max(1, parseInt(process.env.SHOPIFY_SYNC_INTERVAL_MIN, 10) || 15);
  const run = async () => {
    try {
      const tenant = (await query('SELECT * FROM tenants LIMIT 1')).rows[0];
      if (tenant) await syncCatalog(tenant);
    } catch (error) {
      logger.error('Scheduled Shopify sync error', { error: error.message });
    }
  };
  setTimeout(run, 3000);
  setInterval(run, minutes * 60 * 1000).unref();
  logger.info(`Shopify auto-sync every ${minutes} min`);
}

module.exports = { syncCatalog, refreshProductsLive, startAutoSync };
