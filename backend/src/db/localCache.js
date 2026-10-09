/**
 * Local Redis Cache (in-memory)
 * Used for local development without Redis
 */

const { logger } = require('../utils/logger');

// In-memory cache store
const cache = new Map();

// Auto-cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt && value.expiresAt < now) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000);

async function connectRedis() {
  logger.info('✅ Local cache initialized (in-memory)');
  return true;
}

function getRedis() {
  return null; // Not using real Redis
}

async function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  
  return entry.value;
}

async function cacheSet(key, value, ttlSeconds = 3600) {
  cache.set(key, {
    value: value,
    expiresAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null
  });
}

async function cacheDelete(key) {
  cache.delete(key);
}

// Session management
async function getSession(phone) {
  const key = 'session:' + phone;
  return await cacheGet(key);
}

async function setSession(phone, data, ttlSeconds = 1800) {
  const key = 'session:' + phone;
  await cacheSet(key, data, ttlSeconds);
}

async function deleteSession(phone) {
  const key = 'session:' + phone;
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
