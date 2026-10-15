jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../crm/customers', () => ({
  findCustomer: jest.fn(),
  createCustomer: jest.fn()
}));
jest.mock('../db/localCache', () => ({
  getSession: jest.fn(),
  setSession: jest.fn()
}));
jest.mock('../ai/agent', () => ({ processWithAI: jest.fn() }));
jest.mock('../whatsapp/sender', () => ({
  sendMessage: jest.fn(), sendVoiceNote: jest.fn(), downloadMedia: jest.fn()
}));
jest.mock('../whatsapp/media', () => ({
  transcribeAudio: jest.fn(), synthesizeVoice: jest.fn()
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { query } = require('../db');
const { findCustomer } = require('../crm/customers');
const { getSession, setSession } = require('../db/localCache');
const { processWithAI } = require('../ai/agent');
const { sendMessage, sendVoiceNote, downloadMedia } = require('../whatsapp/sender');
const { transcribeAudio, synthesizeVoice } = require('../whatsapp/media');
const webhookRouter = require('./webhooks');

const tenant = { id: 'tenant-1', status: 'active', whatsapp_phone_number_id: '123456789012345' };
const customer = { id: 'customer-1', name: 'Ana' };
const app = express();
app.use(express.json({ verify(req, res, buffer) { req.rawBody = Buffer.from(buffer); } }));
app.use('/webhook', webhookRouter);

function signedRequest(payload) {
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  return request(app)
    .post('/webhook')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', `sha256=${signature}`)
    .send(rawBody);
}

describe('Meta WhatsApp webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
    process.env.WHATSAPP_PHONE_NUMBER_ID = tenant.whatsapp_phone_number_id;
    query.mockImplementation(async sql => sql.includes('SELECT direction, content FROM messages')
      ? { rows: [] }
      : { rows: [tenant] });
    findCustomer.mockResolvedValue(customer);
    getSession.mockResolvedValue(null);
    setSession.mockResolvedValue(undefined);
    processWithAI.mockImplementation(async (currentTenant, currentCustomer, session, text) => ({
      text: `Respuesta: ${text}`,
      intent: 'greeting',
      confidence: 0.9,
      state: session.state,
      context: {}
    }));
    sendMessage.mockResolvedValue({ messages: [{ id: 'wamid.reply' }] });
    sendVoiceNote.mockResolvedValue({ messages: [{ id: 'wamid.voice.reply' }] });
    downloadMedia.mockResolvedValue({ buffer: Buffer.from('voice'), mime: 'audio/ogg' });
    transcribeAudio.mockResolvedValue('Busco gorras turcas');
    synthesizeVoice.mockResolvedValue(Buffer.from('reply-audio'));
  });

  afterAll(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  test('rejects unsigned requests', async () => {
    const response = await request(app).post('/webhook').send({ object: 'whatsapp_business_account' });

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  test('processes every message in a signed event and sends each reply through Meta', async () => {
    const from = '573001234567';
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
            contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
            messages: [
              { id: 'wamid.in.1', from, type: 'text', text: { body: 'hola' } },
              { id: 'wamid.in.2', from, type: 'text', text: { body: 'horarios' } }
            ]
          }
        }]
      }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(processWithAI).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(1, tenant, from, 'Respuesta: hola');
    expect(sendMessage).toHaveBeenNthCalledWith(2, tenant, from, 'Respuesta: horarios');
    const messageInserts = query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO messages'));
    expect(messageInserts).toHaveLength(4);
    expect(messageInserts[0][0]).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)');
    expect(messageInserts[0][1][5]).toBe('text');
    expect(messageInserts[1][1]).toEqual(expect.arrayContaining(['greeting', 0.9]));
  });

  test('restores recent customer messages from PostgreSQL for the AI session', async () => {
    const from = '573001234567';
    query.mockImplementation(async sql => {
      if (sql.includes('SELECT direction, content FROM messages')) {
        return { rows: [
          { direction: 'inbound', content: 'Me gustaron, pero no en blanco.' },
          { direction: 'outbound', content: 'Te mostré unos tenis Nike.' }
        ] };
      }
      if (sql.includes('INSERT INTO messages')) return { rows: [], rowCount: 1 };
      return { rows: [tenant] };
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
        contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.in.history', from, type: 'text', text: { body: 'Muéstrame otra opción' } }]
      } }] }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(processWithAI).toHaveBeenCalledWith(
      tenant,
      customer,
      expect.objectContaining({ context: { history: [
        { role: 'assistant', content: 'Te mostré unos tenis Nike.' },
        { role: 'user', content: 'Me gustaron, pero no en blanco.' }
      ] } }),
      'Muéstrame otra opción',
      'text',
      {}
    );
  });
  test('sends the validated catalog link as text after a voice reply', async () => {
    const from = '573001234567';
    const catalogUrl = 'https://storesgmedellin.co/search?q=gorras+turca&filter.v.availability=1';
    processWithAI.mockResolvedValue({
      text: 'Encontré opciones disponibles.',
      catalogUrl,
      intent: 'product_search',
      confidence: 0.9,
      state: 'browsing',
      context: {}
    });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
        contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.in.voice', from, type: 'audio', audio: { id: 'media-1' } }]
      } }] }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(sendVoiceNote).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(tenant, from, `Te comparto el catálogo: ${catalogUrl}`);
  });

  test('notifies the advisor and persists handoff when the AI transfers a conversation', async () => {
    const from = '573001234567';
    processWithAI.mockResolvedValue({
      text: 'Ya le aviso a una asesora para que te ayude.',
      intent: 'product_search',
      confidence: 0.4,
      reason: 'Repeated identical reply',
      transferToHuman: true,
      context: { confusionCount: 2 }
    });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
        contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.in.handoff', from, type: 'text', text: { body: 'Estás alucinando' } }]
      } }] }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(setSession).toHaveBeenCalledWith(from, expect.objectContaining({
      state: 'human_handoff',
      context: expect.objectContaining({ transferReason: 'Repeated identical reply' })
    }));
    expect(sendMessage).toHaveBeenCalledWith(tenant, from, 'Ya le aviso a una asesora para que te ayude.');
    expect(sendMessage).toHaveBeenCalledWith(tenant, '573123300959', expect.stringContaining('Estás alucinando'));
  });

  test('forwards new messages to the advisor without invoking AI during handoff', async () => {
    const from = '573001234567';
    getSession.mockResolvedValue({ state: 'human_handoff', context: {}, messageCount: 1 });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
        contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.in.queued', from, type: 'text', text: { body: 'También busco talla 8' } }]
      } }] }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(processWithAI).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(tenant, '573123300959', expect.stringContaining('También busco talla 8'));
  });

  test('gives the customer the advisor contact when Meta rejects the handoff notification', async () => {
    const from = '573001234567';
    processWithAI.mockResolvedValue({
      text: 'Ya le aviso a una asesora.',
      intent: 'product_search',
      confidence: 0.4,
      transferToHuman: true,
      reason: 'Repeated identical reply',
      context: {}
    });
    sendMessage.mockImplementation(async (currentTenant, to) => {
      if (to === '573123300959') throw new Error('Meta rejected the message');
      return { messages: [{ id: 'wamid.reply' }] };
    });
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: tenant.whatsapp_phone_number_id },
        contacts: [{ wa_id: from, profile: { name: 'Ana' } }],
        messages: [{ id: 'wamid.in.handoff-failed', from, type: 'text', text: { body: 'Necesito ayuda' } }]
      } }] }]
    };

    const response = await signedRequest(payload);
    await new Promise(resolve => setImmediate(resolve));

    expect(response.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(tenant, from,
      expect.stringContaining('escríbele directamente a nuestra asesora: +573123300959'));
  });
});
