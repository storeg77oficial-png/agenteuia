# Schema de Base de Datos

## Tablas Principales

### tenants (Multi-tenant: cada cuenta de WhatsApp es un tenant)
```sql
CREATE TABLE tenants (
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
    
    -- WhatsApp Business API config
    whatsapp_phone_number_id VARCHAR(50),
    whatsapp_business_account_id VARCHAR(50),
    whatsapp_access_token TEXT,
    whatsapp_webhook_verify_token VARCHAR(255),
    whatsapp_app_secret VARCHAR(255),
    
    -- Shopify config
    shopify_store_url VARCHAR(255),
    shopify_access_token TEXT,
    shopify_webhook_secret VARCHAR(255),
    
    -- AI config
    ai_model VARCHAR(50) DEFAULT 'mimo-v2.5-pro',
    ai_system_prompt TEXT,
    ai_temperature DECIMAL(3,2) DEFAULT 0.7,
    ai_max_tokens INTEGER DEFAULT 500,
    
    -- Settings
    currency VARCHAR(10) DEFAULT 'COP',
    timezone VARCHAR(50) DEFAULT 'America/Bogota',
    business_hours JSONB, -- {"mon": {"open": "11:00", "close": "21:00"}, ...}
    auto_transfer_after_failures INTEGER DEFAULT 2,
    
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### customers (Clientes que escriben por WhatsApp)
```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    phone VARCHAR(20) NOT NULL,
    phone_country_code VARCHAR(5) DEFAULT '+57',
    name VARCHAR(255),
    email VARCHAR(255),
    city VARCHAR(100),
    
    -- Shopify sync
    shopify_customer_id BIGINT,
    
    -- Tags and segments
    tags TEXT[],
    segment VARCHAR(50), -- 'new', 'returning', 'vip', 'inactive'
    
    -- Stats
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    last_contact_at TIMESTAMP,
    
    -- Preferences
    preferred_language VARCHAR(10) DEFAULT 'es',
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(tenant_id, phone)
);
```

### products (Synced from Shopify)
```sql
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    shopify_product_id BIGINT NOT NULL,
    shopify_variant_id BIGINT,
    
    title VARCHAR(500) NOT NULL,
    description TEXT,
    brand VARCHAR(100),
    category VARCHAR(100), -- 'conjuntos', 'camisetas', 'zapatos', 'jeans', etc.
    subcategory VARCHAR(100),
    
    price DECIMAL(12,2),
    compare_at_price DECIMAL(12,2),
    currency VARCHAR(10) DEFAULT 'COP',
    
    -- Inventory
    sku VARCHAR(100),
    stock_quantity INTEGER DEFAULT 0,
    in_stock BOOLEAN DEFAULT true,
    
    -- Variants
    sizes TEXT[], -- ['S', 'M', 'L', 'XL', '2XL']
    colors TEXT[],
    images JSONB, -- [{"url": "...", "alt": "..."}]
    
    -- Metadata
    tags TEXT[],
    weight DECIMAL(8,2),
    material VARCHAR(100),
    
    -- Availability
    available_for_sale BOOLEAN DEFAULT true,
    requires_shipping BOOLEAN DEFAULT true,
    
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(tenant_id, shopify_product_id, shopify_variant_id)
);
```

### orders (Pedidos)
```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    shopify_order_id BIGINT,
    
    order_number VARCHAR(50),
    status VARCHAR(30) DEFAULT 'pending', -- pending, confirmed, processing, shipped, delivered, cancelled
    
    -- Items
    items JSONB NOT NULL, -- [{"product_id": "...", "title": "...", "size": "M", "quantity": 1, "price": 120000}]
    
    -- Totals
    subtotal DECIMAL(12,2),
    shipping_cost DECIMAL(12,2) DEFAULT 0,
    discount DECIMAL(12,2) DEFAULT 0,
    total DECIMAL(12,2),
    
    -- Payment
    payment_method VARCHAR(50), -- 'contraentrega', 'transferencia', 'tarjeta'
    payment_status VARCHAR(30) DEFAULT 'pending', -- pending, paid, refunded
    
    -- Shipping
    shipping_method VARCHAR(50),
    shipping_address JSONB,
    tracking_number VARCHAR(100),
    carrier VARCHAR(50),
    estimated_delivery DATE,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    
    -- WhatsApp
    whatsapp_confirmed BOOLEAN DEFAULT false,
    whatsapp_confirmed_at TIMESTAMP,
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### conversations (Historial de conversaciones)
```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    
    -- State
    status VARCHAR(20) DEFAULT 'active', -- active, waiting_human, resolved, closed
    assigned_to VARCHAR(255), -- human agent name/id
    assigned_at TIMESTAMP,
    
    -- AI context
    intent VARCHAR(50), -- 'product_inquiry', 'order_status', 'faq', 'complaint', etc.
    context JSONB, -- Current conversation context
    
    -- Metrics
    message_count INTEGER DEFAULT 0,
    first_response_time INTERVAL,
    resolution_time INTERVAL,
    satisfaction_rating INTEGER, -- 1-5
    
    started_at TIMESTAMP DEFAULT NOW(),
    last_message_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### messages (Mensajes individuales)
```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    
    direction VARCHAR(10) NOT NULL, -- 'inbound', 'outbound'
    sender_type VARCHAR(10) NOT NULL, -- 'customer', 'ai', 'human'
    
    content TEXT NOT NULL,
    content_type VARCHAR(20) DEFAULT 'text', -- text, image, template, interactive
    
    -- WhatsApp metadata
    whatsapp_message_id VARCHAR(100),
    whatsapp_status VARCHAR(20), -- sent, delivered, read, failed
    
    -- AI metadata
    ai_model VARCHAR(50),
    ai_tokens_used INTEGER,
    ai_confidence DECIMAL(5,4),
    ai_intent VARCHAR(50),
    
    created_at TIMESTAMP DEFAULT NOW()
);
```

### whatsapp_templates (Templates aprobados por Meta)
```sql
CREATE TABLE whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    
    template_name VARCHAR(100) NOT NULL,
    category VARCHAR(30), -- marketing, utility, authentication
    language VARCHAR(10) DEFAULT 'es',
    
    -- Content
    header TEXT,
    body TEXT NOT NULL,
    footer TEXT,
    buttons JSONB,
    
    -- Variables
    variables TEXT[], -- {{1}}, {{2}}, etc.
    
    -- Meta status
    meta_template_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    rejection_reason TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### abandoned_carts (Carritos abandonados)
