/**
 * STORE SG CRM — Main Server
 */

require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.dashboard.local') });
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { logger } = require('./utils/logger');
const { query, runMigrations, isLocal } = require('./db/index');

// Run migrations
runMigrations();

// Import routes
const webhookRoutes = require('./api/webhooks');
const apiRoutes = require('./api/routes');
const crmDashboardRoutes = require('./api/crm-dashboard');

// Import modules
const { findCustomer, createCustomer } = require('./crm/customers');
const { getSession, setSession } = require('./db/localCache');
const { processWithAI } = require('./ai/agent');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https:"],
            imgSrc: ["'self'", "data:", "https:"],
        }
    }
}));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({
  limit: '10mb',
  verify(req, res, buffer) {
    req.rawBody = Buffer.from(buffer);
  }
}));
app.use(express.urlencoded({ extended: true }));

// ─── Shopify OAuth ─────────────────────────────────────────────

// Root: handle Shopify OAuth or show status
// Serve CRM Dashboard or handle Shopify OAuth
app.get('/', async (req, res) => {
  const { shop, code } = req.query;
  
  // If no Shopify params, serve the dashboard
  if (!shop && !code) {
    const htmlPath = require('path').join(__dirname, '..', '..', 'frontend', 'dashboard.html');
    return res.sendFile(htmlPath);
  }
  
  if (shop && code) {
    // OAuth callback with code
    console.log('OAuth callback:', shop);
    try {
      const { getAccessToken } = require('./shopify/oauth');
      const accessToken = await getAccessToken(shop, code);
      
      const fs = require('fs');
      const envPath = require('path').join(__dirname, '..', '.env');
      let env = fs.readFileSync(envPath, 'utf8');
      env = env.replace(/SHOPIFY_ACCESS_TOKEN=.*/, 'SHOPIFY_ACCESS_TOKEN=' + accessToken);
      fs.writeFileSync(envPath, env);
      
      await query("UPDATE tenants SET shopify_access_token = ? WHERE id = (SELECT id FROM tenants LIMIT 1)", [accessToken]);
      console.log('✅ Token saved!');
      
      res.send('<html><body style="font-family:Arial;text-align:center;padding:50px"><h1 style="color:#008060">✅ Shopify Conectado</h1><p>Tienda: <b>' + shop + '</b></p><p>Token guardado. Cierra esta ventana.</p></body></html>');
    } catch (error) {
      res.status(500).send('Error: ' + error.message);
    }
  } else if (shop) {
    // Redirect to Shopify OAuth
    const apiKey = process.env.SHOPIFY_API_KEY;
    const scopes = 'read_products,write_products,read_orders,write_orders,read_customers,write_customers';
    const redirectUri = 'http://localhost:3000/callback';
    res.redirect('https://' + shop + '/admin/oauth/authorize?client_id=' + apiKey + '&scope=' + scopes + '&redirect_uri=' + encodeURIComponent(redirectUri));
  } else {
    res.json({ status: 'ok', message: 'WhatsApp Bot' });
  }
});

app.get('/settings', (req, res) => {
  const htmlPath = require('path').join(__dirname, '..', '..', 'frontend', 'index.html');
  res.sendFile(htmlPath);
});

// Callback route
app.get('/callback', async (req, res) => {
  const { shop, code } = req.query;
  
  if (!shop || !code) return res.status(400).send('Missing parameters');
  
  console.log('Callback:', shop);
  
  try {
    const { getAccessToken } = require('./shopify/oauth');
    const accessToken = await getAccessToken(shop, code);
    
    const fs = require('fs');
    const envPath = require('path').join(__dirname, '..', '.env');
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace(/SHOPIFY_ACCESS_TOKEN=.*/, 'SHOPIFY_ACCESS_TOKEN=' + accessToken);
    fs.writeFileSync(envPath, env);
    
    await query("UPDATE tenants SET shopify_access_token = ? WHERE id = (SELECT id FROM tenants LIMIT 1)", [accessToken]);
    console.log('✅ Token saved!');
    
    res.send('<html><body style="font-family:Arial;text-align:center;padding:50px"><h1 style="color:#008060">✅ Shopify Conectado</h1><p>Tienda: <b>' + shop + '</b></p><p>Token: <code>' + accessToken + '</code></p><p>Ejecuta: <code>node scripts/sync-shopify.js</code></p></body></html>');
  } catch (error) {
    res.status(500).send('Error: ' + error.message);
  }
});

// ─── Routes ────────────────────────────────────────────────────

// CRM Dashboard routes
app.use('/api/crm', crmDashboardRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

function authorizeTestEndpoint(req, res, next) {
  const expected = Buffer.from(process.env.API_SECRET_KEY || '');
  const authorization = req.get('authorization') || '';
  const provided = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');

  if (!expected.length || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return res.sendStatus(401);
  }
  return next();
}

// Test endpoint
app.post('/test/message', authorizeTestEndpoint, async (req, res) => {
  try {
    const { message, phone } = req.body;
    const tenant = (await query('SELECT * FROM tenants LIMIT 1')).rows[0];
    if (!tenant) return res.status(404).json({ error: 'No tenant' });
    
    let customer = await findCustomer(tenant.id, phone || '573001234567');
    if (!customer) customer = await createCustomer(tenant.id, phone || '573001234567', { name: 'Test' });
    
    let session = await getSession(phone || '573001234567') || { state: 'new', context: {}, messageCount: 0 };
    const r = await processWithAI(tenant, customer, session, message, 'text');
    
    session.state = r.state || session.state;
    session.messageCount++;
    await setSession(phone || '573001234567', session);
    
    res.json({ input: message, response: r.text, intent: r.intent, transferToHuman: r.transferToHuman });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada: ' + req.path }));

// Start
app.listen(PORT, () => {
  logger.info('🚀 Server on port ' + PORT);
  if (process.env.NODE_ENV !== 'test') require('./shopify/sync').startAutoSync();
});

module.exports = app;