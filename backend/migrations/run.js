/**
 * Database Migration Script
 * Run: node migrations/run.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL ? {
  connectionString: process.env.DATABASE_URL
} : {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'storesg_crm',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
});

const migrations = [
  // Tenants
  `CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    nit VARCHAR(50),
    email VARCHAR(255),
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(50) DEFAULT 'Colombia',
    website VARCHAR(255),
    whatsapp_phone_number_id VARCHAR(50),
    whatsapp_business_account_id VARCHAR(50),
    whatsapp_access_token TEXT,
    whatsapp_webhook_verify_token VARCHAR(255),
    whatsapp_app_secret VARCHAR(255),
    shopify_store_url VARCHAR(255),
    shopify_access_token TEXT,
    shopify_webhook_secret VARCHAR(255),
    ai_model VARCHAR(50) DEFAULT 'mimo-v2.5-pro',
    ai_system_prompt TEXT,
    ai_temperature DECIMAL(3,2) DEFAULT 0.7,
    ai_max_tokens INTEGER DEFAULT 500,
    currency VARCHAR(10) DEFAULT 'COP',
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    business_hours JSONB,
    auto_transfer_after_failures INTEGER DEFAULT 2,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Customers
  `CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    phone VARCHAR(20) NOT NULL,
    phone_country_code VARCHAR(5) DEFAULT '+57',
    name VARCHAR(255),
    email VARCHAR(255),
    city VARCHAR(100),
    shopify_customer_id BIGINT,
    tags TEXT[],
    segment VARCHAR(50) DEFAULT 'new',
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    last_contact_at TIMESTAMP,
    preferred_language VARCHAR(10) DEFAULT 'es',
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, phone)
  )`,

  // Products
  `CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    shopify_product_id BIGINT NOT NULL,
    shopify_variant_id BIGINT,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    brand VARCHAR(100),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    price DECIMAL(12,2),
    compare_at_price DECIMAL(12,2),
    currency VARCHAR(10) DEFAULT 'COP',
    sku VARCHAR(100),
    stock_quantity INTEGER DEFAULT 0,
    in_stock BOOLEAN DEFAULT true,
    sizes TEXT[],
    colors TEXT[],
    images JSONB,
    tags TEXT[],
    weight DECIMAL(8,2),
    material VARCHAR(100),
    available_for_sale BOOLEAN DEFAULT true,
    requires_shipping BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, shopify_product_id, shopify_variant_id)
  )`,

  // Orders
  `CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    shopify_order_id BIGINT,
    order_number VARCHAR(50),
    status VARCHAR(30) DEFAULT 'pending',
    items JSONB NOT NULL,
    subtotal DECIMAL(12,2),
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    discount DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2),
    payment_method VARCHAR(50),
    payment_status VARCHAR(30) DEFAULT 'pending',
    shipping_method VARCHAR(50),
    shipping_address JSONB,
    tracking_number VARCHAR(100),
    carrier VARCHAR(50),
    estimated_delivery DATE,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    whatsapp_confirmed BOOLEAN DEFAULT false,
    whatsapp_confirmed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Conversations
  `CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    status VARCHAR(20) DEFAULT 'active',
    assigned_to VARCHAR(255),
    assigned_at TIMESTAMP,
    intent VARCHAR(50),
    context JSONB,
    message_count INTEGER DEFAULT 0,
    first_response_time INTERVAL,
    resolution_time INTERVAL,
    satisfaction_rating INTEGER,
    started_at TIMESTAMP DEFAULT NOW(),
    last_message_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  // Messages
  `CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    direction VARCHAR(10) NOT NULL,
    sender_type VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    content_type VARCHAR(20) DEFAULT 'text',
    whatsapp_message_id VARCHAR(100),
    whatsapp_status VARCHAR(20),
    ai_model VARCHAR(50),
    ai_tokens_used INTEGER,
    ai_confidence DECIMAL(5,4),
    ai_intent VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  // WhatsApp Templates
  `CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    template_name VARCHAR(100) NOT NULL,
    category VARCHAR(30),
    language VARCHAR(10) DEFAULT 'es',
    header TEXT,
    body TEXT NOT NULL,
    footer TEXT,
    buttons JSONB,
    variables TEXT[],
    meta_template_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Abandoned Carts
  `CREATE TABLE IF NOT EXISTS abandoned_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    shopify_cart_id VARCHAR(100),
    cart_url VARCHAR(500),
    items JSONB NOT NULL,
    total DECIMAL(12,2),
    recovery_status VARCHAR(20) DEFAULT 'pending',
    reminder_sent_at TIMESTAMP,
    reminder_count INTEGER DEFAULT 0,
    recovered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Analytics Events
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    session_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  // AI Training Data
  `CREATE TABLE IF NOT EXISTS ai_training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    category VARCHAR(50),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    times_used INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Users (CRM users)
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'agent',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone)`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category)`,
  `CREATE INDEX IF NOT EXISTS idx_products_stock ON products(tenant_id, in_stock)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(tenant_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(tenant_id, event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at)`
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('Starting migrations...');
    
    for (let i = 0; i < migrations.length; i++) {
      try {
        await client.query(migrations[i]);
        console.log('Migration ' + (i + 1) + '/' + migrations.length + ' completed');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('Migration ' + (i + 1) + ' already applied');
        } else {
          throw error;
        }
      }
    }
    
    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
