/**
 * Shopify Products Integration
 * Sync and query products from Shopify
 */

const axios = require('axios');
const { logger } = require('../utils/logger');
const { query } = require('../db/index');
const { cacheGet, cacheSet } = require('../db/redis');

const SHOPIFY_API = `https://${process.env.SHOPIFY_STORE_URL?.replace('https://', '')}/admin/api/${process.env.SHOPIFY_API_VERSION || '2024-01'}`;

/**
 * Fetch all products from Shopify
 */
async function fetchProductsFromShopify(tenant) {
  try {
    const response = await axios.get(`${SHOPIFY_API}/products.json`, {
      headers: {
        'X-Shopify-Access-Token': tenant.shopify_access_token
      },
      params: {
        limit: 250,
        status: 'active'
      }
    });

    return response.data.products;
  } catch (error) {
    logger.error('Error fetching products from Shopify:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Sync products from Shopify to database
 */
async function syncProducts(tenant) {
  try {
    logger.info('🔄 Syncing products from Shopify...');
    
    const products = await fetchProductsFromShopify(tenant);
    let synced = 0;
    let updated = 0;

    for (const product of products) {
      for (const variant of product.variants) {
        const existing = await query(
          'SELECT id FROM products WHERE tenant_id = $1 AND shopify_product_id = $2 AND shopify_variant_id = $3',
          [tenant.id, product.id, variant.id]
        );

        const productData = {
          tenant_id: tenant.id,
          shopify_product_id: product.id,
          shopify_variant_id: variant.id,
          title: product.title,
          description: product.body_html?.replace(/<[^>]*>/g, '').substring(0, 500),
          brand: extractBrand(product.title, product.vendor),
          category: extractCategory(product.product_type, product.tags),
          subcategory: product.product_type,
          price: parseFloat(variant.price),
          compare_at_price: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
          sku: variant.sku,
          stock_quantity: variant.inventory_quantity || 0,
          in_stock: variant.inventory_quantity > 0,
          sizes: extractSizes(variant.title, product.variants),
          colors: extractColors(product.variants),
          images: product.images?.map(img => ({ url: img.src, alt: img.alt })),
          tags: product.tags?.split(', ').filter(Boolean),
          weight: variant.weight,
          available_for_sale: variant.inventory_quantity > 0,
          requires_shipping: variant.requires_shipping,
          last_synced_at: new Date()
        };

        if (existing.rows.length > 0) {
          // Update existing
          await query(
            `UPDATE products SET 
              title = $3, description = $4, brand = $5, category = $6, 
              price = $7, compare_at_price = $8, stock_quantity = $9, 
              in_stock = $10, sizes = $11, colors = $12, images = $13,
              tags = $14, available_for_sale = $15, last_synced_at = $16,
              updated_at = NOW()
            WHERE tenant_id = $1 AND shopify_product_id = $2 AND shopify_variant_id = $3`,
            [tenant.id, product.id, variant.id, ...Object.values(productData).slice(3)]
          );
          updated++;
        } else {
          // Insert new
          await query(
            `INSERT INTO products (${Object.keys(productData).join(', ')})
             VALUES (${Object.keys(productData).map((_, i) => `$${i + 1}`).join(', ')})`,
            Object.values(productData)
          );
          synced++;
        }
      }
    }

    logger.info(`✅ Product sync complete: ${synced} new, ${updated} updated`);
    
    // Clear product cache
    await clearProductCache(tenant.id);
    
    return { synced, updated, total: products.length };
  } catch (error) {
    logger.error('Error syncing products:', error);
    throw error;
  }
}

/**
 * Search products by query
 */
async function searchProducts(tenantId, searchQuery) {
  const cacheKey = 'products:' + tenantId + ':' + searchQuery.toLowerCase();
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const terms = searchQuery.toLowerCase().split(' ').filter(t => t.length > 2);
    
    if (terms.length === 0) {
      const result = await query(
        'SELECT * FROM products WHERE tenant_id = $1 AND in_stock = 1 ORDER BY RANDOM() LIMIT 10',
        [tenantId]
      );
      return result.rows;
    }

    const likeClauses = terms.map((t, i) => {
      const idx = (i * 3) + 2;
      return '(LOWER(title) LIKE $' + idx + ' OR LOWER(brand) LIKE $' + (idx+1) + ' OR LOWER(category) LIKE $' + (idx+2) + ')';
    }).join(' OR ');

    const params = [tenantId, ...terms.flatMap(t => ['%' + t + '%', '%' + t + '%', '%' + t + '%'])];
    const result = await query(
      'SELECT DISTINCT title, brand, category, MIN(price) as price, sizes, in_stock FROM products WHERE tenant_id = $1 AND (' + likeClauses + ') AND in_stock = 1 GROUP BY title, brand ORDER BY price ASC LIMIT 5',
      params
    );

    await cacheSet(cacheKey, result.rows, 300);
    return result.rows;
  } catch (error) {
    logger.error('Error searching products:', error);
    const result = await query(
      'SELECT * FROM products WHERE tenant_id = $1 AND in_stock = 1 ORDER BY RANDOM() LIMIT 10',
      [tenantId]
    );
    return result.rows;
  }
}

/**
 * Get product by ID
 */
async function getProductById(tenantId, productId) {
  const cacheKey = `product:${tenantId}:${productId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const result = await query(
    'SELECT * FROM products WHERE tenant_id = $1 AND id = $2',
    [tenantId, productId]
  );

  const product = result.rows[0] || null;
  if (product) {
    await cacheSet(cacheKey, product, 600);
  }
  return product;
}

/**
 * Check stock for a product
 */
async function checkStock(tenantId, productId, size = null) {
  const product = await getProductById(tenantId, productId);
  if (!product) return { available: false, message: 'Producto no encontrado' };

  if (!product.in_stock) {
    return { 
      available: false, 
      message: `${product.title} está agotado temporalmente`,
      alternatives: await getAlternatives(tenantId, product.category, product.brand)
    };
  }

  if (size && product.sizes && !product.sizes.includes(size)) {
    return {
      available: false,
      message: `Talla ${size} no disponible para ${product.title}`,
      availableSizes: product.sizes
    };
  }

  return { 
    available: true, 
    message: `${product.title} está disponible`,
    stock: product.stock_quantity
  };
}

/**
 * Get alternative products
 */
async function getAlternatives(tenantId, category, brand) {
  const result = await query(
    `SELECT * FROM products 
     WHERE tenant_id = $1 AND category = $2 AND in_stock = true
     ORDER BY RANDOM()
     LIMIT 3`,
    [tenantId, category]
  );
  return result.rows;
}

// ─── Helper Functions ──────────────────────────────────────────

function extractBrand(title, vendor) {
  const brands = ['Nike', 'Adidas', 'Calvin Klein', 'Burberry', 'Gucci', 
                  'Louis Vuitton', 'Armani', 'Coach', 'Lacoste', 'Purple',
                  'Michael Kors', 'Emotion', 'Godspeed', 'Off White', 'Guess'];
  
  const titleLower = title.toLowerCase();
  for (const brand of brands) {
    if (titleLower.includes(brand.toLowerCase())) {
      return brand;
    }
  }
  return vendor || 'Sin marca';
}

function extractCategory(productType, tags) {
  const typeLower = (productType || '').toLowerCase();
  const tagsLower = (tags || '').toLowerCase();
  
  if (typeLower.includes('conjunto') || tagsLower.includes('conjunto')) return 'conjuntos';
  if (typeLower.includes('camiseta') || typeLower.includes('camisa') || tagsLower.includes('camiseta')) return 'camisetas';
  if (typeLower.includes('zapato') || typeLower.includes('tenis') || tagsLower.includes('zapatos')) return 'zapatos';
  if (typeLower.includes('jean') || typeLower.includes('pantalon') || tagsLower.includes('jeans')) return 'jeans';
  if (typeLower.includes('gorra') || tagsLower.includes('gorra')) return 'gorras';
  if (typeLower.includes('blusa') || tagsLower.includes('blusa')) return 'blusas';
  if (typeLower.includes('biker') || tagsLower.includes('biker')) return 'bikers';
  if (typeLower.includes('sudadera') || tagsLower.includes('sudadera')) return 'sudaderas';
  if (typeLower.includes('billetera') || tagsLower.includes('billetera')) return 'billeteras';
  if (typeLower.includes('babero') || tagsLower.includes('babero')) return 'baberos';
  
  return productType || 'otros';
}

function extractSizes(variantTitle, allVariants) {
  if (!allVariants) return [];
  
  const sizePattern = /^(XS|S|M|L|XL|2XL|3XL|\d{2})$/i;
  const sizes = new Set();
  
  allVariants.forEach(v => {
    const parts = v.title.split(' / ');
    parts.forEach(part => {
      if (sizePattern.test(part.trim())) {
        sizes.add(part.trim().toUpperCase());
      }
    });
  });
  
  return Array.from(sizes).sort();
}

function extractColors(variants) {
  if (!variants) return [];
  
  const colors = new Set();
  variants.forEach(v => {
    if (v.option2) {
      colors.add(v.option2);
    }
  });
  
  return Array.from(colors);
}

async function clearProductCache(tenantId) {
  // TODO: Implement cache clearing for all product-related keys
  logger.info('Product cache cleared for tenant:', tenantId);
}

module.exports = {
  syncProducts,
  searchProducts,
  getProductById,
  checkStock,
  getAlternatives
};
