/**
 * Optional LLM layer (OpenAI-compatible chat completions).
 * Enabled only when AI_API_URL and AI_API_KEY are set.
 */
const axios = require('axios');
const { logger } = require('../utils/logger');

function isEnabled() {
  return !!(process.env.AI_API_URL && process.env.AI_API_KEY && process.env.AI_MODEL);
}

async function chat(messages, { maxTokens } = {}) {
  const base = process.env.AI_API_URL.replace(/\/+$/, '');
  try {
    const res = await axios.post(`${base}/chat/completions`, {
      model: process.env.AI_MODEL,
      messages,
      temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
      max_completion_tokens: maxTokens || parseInt(process.env.AI_MAX_TOKENS, 10) || 600,
      // Reasoning adds latency and eats the token budget on short chat replies
      thinking: { type: 'disabled' }
    }, {
      headers: {
        'api-key': process.env.AI_API_KEY,
        Authorization: `Bearer ${process.env.AI_API_KEY}`
      },
      timeout: parseInt(process.env.AI_TIMEOUT_MS, 10) || 25000
    });
    return res.data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    logger.error('LLM request failed', {
      status: error.response?.status,
      error: error.response?.data?.error?.message || error.response?.data?.message || error.message
    });
    return null;
  }
}

module.exports = { isEnabled, chat };
