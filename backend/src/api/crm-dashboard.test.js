jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../ai/training', () => ({
  listTrainingData: jest.fn(),
  getReviewReplies: jest.fn(),
  addTrainingData: jest.fn(),
  deactivateTrainingData: jest.fn()
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { query } = require('../db');
const axios = require('axios');
const training = require('../ai/training');
const dashboardRouter = require('./crm-dashboard');

const app = express();
app.use(express.json());
app.use('/api/crm', dashboardRouter);

describe('CRM integration status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_SECRET_KEY = 'test-dashboard-secret';
    process.env.RAILWAY_ENVIRONMENT = 'production';
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SHOPIFY_STORE_URL;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
    query.mockImplementation(async sql => {
      if (sql.includes('FROM tenants WHERE id = $1')) {
        return { rows: [{ whatsapp_configured: true, shopify_configured: true }] };
      }
      if (sql.includes('FROM messages')) return { rows: [{ c: '12' }] };
      if (sql.includes('FROM products')) return { rows: [{ c: '5' }] };
      return { rows: [] };
    });
    training.getReviewReplies.mockResolvedValue([{ id: 'reply-1', question: '¿Cuánto cuesta?', response: 'No estoy segura.' }]);
    training.listTrainingData.mockResolvedValue([]);
    training.addTrainingData.mockResolvedValue({ id: 'rule-1', question: '¿Cuánto cuesta?', answer: 'Revisaré el precio.' });
    training.deactivateTrainingData.mockResolvedValue(true);
  });

  afterAll(() => {
    delete process.env.API_SECRET_KEY;
    delete process.env.RAILWAY_ENVIRONMENT;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SHOPIFY_STORE_URL;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
  });

  test('recognizes tenant credentials and marks Ngrok as not applicable on Railway', async () => {
    const token = jwt.sign(
      { role: 'dashboard', tenantId: 'tenant-1' },
      process.env.API_SECRET_KEY,
      { audience: 'storesg-crm-dashboard' }
    );

    const response = await request(app)
      .get('/api/crm/status')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      whatsapp: 'configured',
      shopify: 'connected',
      ngrok: 'not_applicable',
      messages: 12,
      products: 5
    }));
    expect(axios.get).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM tenants WHERE id = $1 LIMIT 1'), ['tenant-1']);
  });

  test('returns low-confidence replies for the authenticated tenant to review', async () => {
    const token = jwt.sign(
      { role: 'dashboard', tenantId: 'tenant-1' },
      process.env.API_SECRET_KEY,
      { audience: 'storesg-crm-dashboard' }
    );

    const response = await request(app)
      .get('/api/crm/dashboard/review')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.reviews).toHaveLength(1);
    expect(training.getReviewReplies).toHaveBeenCalledWith('tenant-1', 30);
  });

  test('stores a correction as tenant-scoped FAQ training', async () => {
    const token = jwt.sign(
      { role: 'dashboard', tenantId: 'tenant-1' },
      process.env.API_SECRET_KEY,
      { audience: 'storesg-crm-dashboard' }
    );

    const response = await request(app)
      .post('/api/crm/dashboard/training')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'correction', question: '¿Cuánto cuesta?', answer: 'Revisaré el precio.' });

    expect(response.status).toBe(201);
    expect(training.addTrainingData).toHaveBeenCalledWith('tenant-1', {
      category: 'correction', question: '¿Cuánto cuesta?', answer: 'Revisaré el precio.'
    });
  });
});
