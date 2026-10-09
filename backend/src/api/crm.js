/**
 * CRM API Routes
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');
const { getTenantById, createTenant, updateTenant, listTenants } = require('../crm/tenants');
const { listCustomers, getCustomerStats } = require('../crm/customers');
const { getDashboardAnalytics, getRealTimeStats } = require('../analytics/events');
const { syncProducts } = require('../shopify/products');
const { syncOrders } = require('../shopify/orders');
const { getTrainingData, addTrainingData, bulkImport } = require('../ai/training');

// Auth middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, process.env.API_SECRET_KEY);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// ─── Tenants ───────────────────────────────────────────────────

router.get('/tenants', auth, async (req, res) => {
  try {
    const tenants = await listTenants();
    res.json(tenants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tenants', auth, async (req, res) => {
  try {
    const tenant = await createTenant(req.body);
    res.status(201).json(tenant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tenants/:id', auth, async (req, res) => {
  try {
    const tenant = await updateTenant(req.params.id, req.body);
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Customers ─────────────────────────────────────────────────

router.get('/customers', auth, async (req, res) => {
  try {
    const result = await listCustomers(req.user.tenantId, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/customers/:id', auth, async (req, res) => {
  try {
    const customer = await getCustomerStats(req.user.tenantId, req.params.id);
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Analytics ─────────────────────────────────────────────────

router.get('/analytics/dashboard', auth, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const analytics = await getDashboardAnalytics(req.user.tenantId, days);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/realtime', auth, async (req, res) => {
  try {
    const stats = await getRealTimeStats(req.user.tenantId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Sync ──────────────────────────────────────────────────────

router.post('/sync/products', auth, async (req, res) => {
  try {
    const tenant = await getTenantById(req.user.tenantId);
    const result = await syncProducts(tenant);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sync/orders', auth, async (req, res) => {
  try {
    const tenant = await getTenantById(req.user.tenantId);
    const result = await syncOrders(tenant);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── AI Training ───────────────────────────────────────────────

router.get('/training', auth, async (req, res) => {
  try {
    const data = await getTrainingData(req.user.tenantId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/training', auth, async (req, res) => {
  try {
    const item = await addTrainingData(req.user.tenantId, req.body);
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/training/bulk', auth, async (req, res) => {
  try {
    const result = await bulkImport(req.user.tenantId, req.body.items);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
