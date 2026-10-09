/**
 * Redis Connection (Cache + Sessions)
 */

const redis = require('redis');
const { logger } = require('../utils/logger');

let client;

async function connectRedis() {
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    client.on('error', (err) => {
      logger.error('Redis error:', err);
    });

    client.on('connect', () => {
      logger.info('✅ Redis connected');
    });

    await client.connect();
    return client;
  } catch (error) {
    logger.warn('⚠️ Redis not available, running without cache');
    // Don't throw - Redis is optional
    return null;
  }
}

function getRedis() {
  return client;
}

// Cache helpers
async function cacheGet(key) {
  if (!client) return null;
  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error('Cache get error:', error);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds = 3600) {
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (error) {
    logger.error('Cache set error:', error);
  }
}

async function cacheDelete(key) {
  if (!client) return;
  try {
    await client.del(key);
  } catch (error) {
    logger.error('Cache delete error:', error);
  }
}

// Session management
async function getSession(phone) {
  const key = `session:${phone}`;
  return await cacheGet(key);
}

async function setSession(phone, data, ttlSeconds = 1800) {
  const key = `session:${phone}`;
  await cacheSet(key, data, ttlSeconds);
}

async function deleteSession(phone) {
  const key = `session:${phone}`;
  await cacheDelete(key);
}

module.exports = {
  connectRedis,
  getRedis,
  cacheGet,
  cacheSet,
  cacheDelete,
  getSession,
  setSession,
  deleteSession
};
