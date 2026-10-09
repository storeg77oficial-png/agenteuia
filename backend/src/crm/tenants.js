/**
 * CRM Tenants Management
 * Each WhatsApp Business account is a tenant
 */

const { query } = require('../db/index');
const { logger } = require('../utils/logger');

/**
 * Get tenant by WhatsApp phone number ID
 */
async function getTenantByPhone(phoneNumberId) {
  try {
    const result = await query(
      'SELECT * FROM tenants WHERE whatsapp_phone_number_id = $1 AND status = $2',
      [phoneNumberId, 'active']
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting tenant by phone:', error);
    return null;
  }
}

/**
 * Get tenant by ID
 */
async function getTenantById(tenantId) {
  try {
    const result = await query(
      'SELECT * FROM tenants WHERE id = $1',
      [tenantId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error getting tenant by ID:', error);
    return null;
  }
}

/**
 * Create a new tenant
 */
async function createTenant(data) {
  try {
    const result = await query(
      `INSERT INTO tenants (
        name, business_name, nit, email, phone, address, city, country, website,
        whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token,
        whatsapp_webhook_verify_token, whatsapp_app_secret,
        shopify_store_url, shopify_access_token,
        ai_model, ai_system_prompt, business_hours
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [
        data.name, data.business_name, data.nit, data.email, data.phone,
        data.address, data.city, data.country || 'Colombia', data.website,
        data.whatsapp_phone_number_id, data.whatsapp_business_account_id,
        data.whatsapp_access_token, data.whatsapp_webhook_verify_token,
        data.whatsapp_app_secret,
        data.shopify_store_url, data.shopify_access_token,
        data.ai_model || 'mimo-v2.5-pro', data.ai_system_prompt,
        JSON.stringify(data.business_hours)
      ]
    );

    logger.info('Tenant created:', { id: result.rows[0].id, name: data.name });
    return result.rows[0];
  } catch (error) {
    logger.error('Error creating tenant:', error);
    throw error;
  }
}

/**
 * Update tenant
 */
async function updateTenant(tenantId, data) {
  try {
    const fields = [];
    const values = [tenantId];
    let paramIndex = 2;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'id') {
        fields.push(key + ' = $' + paramIndex);
        values.push(key === 'business_hours' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    });

    if (fields.length === 0) return null;

    fields.push('updated_at = NOW()');

    const result = await query(
      'UPDATE tenants SET ' + fields.join(', ') + ' WHERE id = $1 RETURNING *',
      values
    );

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating tenant:', error);
    throw error;
  }
}

/**
 * List all tenants
 */
async function listTenants(status = 'active') {
  try {
    const result = await query(
      'SELECT id, name, business_name, status, created_at FROM tenants WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return result.rows;
  } catch (error) {
    logger.error('Error listing tenants:', error);
    throw error;
  }
}

module.exports = {
  getTenantByPhone,
  getTenantById,
  createTenant,
  updateTenant,
  listTenants
};
