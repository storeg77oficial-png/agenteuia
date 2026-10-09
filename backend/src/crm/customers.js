/**
 * CRM Customers Management
 */

const { query } = require('../db/index');
const { logger } = require('../utils/logger');

/**
 * Find customer by phone
 */
async function findCustomer(tenantId, phone) {
  try {
    const result = await query(
      'SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2',
      [tenantId, phone]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error finding customer:', error);
    return null;
  }
}

/**
 * Create a new customer
 */
async function createCustomer(tenantId, phone, data = {}) {
  try {
    const result = await query(
      `INSERT INTO customers (tenant_id, phone, name, email, city, segment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, phone, data.name, data.email, data.city, 'new']
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating customer:', error);
    throw error;
  }
}

/**
 * Update customer
 */
async function updateCustomer(customerId, data) {
  try {
    const fields = [];
    const values = [customerId];
    let paramIndex = 2;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id') {
        fields.push(key + ' = $' + paramIndex);
        values.push(value);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;
    fields.push('updated_at = datetime("now")');

    const result = await query(
      'UPDATE customers SET ' + fields.join(', ') + ' WHERE id = $1 RETURNING *',
      values
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating customer:', error);
    throw error;
  }
}

/**
 * Get customer with stats
 */
async function getCustomerStats(tenantId, customerId) {
  try {
    const customer = await query('SELECT * FROM customers WHERE id = $1', [customerId]);
    if (!customer.rows[0]) return null;

    const orders = await query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total_spent FROM orders WHERE customer_id = $1',
      [customerId]
    );

    const conversations = await query(
      'SELECT COUNT(*) as count FROM conversations WHERE customer_id = $1',
      [customerId]
    );

    return {
      ...customer.rows[0],
      total_orders: parseInt(orders.rows[0].count),
      total_spent: parseFloat(orders.rows[0].total_spent),
      total_conversations: parseInt(conversations.rows[0].count)
    };
  } catch (error) {
    logger.error('Error getting customer stats:', error);
    throw error;
  }
}

/**
 * List customers with pagination
 */
async function listCustomers(tenantId, options = {}) {
  try {
    const { page = 1, limit = 50, segment, search } = options;
    const offset = (page - 1) * limit;

    let whereClause = 'tenant_id = $1';
    const params = [tenantId];
    let paramIndex = 2;

    if (segment) {
      whereClause += ' AND segment = $' + paramIndex++;
      params.push(segment);
    }

    if (search) {
      whereClause += ' AND (LOWER(name) LIKE $' + paramIndex + ' OR phone LIKE $' + paramIndex + ')';
      params.push('%' + search.toLowerCase() + '%');
      paramIndex++;
    }

    const countResult = await query(
      'SELECT COUNT(*) FROM customers WHERE ' + whereClause,
      params
    );

    const result = await query(
      'SELECT * FROM customers WHERE ' + whereClause + ' ORDER BY last_contact_at DESC LIMIT $' + paramIndex + ' OFFSET $' + (paramIndex + 1),
      [...params, limit, offset]
    );

    return {
      customers: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
    };
  } catch (error) {
    logger.error('Error listing customers:', error);
    throw error;
  }
}

module.exports = {
  findCustomer,
  createCustomer,
  updateCustomer,
  getCustomerStats,
  listCustomers
};
