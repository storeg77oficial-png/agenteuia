/**
 * Database Abstraction Layer
 * Automatically uses SQLite for local development, PostgreSQL for production
 */

require('dotenv').config();

const isLocal = process.env.DB_TYPE === 'sqlite' || (!process.env.DB_HOST && !process.env.DATABASE_URL);

let db;

if (isLocal) {
  // Use SQLite
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');
  const { logger } = require('../utils/logger');

  const dbPath = path.join(__dirname, '..', '..', 'data', 'storesg.db');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  logger.info('✅ SQLite connected: ' + dbPath);
} else {
  // PostgreSQL - will be initialized later
  const { Pool } = require('pg');
  
  const pool = new Pool(process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    max: 20,
  } : {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'storesg_crm',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    max: 20,
  });
  
  db = { pool, type: 'pg' };
}

/**
 * Unified query function that works with both SQLite and PostgreSQL
 */
async function query(text, params) {
  if (isLocal) {
    // SQLite mode
    try {
      let sql = text;
      let sqliteParams = params || [];
      
      // Convert PostgreSQL syntax to SQLite
      sql = sql.replace(/\$(\d+)/g, '?');
      sql = sql.replace(/gen_random_uuid\(\)/g, "hex(randomblob(16))");
      sql = sql.replace(/NOW\(\)/g, "datetime('now')");
      
      // Handle RETURNING clause for INSERT
      if (sql.toUpperCase().includes('RETURNING')) {
        if (sql.toUpperCase().trim().startsWith('INSERT')) {
          const cleanSql = sql.replace(/\s+RETURNING\s+.*$/i, '');
          const result = db.prepare(cleanSql).run(...sqliteParams);
          const insertedId = result.lastInsertRowid;
          const tableName = sql.match(/INTO\s+(\w+)/i)?.[1];
          if (tableName) {
            const row = db.prepare('SELECT * FROM ' + tableName + ' WHERE rowid = ?').get(insertedId);
            return { rows: row ? [mapRow(row)] : [], rowCount: result.changes };
          }
        }
        // For UPDATE with RETURNING
        const cleanSql = sql.replace(/\s+RETURNING\s+.*$/i, '');
        const result = db.prepare(cleanSql).run(...sqliteParams);
        return { rows: [], rowCount: result.changes };
      }
      
      // SELECT queries
      if (sql.toUpperCase().trim().startsWith('SELECT') || sql.toUpperCase().trim().startsWith('WITH')) {
        const rows = db.prepare(sql).all(...sqliteParams);
        return { rows: rows.map(mapRow), rowCount: rows.length };
      }
      
      // INSERT/UPDATE/DELETE
      const result = db.prepare(sql).run(...sqliteParams);
      return { rows: [], rowCount: result.changes };
    } catch (error) {
      console.error('SQLite query error:', error.message, { text });
      throw error;
    }
  } else {
    // PostgreSQL mode
    const start = Date.now();
    const result = await db.pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn('Slow query (' + duration + 'ms):', text.substring(0, 100));
    }
    return result;
  }
}

/**
 * Map SQLite row (handle booleans stored as integers, JSON strings, etc.)
 */
function mapRow(row) {
  if (!row) return row;
  
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    // Convert SQLite integer booleans back to JavaScript booleans
    if (key === 'in_stock' || key === 'available_for_sale' || key === 'requires_shipping' || 
        key === 'active' || key === 'whatsapp_confirmed') {
      mapped[key] = value === 1 || value === true;
    } else {
      mapped[key] = value;
    }
  }
  return mapped;
}

/**
 * Transaction helper
 */
