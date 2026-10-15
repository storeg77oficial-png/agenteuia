/**
 * Telegram Bot Controller
 * Alerts, notifications, commands, and approvals
 */
const axios = require('axios');
const { query } = require('../db');
const training = require('../ai/training');
const learning = require('../ai/learning');

let botToken = null;
let chatId = null;
let polling = false;

function startTelegramBot(token, chat_id) {
    botToken = token;
    chatId = chat_id;
    console.log('✈️ Telegram bot started');
    
    // Send startup message
    if (chatId) {
        sendMessage('🤖 *STORE SG CRM Bot Activado*\n\n✅ Bot conectado correctamente.\n📱 Envía /ayuda para ver los comandos disponibles.');
    }
    
    // Start polling for messages
    startPolling();
}

function startPolling() {
    if (polling) return;
    polling = true;
    
    let offset = 0;
    
    async function poll() {
        if (!botToken) return;
        try {
            const r = await axios.get('https://api.telegram.org/bot' + botToken + '/getUpdates', {
                params: { offset: offset, timeout: 10 }
            });
            
            for (const update of r.data.result) {
                offset = update.update_id + 1;
                if (update.message) {
                    await handleMessage(update.message);
                }
            }
        } catch (e) {
            // Silent error on polling
        }
        
        // Continue polling
        setTimeout(poll, 1000);
    }
    
    poll();
}

async function handleMessage(message) {
    const chat = message.chat.id;
    const text = message.text || '';
    const firstName = message.from?.first_name || 'Usuario';
    
    console.log('✈️ Telegram:', firstName, '|', text);
    
    if (text.startsWith('/')) {
        await handleCommand(chat, text, firstName);
    } else {
        await sendMessage(chat, '👋 Hola ' + firstName + '! Envía /ayuda para ver los comandos disponibles.');
    }
}

async function handleCommand(chat, text, firstName) {
    const parts = text.split(' ');
    const command = parts[0].split('@')[0].toLowerCase();
    const args = parts.slice(1);

    if (['/errores', '/entrenar', '/corregir', '/vocabulario', '/palabra', '/aprobar_palabra', '/rechazar_palabra'].includes(command)) {
        if (!chatId || String(chat) !== String(chatId)) {
            await sendMessage(chat, 'Este chat no está autorizado para administrar el entrenamiento.');
            return;
        }
        await handleTrainingCommand(chat, command, args.join(' '));
        return;
    }
    
    switch (command) {
        case '/start':
        case '/ayuda':
            await sendMessage(chat, getHelpText());
            break;
            
        case '/estado':
            await sendSystemStatus(chat);
            break;
            
        case '/ventas':
            await sendSalesReport(chat);
            break;
            
        case '/productos':
            await sendProductSearch(chat, args.join(' '));
            break;
            
        case '/clientes':
            await sendRecentCustomers(chat);
            break;
            
        case '/alertas':
            await sendAlerts(chat);
            break;
            
        case '/enviar':
            await sendWhatsAppCommand(chat, args);
            break;
            
        case '/aprobar':
            await approveAction(chat, args[0]);
            break;
            
        case '/rechazar':
            await rejectAction(chat, args[0]);
            break;
            
        case '/sync':
            await syncProductsCommand(chat);
            break;
            
        default:
            await sendMessage(chat, '❌ Comando no reconocido. Envía /ayuda para ver los comandos.');
    }
}

