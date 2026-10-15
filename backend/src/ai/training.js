/**
 * AI Training Data Management
 */

const { query } = require('../db/index');
const { logger } = require('../utils/logger');

/**
 * Get training data for a tenant
 */
async function getTrainingData(tenantId) {
  try {
    const result = await query(
      'SELECT * FROM ai_training_data WHERE tenant_id = $1 AND active = true ORDER BY times_used DESC',
      [tenantId]
    );
    return result.rows;
  } catch (error) {
    logger.error('Error getting training data:', error);
    return [];
  }
}

/**
 * Add training data
 */
async function addTrainingData(tenantId, data) {
  const category = String(data?.category || 'faq').trim().slice(0, 40);
  const question = String(data?.question || '').trim();
  const answer = String(data?.answer || '').trim();
  if (!tenantId || question.length < 3 || question.length > 500 || answer.length < 2 || answer.length > 1500) {
    throw new Error('La pregunta debe tener entre 3 y 500 caracteres y la respuesta entre 2 y 1500.');
  }

  try {
    const result = await query(
      `INSERT INTO ai_training_data (tenant_id, category, question, answer)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, category, question, answer]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error adding training data:', error);
    throw error;
  }
}

async function listTrainingData(tenantId) {
  const result = await query(
    `SELECT id, category, question, answer, times_used, active, created_at
     FROM ai_training_data WHERE tenant_id = $1 ORDER BY active DESC, updated_at DESC LIMIT 200`,
    [tenantId]
  );
  return result.rows;
}

async function getReviewReplies(tenantId, limit = 10, messageId = null) {
  const params = [tenantId];
  const messageFilter = messageId ? 'AND ai.id = $2' : '';
  if (messageId) params.push(messageId);
  const limitClause = messageId ? '' : `LIMIT $${params.push(Math.min(30, Math.max(1, Number(limit) || 10)))}`;
  const result = await query(
    `SELECT ai.id, ai.customer_id, c.name AS customer_name, c.phone AS customer_phone,
            ai.content AS response, ai.ai_intent, ai.ai_confidence, ai.created_at,
            (SELECT inbound.content FROM messages inbound
             WHERE inbound.tenant_id = ai.tenant_id AND inbound.customer_id = ai.customer_id
               AND inbound.direction = 'inbound' AND inbound.created_at <= ai.created_at
             ORDER BY inbound.created_at DESC LIMIT 1) AS question
     FROM messages ai
     LEFT JOIN customers c ON c.id = ai.customer_id AND c.tenant_id = ai.tenant_id
     WHERE ai.tenant_id = $1 AND ai.direction = 'outbound' AND ai.sender_type = 'ai'
       ${messageFilter}
     ORDER BY ai.created_at DESC ${limitClause}`,
    params
  );
  return result.rows;
}

async function deactivateTrainingData(tenantId, id) {
  const result = await query(
    `UPDATE ai_training_data SET active = false, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, id]
  );
  return result.rowCount > 0;
}

/**
 * Update training data
 */
async function updateTrainingData(id, data) {
  try {
    const result = await query(
      `UPDATE ai_training_data SET category = $2, question = $3, answer = $4, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, data.category, data.question, data.answer]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error updating training data:', error);
    throw error;
  }
}

/**
 * Increment usage count
 */
async function incrementUsage(id) {
  try {
    await query(
      'UPDATE ai_training_data SET times_used = times_used + 1, last_used_at = NOW() WHERE id = $1',
      [id]
    );
  } catch (error) {
    logger.error('Error incrementing usage:', error);
  }
}

/**
 * Bulk import training data
 */
async function bulkImport(tenantId, items) {
  let imported = 0;
  for (const item of items) {
    try {
      await addTrainingData(tenantId, item);
      imported++;
    } catch (error) {
      logger.error('Error importing item:', { item, error: error.message });
    }
  }
  return { imported, total: items.length };
}

module.exports = {
  getTrainingData, listTrainingData, getReviewReplies, addTrainingData, updateTrainingData,
  deactivateTrainingData, incrementUsage, bulkImport
};