async function transaction(callback) {
  if (isLocal) {
    const transactionFn = db.transaction((client) => {
      return callback({
        query: async (text, params) => {
          let sql = text.replace(/\$(\d+)/g, '?');
          sql = sql.replace(/NOW\(\)/g, "datetime('now')");
          
          if (sql.toUpperCase().trim().startsWith('SELECT')) {
            const rows = client.prepare(sql).all(...(params || []));
            return { rows: rows.map(mapRow), rowCount: rows.length };
          }
          const result = client.prepare(sql).run(...(params || []));
          return { rows: [], rowCount: result.changes };
        }
      });
    });
    return transactionFn(db);
  } else {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Run migrations (SQLite only)
 */
function runMigrations() {
  if (!isLocal) return;
  
  const { logger } = require('../utils/logger');
  logger.info('Running SQLite migrations...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      name TEXT NOT NULL,
      business_name TEXT,
      nit TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      country TEXT DEFAULT 'Colombia',
      website TEXT,
      whatsapp_phone_number_id TEXT,
      whatsapp_business_account_id TEXT,
      whatsapp_access_token TEXT,
      whatsapp_webhook_verify_token TEXT,
      whatsapp_app_secret TEXT,
      shopify_store_url TEXT,
      shopify_access_token TEXT,
      shopify_webhook_secret TEXT,
      ai_model TEXT DEFAULT 'mimo-v2.5-pro',
      ai_system_prompt TEXT,
      ai_temperature REAL DEFAULT 0.7,
      ai_max_tokens INTEGER DEFAULT 500,
      currency TEXT DEFAULT 'COP',
      timezone TEXT DEFAULT 'America/Bogota',
      business_hours TEXT,
      auto_transfer_after_failures INTEGER DEFAULT 2,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      phone TEXT NOT NULL,
      phone_country_code TEXT DEFAULT '+57',
      name TEXT,
      email TEXT,
      city TEXT,
      shopify_customer_id INTEGER,
      tags TEXT,
      segment TEXT DEFAULT 'new',
      total_orders INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      last_contact_at TEXT,
      preferred_language TEXT DEFAULT 'es',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, phone)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      shopify_product_id INTEGER NOT NULL,
      shopify_variant_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      brand TEXT,
      category TEXT,
      subcategory TEXT,
      price REAL,
      compare_at_price REAL,
      currency TEXT DEFAULT 'COP',
      sku TEXT,
      stock_quantity INTEGER DEFAULT 0,
      in_stock INTEGER DEFAULT 1,
      sizes TEXT,
      colors TEXT,
      images TEXT,
      tags TEXT,
      weight REAL,
      material TEXT,
      available_for_sale INTEGER DEFAULT 1,
      requires_shipping INTEGER DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      customer_id TEXT REFERENCES customers(id),
      shopify_order_id INTEGER,
      order_number TEXT,
      status TEXT DEFAULT 'pending',
      items TEXT NOT NULL,
      subtotal REAL,
      shipping_cost REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'pending',
      shipping_method TEXT,
      shipping_address TEXT,
      tracking_number TEXT,
      carrier TEXT,
      estimated_delivery TEXT,
      shipped_at TEXT,
      delivered_at TEXT,
      whatsapp_confirmed INTEGER DEFAULT 0,
      whatsapp_confirmed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      customer_id TEXT REFERENCES customers(id),
      status TEXT DEFAULT 'active',
      assigned_to TEXT,
      assigned_at TEXT,
      intent TEXT,
      context TEXT,
      message_count INTEGER DEFAULT 0,
      first_response_time TEXT,
      resolution_time TEXT,
      satisfaction_rating INTEGER,
      started_at TEXT DEFAULT (datetime('now')),
      last_message_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      conversation_id TEXT REFERENCES conversations(id),
      tenant_id TEXT REFERENCES tenants(id),
      customer_id TEXT REFERENCES customers(id),
      direction TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      whatsapp_message_id TEXT,
      whatsapp_status TEXT,
      ai_model TEXT,
      ai_tokens_used INTEGER,
      ai_confidence REAL,
      ai_intent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      template_name TEXT NOT NULL,
      category TEXT,
      language TEXT DEFAULT 'es',
      header TEXT,
      body TEXT NOT NULL,
      footer TEXT,
      buttons TEXT,
      variables TEXT,
      meta_template_id TEXT,
      status TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS abandoned_carts (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      customer_id TEXT REFERENCES customers(id),
      shopify_cart_id TEXT,
      cart_url TEXT,
      items TEXT NOT NULL,
      total REAL,
      recovery_status TEXT DEFAULT 'pending',
      reminder_sent_at TEXT,
      reminder_count INTEGER DEFAULT 0,
      recovered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      customer_id TEXT,
      event_type TEXT NOT NULL,
      event_data TEXT,
      session_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_training_data (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      category TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      times_used INTEGER DEFAULT 0,
      last_used_at TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      tenant_id TEXT REFERENCES tenants(id),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'agent',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category);
    CREATE INDEX IF NOT EXISTS idx_products_stock ON products(tenant_id, in_stock);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(tenant_id, event_type);
  `);

  logger.info('✅ Migrations completed');
}

module.exports = { query, transaction, runMigrations, isLocal };
