/**
 * Shopify Orders Integration
 * Track and manage orders
 */

const axios = require('axios');
const { logger } = require('../utils/logger');
const { query } = require('../db/index');

const SHOPIFY_API = `https://${process.env.SHOPIFY_STORE_URL?.replace('https://', '')}/admin/api/${process.env.SHOPIFY_API_VERSION || '2024-01'}`;

/**
 * Get order status by order number
 */
async function getOrderStatus(tenantId, customerId, orderNumber) {
  try {
    const result = await query(
      `SELECT * FROM orders 
       WHERE tenant_id = $1 AND customer_id = $2 AND order_number = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, customerId, orderNumber]
    );

    if (result.rows.length === 0) {
      // Try to find by Shopify order ID
      const shopifyResult = await query(
        `SELECT * FROM orders 
         WHERE tenant_id = $1 AND shopify_order_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [tenantId, orderNumber]
      );
      return shopifyResult.rows[0] || null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error getting order status:', error);
    throw error;
  }
}

/**
 * Get all orders for a customer
 */
async function getCustomerOrders(tenantId, customerId, limit = 10) {
  try {
    const result = await query(
      `SELECT * FROM orders 
       WHERE tenant_id = $1 AND customer_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, customerId, limit]
    );

    return result.rows;
  } catch (error) {
    logger.error('Error getting customer orders:', error);
    throw error;
  }
}

/**
 * Create a new order
 */
async function createOrder(tenantId, customerId, orderData) {
  try {
    const result = await query(
      `INSERT INTO orders (
        tenant_id, customer_id, order_number, status, items,
        subtotal, shipping_cost, total, payment_method,
        shipping_address, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        tenantId,
        customerId,
        orderData.order_number || generateOrderNumber(),
        'pending',
        JSON.stringify(orderData.items),
        orderData.subtotal,
        orderData.shipping_cost || 0,
        orderData.total,
        orderData.payment_method,
        JSON.stringify(orderData.shipping_address),
        orderData.notes
      ]
    );

    logger.info('✅ Order created:', { orderId: result.rows[0].id, orderNumber: result.rows[0].order_number });
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating order:', error);
    throw error;
  }
}

/**
 * Update order status
 */
async function updateOrderStatus(orderId, status, metadata = {}) {
  try {
    const updates = ['status = $2', 'updated_at = NOW()'];
    const values = [orderId, status];
    let paramIndex = 3;

    if (metadata.tracking_number) {
      updates.push(`tracking_number = $${paramIndex++}`);
      values.push(metadata.tracking_number);
    }

    if (metadata.carrier) {
      updates.push(`carrier = $${paramIndex++}`);
      values.push(metadata.carrier);
    }

    if (metadata.estimated_delivery) {
      updates.push(`estimated_delivery = $${paramIndex++}`);
      values.push(metadata.estimated_delivery);
    }

    if (status === 'shipped') {
      updates.push('shipped_at = NOW()');
    }

    if (status === 'delivered') {
      updates.push('delivered_at = NOW()');
    }

    const result = await query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );

    logger.info('✅ Order status updated:', { orderId, status });
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating order status:', error);
    throw error;
  }
}

/**
 * Sync orders from Shopify
 */
async function syncOrders(tenant) {
  try {
    logger.info('🔄 Syncing orders from Shopify...');

    const response = await axios.get(`${SHOPIFY_API}/orders.json`, {
      headers: {
        'X-Shopify-Access-Token': tenant.shopify_access_token
      },
      params: {
        status: 'any',
        limit: 250,
        created_at_min: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    const orders = response.data.orders;
    let synced = 0;

    for (const order of orders) {
      // Find or create customer
      let customer = null;
      if (order.customer) {
        const customerResult = await query(
          'SELECT id FROM customers WHERE tenant_id = $1 AND shopify_customer_id = $2',
          [tenant.id, order.customer.id]
        );
        
        if (customerResult.rows.length > 0) {
          customer = customerResult.rows[0];
        } else if (order.customer.phone) {
          // Create customer from order
          const newCustomer = await query(
            `INSERT INTO customers (tenant_id, phone, name, email, shopify_customer_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, phone) DO UPDATE SET name = $3, email = $4
             RETURNING id`,
            [tenant.id, order.customer.phone, 
             `${order.customer.first_name} ${order.customer.last_name}`,
             order.customer.email, order.customer.id]
          );
          customer = newCustomer.rows[0];
        }
      }

      if (!customer) continue;

      // Check if order exists
      const existing = await query(
        'SELECT id FROM orders WHERE tenant_id = $1 AND shopify_order_id = $2',
        [tenant.id, order.id]
      );

      const orderData = {
        tenant_id: tenant.id,
        customer_id: customer.id,
        shopify_order_id: order.id,
        order_number: order.order_number?.toString(),
        status: mapShopifyStatus(order.fulfillment_status, order.financial_status),
        items: order.line_items.map(item => ({
          title: item.title,
          variant: item.variant_title,
          quantity: item.quantity,
          price: parseFloat(item.price)
        })),
        subtotal: parseFloat(order.subtotal_price),
        shipping_cost: parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0),
        total: parseFloat(order.total_price),
        payment_method: order.payment_gateway_names?.[0] || 'unknown',
        payment_status: order.financial_status,
        tracking_number: order.fulfillments?.[0]?.tracking_number,
        carrier: order.fulfillments?.[0]?.tracking_company,
        notes: order.note
      };

      if (existing.rows.length > 0) {
        // Update existing order
        await query(
          `UPDATE orders SET 
            status = $3, tracking_number = $4, carrier = $5,
            payment_status = $6, updated_at = NOW()
           WHERE tenant_id = $1 AND shopify_order_id = $2`,
          [tenant.id, order.id, orderData.status, 
           orderData.tracking_number, orderData.carrier, orderData.payment_status]
        );
      } else {
        // Insert new order
        await query(
          `INSERT INTO orders (
            tenant_id, customer_id, shopify_order_id, order_number, status,
            items, subtotal, shipping_cost, total, payment_method,
            payment_status, tracking_number, carrier, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          Object.values(orderData)
        );
        synced++;
      }
    }

    logger.info(`✅ Order sync complete: ${synced} new orders`);
    return { synced, total: orders.length };
  } catch (error) {
    logger.error('Error syncing orders:', error);
    throw error;
  }
}

// ─── Helper Functions ──────────────────────────────────────────

function generateOrderNumber() {
  return `SG-${Date.now().toString(36).toUpperCase()}`;
}

function mapShopifyStatus(fulfillmentStatus, financialStatus) {
  if (fulfillmentStatus === 'fulfilled') return 'delivered';
  if (fulfillmentStatus === 'in_transit') return 'shipped';
  if (fulfillmentStatus === 'partial') return 'processing';
  if (financialStatus === 'paid') return 'confirmed';
  return 'pending';
}

module.exports = {
  getOrderStatus,
  getCustomerOrders,
  createOrder,
  updateOrderStatus,
  syncOrders
};
