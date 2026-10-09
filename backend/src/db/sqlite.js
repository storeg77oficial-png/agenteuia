/**
 * Local Database Connection (SQLite)
 * Used for local development without PostgreSQL
 */

const Database = require('better-sqlite3');
const path = require('path');
const { logger } = require('../utils/logger');

let db;

function connectDB() {
  try {
    const dbPath = path.join(__dirname, '..', '..', 'data', 'storesg.db');
    
    // Ensure data directory exists
    const fs = require('fs');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(dbPath);
    
    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    logger.info('✅ SQLite connected: ' + dbPath);
    
    // Run migrations
    runMigrations(db);
    
    return db;
  } catch (error) {
    logger.error('❌ SQLite connection failed:', error);
    throw error;
  }
}

function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
}

// Query helper (compatible with pg interface)
function query(text, params) {
  try {
    // Convert PostgreSQL syntax to SQLite
    let sql = text;
    let sqliteParams = params || [];
    
    // Replace $1, $2, etc. with ?
    sql = sql.replace(/\$(\d+)/g, '?');
    
    // Replace UUID generation
    sql = sql.replace(/gen_random_uuid\(\)/g, "hex(randomblob(16))");
    
    // Replace NOW()
    sql = sql.replace(/NOW\(\)/g, "datetime('now')");
    
    // Handle RETURNING clause (SQLite 3.35+)
    if (sql.toUpperCase().includes('RETURNING')) {
      // For INSERT with RETURNING
      if (sql.toUpperCase().startsWith('INSERT')) {
        const result = db.prepare(sql).run(...sqliteParams);
        const insertedId = result.lastInsertRowid;
        // Get the inserted row
        const tableName = sql.match(/INTO\s+(\w+)/i)?.[1];
        if (tableName) {
          const row = db.prepare('SELECT * FROM ' + tableName + ' WHERE rowid = ?').get(insertedId);
          return { rows: row ? [row] : [], rowCount: result.changes };
        }
      }
      // For UPDATE/DELETE with RETURNING
      const stmt = db.prepare(sql.replace(/\s+RETURNING\s+.*$/i, ''));
      const result = stmt.run(...sqliteParams);
      return { rows: [], rowCount: result.changes };
    }
    
    // Regular query
    if (sql.toUpperCase().trim().startsWith('SELECT') || sql.toUpperCase().trim().startsWith('WITH')) {
      const rows = db.prepare(sql).all(...sqliteParams);
      return { rows, rowCount: rows.length };
    }
    
    // INSERT/UPDATE/DELETE
    const result = db.prepare(sql).run(...sqliteParams);
    return { rows: [], rowCount: result.changes };
  } catch (error) {
    logger.error('Query error:', { text, error: error.message });
    throw error;
  }
}

// Transaction helper
function transaction(callback) {
  const transactionFn = db.transaction((client) => {
    return callback(client);
  });
  return transactionFn(db);
}

// Run SQLite migrations
function runMigrations(db) {
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
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category);
    CREATE INDEX IF NOT EXISTS idx_products_stock ON products(tenant_id, in_stock);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(tenant_id, event_type);
  `);

  logger.info('✅ Migrations completed');
}

module.exports = { connectDB, getDB, query, transaction };
