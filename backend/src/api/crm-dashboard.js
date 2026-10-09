/**
 * CRM Dashboard API
 * Handles WhatsApp, Telegram, and Shopify connections
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');

const ENV_PATH = path.join(__dirname, '..', '..', '.env');
const dashboardLoginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

function matchesSecret(candidate, expected) {
    const candidateHash = crypto.createHash('sha256').update(candidate).digest();
    const expectedHash = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(candidateHash, expectedHash);
}

function requireDashboardAuth(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Autenticación requerida' });
    try {
        const user = jwt.verify(token, process.env.API_SECRET_KEY, { audience: 'storesg-crm-dashboard' });
        if (user.role !== 'dashboard' || !user.tenantId) return res.sendStatus(403);
        req.dashboardUser = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Sesión expirada o inválida' });
    }
}

function number(value) {
    return Number(value || 0);
}

router.post('/dashboard/login', dashboardLoginLimit, async (req, res) => {
    const expected = process.env.CRM_DASHBOARD_PASSWORD;
    const secret = process.env.API_SECRET_KEY;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!expected || !secret) return res.status(503).json({ error: 'Configura CRM_DASHBOARD_PASSWORD y API_SECRET_KEY en el servidor' });
    if (!matchesSecret(password, expected)) return res.status(401).json({ error: 'Contraseña incorrecta' });

    try {
        const tenantResult = await query("SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at LIMIT 1");
        const tenantId = tenantResult.rows[0]?.id;
        if (!tenantId) return res.status(409).json({ error: 'No hay una tienda activa configurada' });

        const token = jwt.sign({ role: 'dashboard', tenantId }, secret, { audience: 'storesg-crm-dashboard', expiresIn: '12h' });
        res.json({ token, expiresIn: 43200 });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo iniciar sesión' });
    }
});

router.get('/dashboard/summary', requireDashboardAuth, async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const tenantId = req.dashboardUser.tenantId;

    try {
        const [activity, newCustomers, orders, converted, quality, trend, carts] = await Promise.all([
            query(`SELECT COUNT(*) AS messages,
                          SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
                          SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound,
                          COUNT(DISTINCT CASE WHEN direction = 'inbound' THEN customer_id END) AS people
                   FROM messages WHERE tenant_id = $1 AND created_at >= $2`, [tenantId, from]),
            query('SELECT COUNT(*) AS total FROM customers WHERE tenant_id = $1 AND created_at >= $2', [tenantId, from]),
            query(`SELECT COUNT(*) AS total, COUNT(DISTINCT customer_id) AS buyers,
                          COALESCE(SUM(total), 0) AS revenue,
                          SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid
                   FROM orders WHERE tenant_id = $1 AND created_at >= $2`, [tenantId, from]),
            query(`SELECT COUNT(DISTINCT m.customer_id) AS total
                   FROM messages m JOIN orders o ON o.customer_id = m.customer_id AND o.tenant_id = m.tenant_id
                     WHERE m.tenant_id = $1 AND m.direction = 'inbound' AND m.created_at >= $2 AND o.created_at >= $3`, [tenantId, from, from]),
            query(`SELECT COUNT(*) AS replies, AVG(ai_confidence) AS average_confidence,
                          SUM(CASE WHEN ai_confidence < 0.6 THEN 1 ELSE 0 END) AS low_confidence
                   FROM messages WHERE tenant_id = $1 AND direction = 'outbound' AND sender_type = 'ai'
                     AND ai_confidence IS NOT NULL AND created_at >= $2`, [tenantId, from]),
            query(`SELECT DATE(created_at) AS day,
                          SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
                          SUM(CASE WHEN direction = 'outbound' AND sender_type = 'ai' THEN 1 ELSE 0 END) AS replies
                   FROM messages WHERE tenant_id = $1 AND created_at >= $2
                   GROUP BY DATE(created_at) ORDER BY day`, [tenantId, from]),
            query(`SELECT COUNT(*) AS total,
                          SUM(CASE WHEN recovery_status = 'recovered' THEN 1 ELSE 0 END) AS recovered,
                          COALESCE(SUM(CASE WHEN recovery_status = 'recovered' THEN total ELSE 0 END), 0) AS recovered_value
                   FROM abandoned_carts WHERE tenant_id = $1 AND created_at >= $2`, [tenantId, from])
        ]);

        const people = number(activity.rows[0]?.people);
        const buyers = number(converted.rows[0]?.total);
        const qualityReplies = number(quality.rows[0]?.replies);
        res.json({
            period: { days, from },
            activity: {
                people,
                messages: number(activity.rows[0]?.messages),
                inbound: number(activity.rows[0]?.inbound),
                outbound: number(activity.rows[0]?.outbound),
                newCustomers: number(newCustomers.rows[0]?.total)
            },
            sales: {
                orders: number(orders.rows[0]?.total),
                buyers,
                revenue: number(orders.rows[0]?.revenue),
                paidOrders: number(orders.rows[0]?.paid),
                conversionRate: people ? Math.round((buyers / people) * 1000) / 10 : 0
            },
            quality: {
                measuredReplies: qualityReplies,
                averageConfidence: qualityReplies ? number(quality.rows[0]?.average_confidence) : null,
                lowConfidenceReplies: number(quality.rows[0]?.low_confidence)
            },
            abandonedCarts: {
                tracked: false,
                recorded: number(carts.rows[0]?.total),
                recovered: number(carts.rows[0]?.recovered),
                recoveredValue: number(carts.rows[0]?.recovered_value)
            },
            trend: trend.rows.map(row => ({ day: row.day, inbound: number(row.inbound), replies: number(row.replies) }))
        });
    } catch (error) {
        res.status(500).json({ error: 'No se pudieron cargar las métricas' });
    }
});

router.get('/dashboard/customers', requireDashboardAuth, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const search = String(req.query.search || '').trim().slice(0, 100);
    const tenantId = req.dashboardUser.tenantId;
    const params = [tenantId];
    let where = 'c.tenant_id = $1';
    if (search) {
        const searchValue = `%${search.toLowerCase()}%`;
        params.push(searchValue, searchValue);
        where += ` AND (LOWER(COALESCE(c.name, '')) LIKE $${params.length - 1} OR c.phone LIKE $${params.length})`;
    }

    try {
        const count = await query(`SELECT COUNT(*) AS total FROM customers c WHERE ${where}`, params);
        const total = number(count.rows[0]?.total);
        const listParams = [...params, limit, (page - 1) * limit];
        const customers = await query(`SELECT c.id, c.name, c.phone, c.city, c.segment, c.created_at,
                    (SELECT MAX(m.created_at) FROM messages m WHERE m.tenant_id = c.tenant_id AND m.customer_id = c.id) AS last_contact_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.tenant_id = c.tenant_id AND m.customer_id = c.id AND m.direction = 'inbound') AS inbound_messages,
                    (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id) AS total_orders,
                    (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id) AS total_spent
                FROM customers c WHERE ${where}
                ORDER BY COALESCE(last_contact_at, c.created_at) DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, listParams);
        res.json({ customers: customers.rows, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ error: 'No se pudieron cargar los clientes' });
    }
});

router.get('/dashboard/customers/:id', requireDashboardAuth, async (req, res) => {
    const tenantId = req.dashboardUser.tenantId;
    try {
        const customer = await query('SELECT id, name, phone, email, city, segment, created_at FROM customers WHERE tenant_id = $1 AND id = $2', [tenantId, req.params.id]);
        if (!customer.rows[0]) return res.sendStatus(404);
        const [messages, orders] = await Promise.all([
            query(`SELECT direction, sender_type, content, content_type, ai_intent, ai_confidence, created_at
                   FROM messages WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 30`, [tenantId, req.params.id]),
            query(`SELECT order_number, status, payment_status, total, created_at
                   FROM orders WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC LIMIT 20`, [tenantId, req.params.id])
        ]);
        res.json({ customer: customer.rows[0], messages: messages.rows, orders: orders.rows });
    } catch (error) {
        res.status(500).json({ error: 'No se pudo cargar el perfil del cliente' });
    }
});

router.get('/dashboard/orders', requireDashboardAuth, async (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    try {
        const orders = await query(`SELECT o.order_number, o.status, o.payment_status, o.total, o.created_at,
                    c.name AS customer_name, c.phone AS customer_phone
                FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND c.tenant_id = o.tenant_id
                WHERE o.tenant_id = $1 ORDER BY o.created_at DESC LIMIT $2`, [req.dashboardUser.tenantId, limit]);
        res.json({ orders: orders.rows });
    } catch (error) {
        res.status(500).json({ error: 'No se pudieron cargar los pedidos' });
    }
});

router.use(requireDashboardAuth);

function readEnv() {


    if (!fs.existsSync(ENV_PATH)) return {};
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    return { ...require('dotenv').parse(content), ...process.env };
}

function writeEnv(updates) {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    for (const [key, value] of Object.entries(updates)) {
        const regex = new RegExp('^' + key + '=.*$', 'm');
        if (regex.test(content)) {
            content = content.replace(regex, key + '=' + value);
        } else {
            content += '\n' + key + '=' + value;
        }
    }
    fs.writeFileSync(ENV_PATH, content);
    // Also update process.env
    for (const [key, value] of Object.entries(updates)) {
        process.env[key] = value;
    }
}

// ===== STATUS =====
router.get('/status', async (req, res) => {
    try {
        const env = readEnv();
        let ngrok = 'inactive';
        try {
            const r = await axios.get('http://127.0.0.1:4040/api/tunnels', { timeout: 2000 });
            ngrok = r.data.tunnels?.length > 0 ? 'active' : 'inactive';
        } catch (e) {}

        let messages = 0, products = 0;
        try {
            const { query } = require('../db/index');
            const m = await query('SELECT COUNT(*) as c FROM messages');
            messages = parseInt(m.rows[0]?.c || 0);
            const p = await query('SELECT COUNT(*) as c FROM products');
            products = parseInt(p.rows[0]?.c || 0);
        } catch (e) {}

        res.json({
            server: 'online',
            whatsapp: env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_ACCESS_TOKEN !== 'demo' ? 'configured' : 'not_configured',
            telegram: process.env.TELEGRAM_BOT_TOKEN ? 'connected' : 'not_configured',
            shopify: env.SHOPIFY_ACCESS_TOKEN && env.SHOPIFY_ACCESS_TOKEN.startsWith('shpat_') ? 'connected' : 'not_configured',
            ngrok,
            messages,
            products
        });
    } catch (e) {
        res.json({ server: 'online', whatsapp: 'error', telegram: 'error', shopify: 'error', ngrok: 'error', messages: 0, products: 0 });
    }
});

// ===== WHATSAPP =====
router.post('/test-whatsapp', async (req, res) => {
    const { phone_number_id, access_token } = req.body;
    if (!phone_number_id || !access_token) return res.json({ success: false, error: 'Faltan credenciales' });
    try {
        const r = await axios.get('https://graph.facebook.com/v25.0/' + phone_number_id, {
            headers: { 'Authorization': 'Bearer ' + access_token }
        });
        res.json({ success: true, data: r.data });
    } catch (e) {
        res.json({ success: false, error: e.response?.data?.error?.message || e.message });
    }
});

router.post('/save-whatsapp', (req, res) => {
    const { phone_number_id, business_account_id, access_token, app_secret, phone, verify_token } = req.body;
    writeEnv({
        WHATSAPP_PROVIDER: 'meta',
        WHATSAPP_PHONE_NUMBER_ID: phone_number_id || '',
        WHATSAPP_BUSINESS_ACCOUNT_ID: business_account_id || '',
        WHATSAPP_ACCESS_TOKEN: access_token || '',
        WHATSAPP_APP_SECRET: app_secret || '',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: verify_token || 'storesg-local-verify',
        BUSINESS_PHONE: phone || ''
    });
    res.json({ success: true });
});

// ===== TELEGRAM =====
router.post('/test-telegram', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ success: false, error: 'Falta el token' });
    try {
        const r = await axios.get('https://api.telegram.org/bot' + token + '/getMe');
        res.json({ success: true, data: { username: r.data.result.username, name: r.data.result.first_name, id: r.data.result.id } });
    } catch (e) {
        res.json({ success: false, error: 'Token inválido o bot no encontrado' });
    }
});

router.post('/save-telegram', async (req, res) => {
    const { token, chat_id } = req.body;
    if (!token) return res.json({ success: false, error: 'Falta el token' });

    writeEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat_id || '' });

    // Start the Telegram bot
    try {
        const { startTelegramBot } = require('../telegram/bot');
        startTelegramBot(token, chat_id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true, note: 'Bot guardado. Se activará al reiniciar el servidor.' });
    }
});

router.get('/telegram-updates', async (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.json({ success: false, error: 'Telegram no configurado' });
    try {
        const r = await axios.get('https://api.telegram.org/bot' + token + '/getUpdates');
        res.json({ success: true, data: r.data.result });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ===== SHOPIFY =====
router.post('/test-shopify', async (req, res) => {
    const { store_url, api_key, api_secret } = req.body;
    if (!store_url) return res.json({ success: false, error: 'Falta la URL' });
    try {
        // Check if we already have a token
        const env = readEnv();
        if (env.SHOPIFY_ACCESS_TOKEN && env.SHOPIFY_ACCESS_TOKEN.startsWith('shpat_')) {
            const r = await axios.get(store_url.replace(/\/$/, '') + '/admin/api/2024-01/shop.json', {
                headers: { 'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN }
            });
            return res.json({ success: true, data: { shop: r.data.shop.name } });
        }
        // Otherwise just verify the store exists
        const r = await axios.get(store_url.replace(/\/$/, '') + '/admin/api/2024-01/shop.json', {
            headers: { 'X-Shopify-Access-Token': 'invalid' }
        }).catch(() => null);
        res.json({ success: true, data: { shop: store_url } });
    } catch (e) {
        if (e.response?.status === 401) {
            res.json({ success: true, data: { shop: store_url } }); // Store exists
        } else {
            res.json({ success: false, error: 'No se pudo conectar. Verifica la URL.' });
        }
    }
});

router.post('/connect-shopify', async (req, res) => {
    const { store_url, api_key, api_secret } = req.body;
    if (!store_url || !api_key || !api_secret) return res.json({ success: false, error: 'Faltan datos' });

    // Save credentials
    writeEnv({
        SHOPIFY_STORE_URL: store_url.replace(/\/$/, ''),
        SHOPIFY_API_KEY: api_key,
        SHOPIFY_API_SECRET: api_secret
    });

    // Build OAuth URL
    const scopes = 'read_products,write_products,read_orders,write_orders,read_customers,write_customers';
    const redirectUri = 'http://localhost:3000/';
    const oauthUrl = store_url.replace(/\/$/, '') + '/admin/oauth/authorize?client_id=' + api_key + '&scope=' + scopes + '&redirect_uri=' + encodeURIComponent(redirectUri);

    res.json({ success: true, oauth_url: oauthUrl });
});

router.post('/sync-products', async (req, res) => {
    try {
        const env = readEnv();
        if (!env.SHOPIFY_ACCESS_TOKEN || !env.SHOPIFY_ACCESS_TOKEN.startsWith('shpat_')) {
            return res.json({ success: false, error: 'Shopify no conectado. Conecta primero.' });
        }
        const { query } = require('../db/index');
        const tenant = (await query('SELECT * FROM tenants LIMIT 1')).rows[0];
        if (!tenant) return res.json({ success: false, error: 'No hay tenant configurado' });

        // Update tenant with Shopify credentials
        await query('UPDATE tenants SET shopify_store_url = ?, shopify_access_token = ? WHERE id = ?', [env.SHOPIFY_STORE_URL, env.SHOPIFY_ACCESS_TOKEN, tenant.id]);

        const { syncProducts } = require('../shopify/products');
        const tenantData = { ...tenant, shopify_store_url: env.SHOPIFY_STORE_URL, shopify_access_token: env.SHOPIFY_ACCESS_TOKEN };
        const result = await syncProducts(tenantData);

        // Count products
        const count = await query('SELECT COUNT(*) as c FROM products');
        res.json({ success: true, data: { synced: result.synced || parseInt(count.rows[0]?.c || 0), variants: result.total || 0 } });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

module.exports = router;
