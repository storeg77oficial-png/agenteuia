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
  try {
    const result = await query(
      `INSERT INTO ai_training_data (tenant_id, category, question, answer)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tenantId, data.category, data.question, data.answer]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Error adding training data:', error);
    throw error;
  }
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

module.exports = { getTrainingData, addTrainingData, updateTrainingData, incrementUsage, bulkImport };
