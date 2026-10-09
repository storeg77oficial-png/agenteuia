/**
 * WhatsApp Message Handler
 * Core logic for processing incoming messages
 */

const { logger } = require('../utils/logger');
const { getSession, setSession, deleteSession } = require('../db/redis');
const { query } = require('../db/index');
const { processWithAI } = require('../ai/agent');
const { sendMessage, sendTemplate } = require('./sender');
const { findCustomer, createCustomer, updateCustomer } = require('../crm/customers');
const { logEvent } = require('../analytics/events');

// Message types we handle
const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  INTERACTIVE: 'interactive',
  BUTTON: 'button',
};

// Conversation states
const STATES = {
  NEW: 'new',
  BROWSING: 'browsing',
  ORDERING: 'ordering',
  TRACKING: 'tracking',
  SUPPORT: 'support',
  HUMAN_HANDOFF: 'human_handoff',
};

async function handleMessage(tenant, message) {
  try {
    const phone = message.from;
    const messageType = message.type;
    const messageId = message.id;
    const timestamp = message.timestamp;

    logger.info('📨 Message received:', {
      tenant: tenant.id,
      from: phone,
      type: messageType,
      id: messageId
    });

    // Get or create customer
    let customer = await findCustomer(tenant.id, phone);
    if (!customer) {
      customer = await createCustomer(tenant.id, phone);
      logger.info('👤 New customer created:', { phone, customerId: customer.id });
    }

    // Get conversation session
    let session = await getSession(phone) || {
      state: STATES.NEW,
      context: {},
      messageCount: 0,
      lastMessageAt: new Date()
    };

    // Check if in human handoff mode
    if (session.state === STATES.HUMAN_HANDOFF) {
      logger.info('Customer in human handoff, not responding with AI');
      await logEvent(tenant.id, customer.id, 'message_queued_for_human', {
        messageId,
        phone
      });
      return;
    }

    // Extract message content
    const content = extractContent(message);
    
    // Log incoming message
    await logMessage(tenant.id, customer.id, messageId, 'inbound', 'customer', content);

    // Check business hours
    const isBusinessHours = checkBusinessHours(tenant.business_hours);
    
    // Process with AI
    const aiResponse = await processWithAI(tenant, customer, session, content, messageType);

    // Handle AI response
    if (aiResponse.transferToHuman) {
      // Transfer to human agent
      session.state = STATES.HUMAN_HANDOFF;
      session.context.transferReason = aiResponse.reason;
      await setSession(phone, session);
      
      await sendMessage(tenant, phone, 
        '👤 Un momento, te comunico con un asesor humano que te ayudará mejor. ' +
        'Tiempo estimado de respuesta: 5-10 minutos.'
      );
      
      // Notify human agents
      await notifyHumanAgents(tenant, customer, content, aiResponse.reason);
      
      await logEvent(tenant.id, customer.id, 'human_handoff', {
        reason: aiResponse.reason
      });
    } else {
      // Send AI response
      await sendMessage(tenant, phone, aiResponse.text);
      
      // Update session
      session.state = aiResponse.state || session.state;
      session.context = { ...session.context, ...aiResponse.context };
      session.messageCount++;
      await setSession(phone, session);
      
      await logMessage(tenant.id, customer.id, null, 'outbound', 'ai', aiResponse.text);
    }

    // Update customer last contact
    await updateCustomer(customer.id, { last_contact_at: new Date().toISOString() });

    await logEvent(tenant.id, customer.id, 'message_processed', {
      type: messageType,
      intent: aiResponse.intent,
      aiConfidence: aiResponse.confidence
    });

  } catch (error) {
    logger.error('Error handling message:', error);
    
    // Send fallback message
    try {
      await sendMessage(tenant, message.from,
        '😅 Disculpa, tuve un problema técnico. ' +
        'Un asesor se comunicará contigo pronto.'
      );
      await notifyHumanAgents(tenant, null, 'Error técnico en el agente', 'technical_error');
    } catch (sendError) {
      logger.error('Error sending fallback:', sendError);
    }
  }
}

// Extract content from different message types
function extractContent(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    case 'image':
      return '[Imagen recibida]';
    case 'interactive':
      return message.interactive?.button_reply?.title || 
             message.interactive?.list_reply?.title || '';
    case 'button':
      return message.button?.text || '';
    default:
      return '[Mensaje no soportado]';
  }
}

// Check if current time is within business hours
function checkBusinessHours(businessHours) {
  if (!businessHours) return true; // Default: always open
  
  const now = new Date();
  const day = now.toLocaleLowerCase().substring(0, 3); // 'mon', 'tue', etc.
  const time = now.toTimeString().substring(0, 5); // 'HH:MM'
  
  const hours = businessHours[day];
  if (!hours) return false;
  
  return time >= hours.open && time <= hours.close;
}

// Log message to database
async function logMessage(tenantId, customerId, whatsappId, direction, senderType, content) {
  try {
    await query(
      `INSERT INTO messages (tenant_id, customer_id, whatsapp_message_id, direction, sender_type, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, customerId, whatsappId, direction, senderType, content]
    );
  } catch (error) {
    logger.error('Error logging message:', error);
  }
}

// Notify human agents about handoff
async function notifyHumanAgents(tenant, customer, lastMessage, reason) {
  // TODO: Implement notification system (email, push, SMS to agents)
  logger.warn('🚨 Human handoff needed:', {
    tenant: tenant.id,
    customer: customer?.phone,
    reason,
    lastMessage
  });
}

module.exports = { handleMessage };
