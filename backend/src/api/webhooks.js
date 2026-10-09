/**
 * Webhook handler for Meta WhatsApp Cloud API
 */
const crypto = require('crypto');
const express = require('express');
const { query } = require('../db');
const { findCustomer, createCustomer } = require('../crm/customers');
const { getSession, setSession } = require('../db/localCache');
const { processWithAI } = require('../ai/agent');
const { sendMessage, sendImage, sendVoiceNote, downloadMedia } = require('../whatsapp/sender');
const { transcribeAudio, describeImage, synthesizeVoice } = require('../whatsapp/media');
const { logger } = require('../utils/logger');

const router = express.Router();
const seenMessages = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;

function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [key, ts] of seenMessages) {
    if (now - ts > SEEN_TTL_MS) seenMessages.delete(key);
  }
  if (seenMessages.has(id)) return true;
  seenMessages.set(id, now);
  return false;
}

function hasValidSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    logger.warn('WHATSAPP_APP_SECRET not set: webhook signature is NOT verified');
    return true;
  }
  const header = req.get('x-hub-signature-256') || '';
  if (!header.startsWith('sha256=') || !req.rawBody) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex'));
  const provided = Buffer.from(header.slice(7));
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

async function findTenant(phoneNumberId) {
  let result = await query(
    'SELECT * FROM tenants WHERE whatsapp_phone_number_id = $1',
    [phoneNumberId]
  );
  if (result.rows[0]) return result.rows[0];

  // Single-tenant setups: the env phone ID is the source of truth
  if (phoneNumberId && phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID) {
    result = await query('SELECT * FROM tenants LIMIT 1');
    return result.rows[0] || null;
  }
  return null;
}

function extractText(message) {
  if (message.type === 'text') return message.text?.body || '';
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
  }
  if (message.type === 'button') return message.button?.text || '';
  return '';
}

// Turns photos and voice notes into text the assistant can work with
async function resolveIncoming(tenant, message) {
  if (message.type === 'image' && message.image?.id) {
    const caption = message.image.caption || '';
    try {
      const { buffer, mime } = await downloadMedia(tenant, message.image.id);
      const seen = await describeImage(buffer, mime);
      if (seen) {
        const description = [seen.tipo, seen.marca, seen.color, seen.detalles].filter(Boolean).join(', ');
        return { text: `${seen.busqueda || description} ${caption}`.trim(), stored: `[foto] ${description} ${caption}`.trim(), extras: { imageDescription: description } };
      }
    } catch (error) {
      logger.error('Could not read customer photo', { error: error.message });
    }
    return {
      text: caption,
      stored: '[foto]',
      extras: {},
      fallback: caption ? null : 'No logré ver bien tu foto 😅 ¿Me dices qué prenda y de qué marca buscas? Con eso te la busco de una.'
    };
  }

  if (message.type === 'audio' && message.audio?.id) {
    try {
      const { buffer } = await downloadMedia(tenant, message.audio.id);
      const transcript = await transcribeAudio(buffer);
      if (transcript) return { text: transcript, stored: `[nota de voz] ${transcript}`, extras: { voice: true } };
    } catch (error) {
      logger.error('Could not transcribe voice note', { error: error.message });
    }
    return { text: '', stored: '[nota de voz]', extras: {}, fallback: 'No alcancé a escuchar bien tu nota de voz 🙈 ¿Me la repites o me escribes lo que buscas?' };
  }

  const text = extractText(message);
  return { text, stored: text, extras: {} };
}

async function handleMessage(tenant, value, message) {
  const incoming = await resolveIncoming(tenant, message);
  const text = incoming.text;

  let customer = await findCustomer(tenant.id, message.from);
  if (!customer) {
    customer = await createCustomer(tenant.id, message.from, {
      name: value.contacts?.[0]?.profile?.name || 'Cliente'
    });
  }

  if (incoming.fallback) {
    await sendMessage(tenant, message.from, incoming.fallback);
    return;
  }

  const session = (await getSession(message.from)) || { state: 'new', context: {}, messageCount: 0 };
  try {
    const history = await query(
      'SELECT direction, content FROM messages WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 12',
      [tenant.id, customer.id]
    );
    session.context = {
      ...session.context,
      history: history.rows.reverse().map(row => ({
        role: row.direction === 'inbound' ? 'user' : 'assistant',
        content: row.content
      }))
    };
  } catch (error) {
    logger.warn('Could not load customer conversation history', { error: error.message });
  }

  const aiResponse = await processWithAI(tenant, customer, session, text, message.type, incoming.extras);
  const reply = aiResponse.text || '¿En qué te puedo ayudar?';

  // Send first so a DB failure never blocks the reply
  let sentAsVoice = false;
  if (incoming.extras.voice) {
    try {
      await sendVoiceNote(tenant, message.from, await synthesizeVoice(reply));
      sentAsVoice = true;
    } catch (error) {
      logger.error('Voice reply failed, falling back to text', { error: error.message });
    }
  }
  if (!sentAsVoice) await sendMessage(tenant, message.from, reply);

  // Product photos are best-effort: a failed image must not break the conversation
  for (const image of aiResponse.images || []) {
    try {
      await sendImage(tenant, message.from, image.url, image.caption);
    } catch (error) {
      logger.warn('Failed to send product image', { error: error.message });
    }
  }

  try {
    const sql = 'INSERT INTO messages (tenant_id, customer_id, direction, sender_type, content, content_type, ai_intent, ai_model, ai_confidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
    await query(sql, [tenant.id, customer.id, 'inbound', 'customer', incoming.stored, message.type || 'text', null, null, null]);
    await query(sql, [tenant.id, customer.id, 'outbound', 'ai', reply, 'text', aiResponse.intent || null, process.env.AI_MODEL || null, Number.isFinite(aiResponse.confidence) ? aiResponse.confidence : null]);

    session.state = aiResponse.state || session.state;
    session.context = { ...session.context, ...aiResponse.context };
    session.messageCount = (session.messageCount || 0) + 1;
    await setSession(message.from, session);
  } catch (error) {
    logger.error('Failed to persist conversation', { error: error.message });
  }
}

async function processEvent(body) {
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses || []) {
        if (status.status === 'failed') {
          logger.error('Meta reported delivery failure', { id: status.id, errors: status.errors });
        }
      }

      for (const message of value.messages || []) {
        if (isDuplicate(message.id)) continue;
        try {
          const tenant = await findTenant(value.metadata?.phone_number_id);
          if (!tenant) {
            logger.error('No tenant for phone_number_id', { phoneNumberId: value.metadata?.phone_number_id });
            continue;
          }
          await handleMessage(tenant, value, message);
        } catch (error) {
          logger.error('Webhook message failed', { id: message.id, error: error.message });
        }
      }
    }
  }
}

// GET /webhook - Meta verification handshake
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const expected = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();

  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge']));
  }
  logger.warn('Webhook verification rejected');
  return res.sendStatus(403);
});

// POST /webhook - Incoming events
router.post('/', (req, res) => {
  if (!hasValidSignature(req)) {
    logger.warn('Webhook rejected: invalid signature (check WHATSAPP_APP_SECRET)');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  if (req.body?.object !== 'whatsapp_business_account') return;
  processEvent(req.body).catch(error => logger.error('Webhook processing error', { error: error.message }));
});

module.exports = router;