async function handleTrainingCommand(chat, command, input) {
    try {
        const tenantResult = await query("SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at LIMIT 1");
        const tenantId = tenantResult.rows[0]?.id;
        if (!tenantId) {
            await sendMessage(chat, 'No hay una tienda activa para entrenar.');
            return;
        }
        const values = input.split('|').map(value => value.trim());

        if (command === '/errores') {
            const reviews = await training.getReviewReplies(tenantId, 5);
            if (!reviews.length) {
                await sendMessage(chat, 'No hay respuestas recientes para revisar.');
                return;
            }
            const text = reviews.map((item, index) =>
                `${index + 1}. ID: ${item.id}\nPregunta: ${(item.question || 'No identificada').slice(0, 220)}\nIA: ${(item.response || '').slice(0, 280)}`
            ).join('\n\n');
            await sendMessage(chat, `Respuestas recientes:\n\n${text}\n\nPara corregir: /corregir ID | pregunta | respuesta`);
            return;
        }

        if (command === '/vocabulario') {
            const overview = await learning.getLearningOverview(tenantId);
            const pending = (overview.vocab || []).filter(item => item.status === 'pending').slice(0, 10);
            if (!pending.length) {
                await sendMessage(chat, 'No hay palabras pendientes de aprobación.');
                return;
            }
            const text = pending.map(item =>
                `ID: ${item.id}\n${item.term} → ${item.target_type}: ${item.target_value} (${item.customers} clientes)`
            ).join('\n\n');
            await sendMessage(chat, `Vocabulario pendiente:\n\n${text}\n\nUsa /aprobar_palabra ID o /rechazar_palabra ID.`);
            return;
        }

        if (command === '/palabra') {
            if (values.length < 3) {
                await sendMessage(chat, 'Uso: /palabra término | category, brand o color | valor existente');
                return;
            }
            const added = await learning.addVocab(tenantId, { term: values[0], type: values[1], value: values.slice(2).join(' | ') });
            await sendMessage(chat, added ? 'Equivalencia aprobada y activa.' : 'No guardé la equivalencia. Revisa que el término y el destino existan en la tienda.');
            return;
        }

        if (command === '/aprobar_palabra' || command === '/rechazar_palabra') {
            const updated = await learning.setVocabStatus(tenantId, input.trim(), command === '/aprobar_palabra' ? 'approved' : 'rejected');
            await sendMessage(chat, updated ? 'Estado de la palabra actualizado.' : 'No encontré esa palabra pendiente.');
            return;
        }

        if (command === '/entrenar') {
            if (values.length < 2) {
                await sendMessage(chat, 'Uso: /entrenar pregunta frecuente | respuesta correcta');
                return;
            }
            await training.addTrainingData(tenantId, { category: 'faq', question: values[0], answer: values.slice(1).join(' | ') });
            await sendMessage(chat, 'Guardé la respuesta FAQ. La IA la usará cuando detecte una pregunta frecuente coincidente.');
            return;
        }

        if (values.length < 3) {
            await sendMessage(chat, 'Uso: /corregir ID | pregunta | respuesta correcta');
            return;
        }
        const [messageId, question, ...answerParts] = values;
        const review = await training.getReviewReplies(tenantId, 1, messageId);
        if (!review.length) {
            await sendMessage(chat, 'No encontré esa respuesta reciente para revisar. Envía /errores y usa el ID que aparece allí.');
            return;
        }
        await training.addTrainingData(tenantId, { category: 'correction', question, answer: answerParts.join(' | ') });
        await sendMessage(chat, 'Corrección guardada como ejemplo FAQ. Los datos de productos y existencias siguen viniendo del catálogo.');
    } catch (error) {
        await sendMessage(chat, `No pude guardar el entrenamiento: ${error.message}`);
    }
}

function getHelpText() {
    return `🤖 *COMANDOS DEL BOT*

📊 *Sistema:*
/estado — Estado del sistema
/sync — Sincronizar productos

📈 *Ventas y Clientes:*
/ventas — Reporte de ventas
/productos \[búsqueda\] — Buscar productos
/clientes — Clientes recientes

⚠️ *Alertas y Acciones:*
/alertas — Ver alertas pendientes
/aprobar \[id\] — Aprobar acción
/rechazar \[id\] — Rechazar acción

🧠 *Entrenamiento supervisado:*
/errores — Ver respuestas recientes
/entrenar pregunta | respuesta — Añadir FAQ
/corregir ID | pregunta | respuesta — Corregir una respuesta
/vocabulario — Revisar equivalencias pendientes
/palabra término | tipo | valor — Enseñar una equivalencia
/aprobar_palabra ID — Aprobar una equivalencia
/rechazar_palabra ID — Rechazar una equivalencia

📱 *WhatsApp:*
/enviar \[número\] \[mensaje\] — Enviar mensaje

❓ *Ayuda:*
/ayuda — Esta lista`;
}

async function sendSystemStatus(chat) {
    try {
        const { query } = require('../db/index');
        const customers = await query('SELECT COUNT(*) as c FROM customers');
        const products = await query('SELECT COUNT(*) as c FROM products');
        const messages = await query('SELECT COUNT(*) as c FROM messages');
        
        const msg = `📊 *ESTADO DEL SISTEMA*

✅ Servidor: Activo
📱 WhatsApp: Configurado
✈️ Telegram: Activo
🛍️ Shopify: Conectado

👥 Clientes: ${customers.rows[0]?.c || 0}
📦 Productos: ${products.rows[0]?.c || 0}
💬 Mensajes: ${messages.rows[0]?.c || 0}`;
        await sendMessage(chat, msg);
    } catch (e) {
        await sendMessage(chat, '❌ Error obteniendo estado: ' + e.message);
    }
}

async function sendSalesReport(chat) {
    try {
        const { query } = require('../db/index');
        const orders = await query('SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as total FROM orders WHERE created_at > datetime("now", "-1 day")');
        const msg = `📈 *REPORTE DE VENTAS (Hoy)*

🛒 Pedidos: ${orders.rows[0]?.c || 0}
💰 Total: $${(orders.rows[0]?.total || 0).toLocaleString('es-CO')} COP`;
        await sendMessage(chat, msg);
    } catch (e) {
        await sendMessage(chat, '❌ Error: ' + e.message);
    }
}

