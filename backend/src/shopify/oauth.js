/**
 * Shopify OAuth Handler
 * Exchanges the authorization code for an access token
 */
const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Verify HMAC from Shopify
 */
function verifyHmac(query) {
  const { hmac, ...params } = query;
  const message = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const generatedHash = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  
  return generatedHash === hmac;
}

/**
 * Exchange authorization code for access token
 */
async function getAccessToken(shop, code) {
  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code: code
    });

    logger.info('✅ Access token obtained for shop:', shop);
    return response.data.access_token;
  } catch (error) {
    logger.error('❌ Error getting access token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get shop info
 */
async function getShopInfo(shop, accessToken) {
  try {
    const response = await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });
    return response.data.shop;
  } catch (error) {
    logger.error('Error getting shop info:', error.message);
    throw error;
  }
}

module.exports = { verifyHmac, getAccessToken, getShopInfo };
