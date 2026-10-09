/**
 * WhatsApp Message Sender
 * Send messages through the Meta Cloud API.
 */

const axios = require('axios');
const { logger } = require('../utils/logger');

const DEFAULT_API_VERSION = 'v25.0';
const DEFAULT_TIMEOUT_MS = 15000;

function getConfig(tenant = {}) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || tenant.whatsapp_phone_number_id;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || tenant.whatsapp_access_token;
  const apiVersion = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;

  if (!phoneNumberId || !/^\d+$/.test(String(phoneNumberId))) {
    throw new Error('WhatsApp phone number ID is missing or invalid');
  }
  if (!accessToken) {
    throw new Error('WhatsApp access token is not configured');
  }
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error('WhatsApp API version is invalid');
  }

  return { phoneNumberId, accessToken, apiVersion };
}

function normalizeRecipient(to) {
  const recipient = String(to || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(recipient)) {
    throw new Error('WhatsApp recipient must be an international phone number');
  }
  return recipient;
}

async function postMessage(tenant, to, type, payload) {
  let recipientSuffix = 'unknown';

  try {
    const recipient = normalizeRecipient(to);
    recipientSuffix = recipient.slice(-4);
    const { phoneNumberId, accessToken, apiVersion } = getConfig(tenant);
    const timeout = Number.parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
    const response = await axios.post(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        ...payload
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout
      }
    );

    logger.info('Meta accepted WhatsApp message', {
      type,
      recipientSuffix,
      messageId: response.data.messages?.[0]?.id
    });
    return response.data;
  } catch (error) {
    const metaError = error.response?.data?.error || {};
    logger.error('Meta WhatsApp API request failed', {
      type,
      recipientSuffix,
      httpStatus: error.response?.status,
      networkCode: error.code,
      errorCode: metaError.code,
      errorSubcode: metaError.error_subcode,
      errorType: metaError.type,
      errorMessage: metaError.message || error.message,
      fbtraceId: metaError.fbtrace_id
    });
    throw error;
  }
}

async function sendMessage(tenant, to, text) {
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4096) {
    throw new Error('WhatsApp text must contain between 1 and 4096 characters');
  }

  return postMessage(tenant, to, 'text', {
    type: 'text',
    text: { preview_url: false, body: text }
  });
}

async function sendImage(tenant, to, imageUrl, caption = '') {
  return postMessage(tenant, to, 'image', {
    type: 'image',
    image: { link: imageUrl, caption }
  });
}

async function sendTemplate(tenant, to, templateName, languageCode = 'es', components = []) {
  return postMessage(tenant, to, 'template', {
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components }
  });
}

async function sendButtons(tenant, to, bodyText, buttons) {
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
    throw new Error('WhatsApp interactive messages require between 1 and 3 buttons');
  }

  return postMessage(tenant, to, 'interactive_buttons', {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((button, index) => ({
          type: 'reply',
          reply: { id: button.id || `btn_${index}`, title: button.title }
        }))
      }
    }
  });
}

async function sendList(tenant, to, headerText, bodyText, buttonText, sections) {
  return postMessage(tenant, to, 'interactive_list', {
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: headerText },
      body: { text: bodyText },
      action: { button: buttonText, sections }
    }
  });
}

/** Download a media file (photo, voice note) the customer sent. */
async function downloadMedia(tenant, mediaId) {
  if (!/^\d+$/.test(String(mediaId))) throw new Error('Invalid WhatsApp media id');
  const { accessToken, apiVersion } = getConfig(tenant);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const meta = await axios.get(`https://graph.facebook.com/${apiVersion}/${mediaId}`, { headers, timeout: 15000 });
  const file = await axios.get(meta.data.url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 20 * 1024 * 1024
  });
  return { buffer: Buffer.from(file.data), mime: meta.data.mime_type };
}

/** Upload an OGG/Opus buffer and send it as a WhatsApp voice note. */
async function sendVoiceNote(tenant, to, oggBuffer) {
  const { phoneNumberId, accessToken, apiVersion } = getConfig(tenant);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/ogg');
  form.append('file', new Blob([oggBuffer], { type: 'audio/ogg' }), 'voice.ogg');

  const upload = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  const uploaded = await upload.json().catch(() => ({}));
  if (!upload.ok || !uploaded.id) {
    throw new Error(`WhatsApp media upload failed (${upload.status}): ${uploaded.error?.message || 'no media id'}`);
  }

  return postMessage(tenant, to, 'audio', { type: 'audio', audio: { id: uploaded.id } });
}

module.exports = { sendMessage, sendImage, sendTemplate, sendButtons, sendList, downloadMedia, sendVoiceNote };