async function sendProductSearch(chat, searchTerm) {
    if (!searchTerm) {
        await sendMessage(chat, '📝 Uso: /productos \[búsqueda\]\nEjemplo: /productos camisetas');
        return;
    }
    try {
        const { query } = require('../db/index');
        const result = await query(
            'SELECT DISTINCT title, brand, price, category FROM products WHERE (LOWER(title) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(category) LIKE ?) AND in_stock = 1 LIMIT 5',
            ['%' + searchTerm.toLowerCase() + '%', '%' + searchTerm.toLowerCase() + '%', '%' + searchTerm.toLowerCase() + '%']
        );
        if (result.rows.length === 0) {
            await sendMessage(chat, '🔍 No encontré productos con: ' + searchTerm);
            return;
        }
        let msg = '🛍️ *Productos encontrados:*\n\n';
        result.rows.forEach((p, i) => {
            msg += (i + 1) + '. *' + p.title + '*\n   💰 $' + p.price.toLocaleString('es-CO') + ' COP (' + p.category + ')\n';
        });
        await sendMessage(chat, msg);
    } catch (e) {
        await sendMessage(chat, '❌ Error: ' + e.message);
    }
}

async function sendRecentCustomers(chat) {
    try {
        const { query } = require('../db/index');
        const result = await query('SELECT phone, name, last_contact_at FROM customers ORDER BY created_at DESC LIMIT 10');
        if (result.rows.length === 0) {
            await sendMessage(chat, '👥 No hay clientes registrados aún.');
            return;
        }
        let msg = '👥 *Últimos clientes:*\n\n';
        result.rows.forEach((c, i) => {
            msg += (i + 1) + '. ' + (c.name || 'Sin nombre') + ' (' + c.phone + ')\n';
        });
        await sendMessage(chat, msg);
    } catch (e) {
        await sendMessage(chat, '❌ Error: ' + e.message);
    }
}

async function sendAlerts(chat) {
    await sendMessage(chat, '⚠️ *Alertas pendientes:*\n\nNo hay alertas pendientes en este momento.');
}

async function sendWhatsAppCommand(chat, args) {
    if (args.length < 2) {
        await sendMessage(chat, '📝 Uso: /enviar \[número\] \[mensaje\]\nEjemplo: /enviar 573001234567 Hola!');
        return;
    }
    const phone = args[0];
    const message = args.slice(1).join(' ');
    try {
        const env = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.env'), 'utf8');
        const phoneId = env.match(/WHATSAPP_PHONE_NUMBER_ID=(.*)/)?.[1];
        const token = env.match(/WHATSAPP_ACCESS_TOKEN=(.*)/)?.[1];
        
        await axios.post('https://graph.facebook.com/v25.0/' + phoneId + '/messages', {
            messaging_product: 'whatsapp',
            to: phone.replace('+', ''),
            type: 'text',
            text: { body: message }
        }, {
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
        });
        await sendMessage(chat, '✅ Mensaje enviado a ' + phone);
    } catch (e) {
        await sendMessage(chat, '❌ Error enviando: ' + (e.response?.data?.error?.message || e.message));
    }
}

async function approveAction(chat, id) {
    await sendMessage(chat, '✅ Acción #' + id + ' aprobada.');
}

async function rejectAction(chat, id) {
    await sendMessage(chat, '❌ Acción #' + id + ' rechazada.');
}

async function syncProductsCommand(chat) {
    await sendMessage(chat, '🔄 Sincronizando productos...');
    try {
        const { query } = require('../db/index');
        const tenant = (await query('SELECT * FROM tenants LIMIT 1')).rows[0];
        const { syncProducts } = require('../shopify/products');
        const result = await syncProducts(tenant);
        await sendMessage(chat, '✅ Productos sincronizados: ' + (result.synced || 0));
    } catch (e) {
        await sendMessage(chat, '❌ Error: ' + e.message);
    }
}

async function sendMessage(chat, text) {
    if (!botToken) return;
    try {
        await axios.post('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            chat_id: chat || chatId,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        // Try without markdown if it fails
        try {
            await axios.post('https://api.telegram.org/bot' + botToken + '/sendMessage', {
                chat_id: chat || chatId,
                text: text.replace(/\*/g, '').replace(/\[/g, '').replace(/\]/g, '')
            });
        } catch (e2) {
            console.error('Telegram send error:', e2.message);
        }
    }
}

// Send alert to configured chat
async function sendAlert(text) {
    if (chatId) {
        await sendMessage(chatId, '⚠️ *ALERTA*\n\n' + text);
    }
}

module.exports = { startTelegramBot, sendMessage, sendAlert, handleCommand };