```sql
CREATE TABLE abandoned_carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID REFERENCES customers(id),
    
    shopify_cart_id VARCHAR(100),
    cart_url VARCHAR(500),
    
    items JSONB NOT NULL,
    total DECIMAL(12,2),
    
    -- Recovery
    recovery_status VARCHAR(20) DEFAULT 'pending', -- pending, reminded, recovered, lost
    reminder_sent_at TIMESTAMP,
    reminder_count INTEGER DEFAULT 0,
    recovered_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### analytics_events (Eventos para analytics)
```sql
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID,
    
    event_type VARCHAR(50) NOT NULL, -- 'message_received', 'product_viewed', 'order_created', etc.
    event_data JSONB,
    
    -- Session
    session_id VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast queries
CREATE INDEX idx_analytics_events_tenant_type ON analytics_events(tenant_id, event_type);
CREATE INDEX idx_analytics_events_created ON analytics_events(created_at);
```

### ai_training_data (Datos de entrenamiento del agente)
```sql
CREATE TABLE ai_training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    
    category VARCHAR(50), -- 'faq', 'product_info', 'policy', 'custom'
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    
    -- Usage stats
    times_used INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## Índices Recomendados

```sql
-- Performance indexes
CREATE INDEX idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX idx_products_category ON products(tenant_id, category);
CREATE INDEX idx_products_stock ON products(tenant_id, in_stock);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(tenant_id, status);
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_conversations_status ON conversations(tenant_id, status);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_abandoned_carts_recovery ON abandoned_carts(tenant_id, recovery_status);
```
