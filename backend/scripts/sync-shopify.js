/**
 * Shopify Product Sync Script
 * Fetches products from Shopify and loads them into the database
 */

require('dotenv').config();
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'storesg.db');
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found. Run the server first.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const SHOPIFY_URL = process.env.SHOPIFY_STORE_URL || 'https://storesgmedellin.co';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

if (!ACCESS_TOKEN || ACCESS_TOKEN === 'your_shopify_access_token') {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     SHOPIFY ACCESS TOKEN NOT CONFIGURED               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Para obtener tu Access Token:');
  console.log('');
  console.log('1. Ve a https://storesgmedellin.co/admin');
  console.log('2. Settings > Apps and sales channels > Develop apps');
  console.log('3. Crea una app llamada "WhatsApp Bot"');
  console.log('4. En Configuration > Admin API access scopes:');
  console.log('   - read_products, write_products');
  console.log('   - read_orders, write_orders');
  console.log('   - read_customers, write_customers');
  console.log('5. Instala la app y copia el "Admin API access token"');
  console.log('6. Agrégalo en .env: SHOPIFY_ACCESS_TOKEN=shpat_xxxxx');
  console.log('');
  process.exit(1);
}

const API_URL = SHOPIFY_URL.replace(/\/$/, '') + '/admin/api/2024-01';

async function fetchProducts() {
  console.log('📦 Fetching products from Shopify...');
  
  try {
    const response = await axios.get(API_URL + '/products.json', {
      headers: {
        'X-Shopify-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 250,
        status: 'active'
      }
    });

    return response.data.products;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('❌ Access Token inválido. Verifica tu configuración.');
    } else {
      console.error('❌ Error:', error.response?.data || error.message);
    }
    throw error;
  }
}

function extractBrand(title, vendor) {
  const brands = ['Nike', 'Adidas', 'Calvin Klein', 'Burberry', 'Gucci', 
                  'Louis Vuitton', 'Armani', 'Coach', 'Lacoste', 'Purple',
                  'Michael Kors', 'Emotion', 'Godspeed', 'Off White', 'Guess'];
  const t = title.toLowerCase();
  for (const b of brands) {
    if (t.includes(b.toLowerCase())) return b;
  }
  return vendor || 'Sin marca';
}

function extractCategory(type, tags) {
  const t = (type || '').toLowerCase();
  const tg = (tags || '').toLowerCase();
  if (t.includes('conjunto') || tg.includes('conjunto')) return 'conjuntos';
  if (t.includes('camiseta') || t.includes('camisa')) return 'camisetas';
  if (t.includes('zapato') || t.includes('tenis')) return 'zapatos';
  if (t.includes('jean') || t.includes('pantalon')) return 'jeans';
  if (t.includes('gorra')) return 'gorras';
  if (t.includes('blusa')) return 'blusas';
  if (t.includes('biker')) return 'bikers';
  if (t.includes('sudadera')) return 'sudaderas';
  if (t.includes('billetera')) return 'billeteras';
  if (t.includes('babero')) return 'baberos';
  return type || 'otros';
}

function extractSizes(variants) {
  const sizePattern = /^(XS|S|M|L|XL|2XL|3XL|\d{2}(\.\d)?)$/i;
  const sizes = new Set();
  variants.forEach(v => {
    v.title.split(' / ').forEach(part => {
      if (sizePattern.test(part.trim())) sizes.add(part.trim().toUpperCase());
    });
  });
  return Array.from(sizes).sort();
}

function extractColors(variants) {
  const colors = new Set();
  variants.forEach(v => { if (v.option2) colors.add(v.option2); });
  return Array.from(colors);
}

async function syncProducts() {
  const products = await fetchProducts();
  console.log('📊 Found', products.length, 'products\n');

  // Get tenant
  const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
  if (!tenant) {
    console.error('❌ No tenant found. Run seed-training.js first.');
    process.exit(1);
  }

  // Clear old products for this tenant
  db.prepare('DELETE FROM products WHERE tenant_id = ?').run(tenant.id);
  console.log('🗑️ Cleared old products');

  const insert = db.prepare(`
    INSERT INTO products (
      tenant_id, shopify_product_id, shopify_variant_id,
      title, description, brand, category,
      price, compare_at_price, sku, stock_quantity, in_stock,
      sizes, colors, images, tags, weight,
      available_for_sale, requires_shipping, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let totalVariants = 0;
  let categories = {};

  const insertMany = db.transaction((products) => {
    for (const product of products) {
      const brand = extractBrand(product.title, product.vendor);
      const category = extractCategory(product.product_type, product.tags);
      const sizes = extractSizes(product.variants);
      const colors = extractColors(product.variants);
      const images = product.images ? product.images.map(i => ({ url: i.src, alt: i.alt })) : [];
      const tags = product.tags ? product.tags.split(', ').filter(Boolean) : [];
      const desc = product.body_html ? product.body_html.replace(/<[^>]*>/g, '').substring(0, 500) : '';

      categories[category] = (categories[category] || 0) + 1;

      for (const variant of product.variants) {
        insert.run(
          tenant.id,
          product.id,
          variant.id,
          product.title,
          desc,
          brand,
          category,
          parseFloat(variant.price),
          variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
          variant.sku,
          variant.inventory_quantity || 0,
          (variant.inventory_quantity || 0) > 0 ? 1 : 0,
          JSON.stringify(sizes),
          JSON.stringify(colors),
          JSON.stringify(images),
          JSON.stringify(tags),
          variant.weight,
          (variant.inventory_quantity || 0) > 0 ? 1 : 0,
          variant.requires_shipping ? 1 : 0
        );
        totalVariants++;
      }
    }
  });

  insertMany(products);

  console.log('✅ Sync complete!\n');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              PRODUCTOS SINCRONIZADOS                  ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📦 Productos:', products.length);
  console.log('📋 Variantes:', totalVariants);
  console.log('');
  console.log('📊 Por categoría:');
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + cat + ':', count);
  }
  console.log('');

  // Show sample products
  const sample = db.prepare('SELECT title, brand, price, category, sizes FROM products WHERE tenant_id = ? LIMIT 5').all(tenant.id);
  console.log('🏷️ Muestra de productos:');
  sample.forEach(p => {
    console.log('   • ' + p.title + ' - $' + p.price.toLocaleString() + ' (' + p.category + ')');
  });
}

syncProducts()
  .then(() => {
    console.log('\n🎉 Shopify sync complete!');
    db.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Sync failed:', err.message);
    db.close();
    process.exit(1);
  });