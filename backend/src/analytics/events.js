/**
 * Analytics Events Module
 */

const { query } = require('../db/index');
const { logger } = require('../utils/logger');

/**
 * Log an analytics event
 */
async function logEvent(tenantId, customerId, eventType, eventData = {}) {
  try {
    await query(
      `INSERT INTO analytics_events (tenant_id, customer_id, event_type, event_data)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, customerId, eventType, JSON.stringify(eventData)]
    );
  } catch (error) {
    logger.error('Error logging event:', error);
  }
}

/**
 * Get dashboard analytics
 */
async function getDashboardAnalytics(tenantId, days = 30) {
  try {
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Total conversations
    const conversations = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
              COUNT(CASE WHEN status = 'human_handoff' THEN 1 END) as handoffs
       FROM conversations WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, dateFrom]
    );

    // Messages
    const messages = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as inbound,
              COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as outbound
       FROM messages WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, dateFrom]
    );

    // Orders
    const orders = await query(
      `SELECT COUNT(*) as total,
              COALESCE(SUM(total), 0) as revenue,
              COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
              COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
       FROM orders WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, dateFrom]
    );

    // New customers
    const customers = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN segment = 'new' THEN 1 END) as new_customers
       FROM customers WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, dateFrom]
    );

    // Top products
    const topProducts = await query(
      `SELECT p.title, p.brand, p.category, COUNT(*) as inquiries
       FROM analytics_events ae
       JOIN products p ON ae.event_data->>'product_id' = p.id::text
       WHERE ae.tenant_id = $1 AND ae.event_type = 'product_viewed'
         AND ae.created_at >= $2
       GROUP BY p.id, p.title, p.brand, p.category
       ORDER BY inquiries DESC
       LIMIT 10`,
      [tenantId, dateFrom]
    );

    // Abandoned carts
    const abandonedCarts = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN recovery_status = 'recovered' THEN 1 END) as recovered,
              COALESCE(SUM(CASE WHEN recovery_status = 'recovered' THEN total ELSE 0 END), 0) as recovered_value
       FROM abandoned_carts WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, dateFrom]
    );

    // Daily messages trend
    const dailyTrend = await query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM messages WHERE tenant_id = $1 AND created_at >= $2
       GROUP BY DATE(created_at) ORDER BY date`,
      [tenantId, dateFrom]
    );

    return {
      period: { days, from: dateFrom, to: new Date() },
      conversations: {
        total: parseInt(conversations.rows[0].total),
        active: parseInt(conversations.rows[0].active),
        handoffs: parseInt(conversations.rows[0].handoffs)
      },
      messages: {
        total: parseInt(messages.rows[0].total),
        inbound: parseInt(messages.rows[0].inbound),
        outbound: parseInt(messages.rows[0].outbound)
      },
      orders: {
        total: parseInt(orders.rows[0].total),
        revenue: parseFloat(orders.rows[0].revenue),
        delivered: parseInt(orders.rows[0].delivered),
        pending: parseInt(orders.rows[0].pending)
      },
      customers: {
        total: parseInt(customers.rows[0].total),
        new: parseInt(customers.rows[0].new_customers)
      },
      topProducts: topProducts.rows,
      abandonedCarts: {
        total: parseInt(abandonedCarts.rows[0].total),
        recovered: parseInt(abandonedCarts.rows[0].recovered),
        recoveredValue: parseFloat(abandonedCarts.rows[0].recovered_value)
      },
      dailyTrend: dailyTrend.rows
    };
  } catch (error) {
    logger.error('Error getting analytics:', error);
    throw error;
  }
}

/**
 * Get real-time stats
 */
async function getRealTimeStats(tenantId) {
  try {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const activeConversations = await query(
      "SELECT COUNT(*) FROM conversations WHERE tenant_id = $1 AND status = 'active'",
      [tenantId]
    );

    const messagesLast24h = await query(
      'SELECT COUNT(*) FROM messages WHERE tenant_id = $1 AND created_at >= $2',
      [tenantId, last24h]
    );

    const ordersLast24h = await query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue FROM orders WHERE tenant_id = $1 AND created_at >= $2',
      [tenantId, last24h]
    );

    return {
      activeConversations: parseInt(activeConversations.rows[0].count),
      messagesLast24h: parseInt(messagesLast24h.rows[0].count),
      ordersLast24h: parseInt(ordersLast24h.rows[0].count),
      revenueLast24h: parseFloat(ordersLast24h.rows[0].revenue)
    };
  } catch (error) {
    logger.error('Error getting real-time stats:', error);
    throw error;
  }
}

module.exports = { logEvent, getDashboardAnalytics, getRealTimeStats };
