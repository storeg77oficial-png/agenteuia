/**
 * AI Agent Engine (mimo V2.5 PRO)
 * Core conversation processing with anti-hallucination
 */

const { logger } = require('../utils/logger');
const { searchProducts, getProductById, checkStock } = require('../shopify/products');
const { getOrderStatus, createOrder } = require('../shopify/orders');
const { getTrainingData } = require('./training');
const { cacheGet, cacheSet } = require('../db/redis');
const { handleSellerTurn } = require('./seller');
const { loadKnowledge } = require('./catalog');
const { normalizeSlang, INTENT_PATTERNS: P } = require('./colombian');

// Intent detection patterns
const INTENTS = {
  GREETING: 'greeting',
  PRODUCT_SEARCH: 'product_search',
  PRODUCT_DETAIL: 'product_detail',
  STOCK_CHECK: 'stock_check',
  ORDER_STATUS: 'order_status',
  ORDER_CREATE: 'order_create',
  FAQ: 'faq',
  PRICING: 'pricing',
  SHIPPING: 'shipping',
  PAYMENT: 'payment',
  WARRANTY: 'warranty',
  COMPLAINT: 'complaint',
  HUMAN_REQUEST: 'human_request',
  GOODBYE: 'goodbye',
  UNKNOWN: 'unknown',
};

// Anti-hallucination keywords that trigger caution
const CAUTION_KEYWORDS = [
  'no se', 'no estoy seguro', 'creo que', 'tal vez', 'posiblemente',
  'podría ser', 'no tengo información', 'no dispongo', 'consultar'
];

const SELLER_INTENTS = [INTENTS.PRODUCT_SEARCH, INTENTS.PRODUCT_DETAIL, INTENTS.STOCK_CHECK, INTENTS.PRICING, INTENTS.UNKNOWN];

// Keep the last turns so the seller understands follow-ups like "y en talla M?"
function withHistory(response, session, message) {
  const history = [...(session.context?.history || []),
    { role: 'user', content: message },
    { role: 'assistant', content: response.text || '' }].slice(-8);
  return { ...response, context: { ...(response.context || {}), history } };
}

/**
 * Process a message with the AI agent
 */
async function processWithAI(tenant, customer, session, message, messageType, extras = {}) {
  try {
    // 1. Detect intent
    let intent = detectIntent(message, session);

    // Product conversations (brands, categories, sizes, follow-ups, customer photos) go to the catalog-grounded seller
    if (extras.imageDescription || SELLER_INTENTS.includes(intent)) {
      const sellerResponse = await handleSellerTurn(tenant, customer, session, message, extras);
      return withHistory(sellerResponse, session, message);
    }
    
    // 2. Get relevant context
    const context = await buildContext(tenant, customer, session, intent, message);
    
    // 3. Check training data first (FAQ)
    if (intent === INTENTS.FAQ || intent === INTENTS.PRICING || 
        intent === INTENTS.SHIPPING || intent === INTENTS.PAYMENT || 
        intent === INTENTS.WARRANTY) {
      const trainingResponse = await checkTrainingData(tenant.id, message);
      if (trainingResponse) {
        return withHistory({
          text: trainingResponse,
          intent: intent,
          confidence: 0.95,
          state: session.state,
          context: session.context,
          transferToHuman: false
        }, session, message);
      }
    }

    // 4. Handle specific intents
    const response = await handleIntent(tenant, customer, session, intent, message, context);
    
    // 5. Validate response (anti-hallucination)
    const validatedResponse = await validateResponse(tenant, response, intent);
    
    return withHistory(validatedResponse, session, message);
  } catch (error) {
    logger.error('AI processing error:', error);
    return {
      text: '😅 Disculpa, tuve un problema procesando tu mensaje. ¿Podrías reformularlo?',
      intent: INTENTS.UNKNOWN,
      confidence: 0,
      state: session.state,
      context: session.context,
      transferToHuman: false
    };
  }
}

/**
 * Detect user intent from message
 * ORDER MATTERS: more specific intents first
 */
function detectIntent(message, session) {
  const msg = normalizeSlang(message);
  
  // Human request (check FIRST - high priority)
  if (/asesor|hablar con|humano|persona|agente|operador|ayuda humana|quiero.*asesor/i.test(msg)) {
    return INTENTS.HUMAN_REQUEST;
  }
  
  // Upset customers go to a human before anything else
  if (P.complaint.test(msg)) {
    return INTENTS.COMPLAINT;
  }

  // Greetings
  if (P.greeting.test(msg)) {
    return INTENTS.GREETING;
  }
  
  // Goodbye
  if (P.thanks.test(msg) && msg.split(' ').length <= 4) {
    return INTENTS.GOODBYE;
  }
  
  // Shipping (BEFORE order status - envío is in both)
  if (P.shipping.test(msg) || /\b(envio|enviar|entrega)\b/.test(msg)) {
    return INTENTS.SHIPPING;
  }
  
  // Warranty (BEFORE product search - tienen/tenga can overlap)
  if (P.warranty.test(msg)) {
    return INTENTS.WARRANTY;
  }
  
  // Payment (BEFORE product search)
  if (P.payment.test(msg) || /\b(pago|pagar|metodo)\b/.test(msg)) {
    return INTENTS.PAYMENT;
  }
  
  // FAQ (BEFORE order status - "dónde están" vs "dónde está mi pedido")
  if (P.pickup.test(msg) || /horario|direccion|contacto|telefono|email|correo/.test(msg)) {
    return INTENTS.FAQ;
  }
  
  // Order status
  if (/pedido|orden|mi compra|compra\s*#?\d+|estado|d[oó]nde est[aá]|donde esta|tracking|rastreo/i.test(msg)) {
    return INTENTS.ORDER_STATUS;
  }
  
  // Complaint
  if (/queja|problema|mal servicio|error|insatisfecho/i.test(msg)) {
    return INTENTS.COMPLAINT;
  }
  
  // Pricing
  if (/precio|cuesta|vale|cu[aá]nto|cuanto|costo/i.test(msg)) {
    return INTENTS.PRICING;
  }
  
  // Stock check
  if (/disponible|stock|agotado|quedan|talla|tallas/i.test(msg)) {
    return INTENTS.STOCK_CHECK;
  }
  
  // Product search (LOWER priority - catch-all for product-related)
  if (/busco|buscando|buscar|quiero|necesito|tienen|hay|mostrar|ver|cat[aá]logo|catalogo|ropa|camisa|camisetas|pantalon|pantalones|zapato|zapatos|gorra|gorras|sudadera|sudaderas|jean|jeans|conjunto|conjuntos|blusa|blusas|biker|bikers|tenis|prenda|prendas|vestido|vestidos|falda|faldas|buzo|buzos/i.test(msg)) {
    return INTENTS.PRODUCT_SEARCH;
  }

  // Colombian phrasing for buying, availability, photos, haggling and authenticity
  if (P.buy.test(msg) || P.availability.test(msg) || P.photo.test(msg) || P.bargain.test(msg) || P.authenticity.test(msg)) {
    return INTENTS.PRODUCT_SEARCH;
  }
  
  // Check conversation context for continuation
  if (session.state === 'browsing' && session.context.lastProduct) {
    return INTENTS.PRODUCT_DETAIL;
  }
  
  return INTENTS.UNKNOWN;
}

/**
 * Build context for AI response
 */
async function buildContext(tenant, customer, session, intent, message) {
  const context = {
    business: {
      name: tenant.business_name,
      address: tenant.address,
      city: tenant.city,
      phone: tenant.phone,
      email: tenant.email,
      hours: tenant.business_hours,
    },
    customer: {
      name: customer.name,
      segment: customer.segment,
      totalOrders: customer.total_orders,
    },
    session: {
      state: session.state,
      messageCount: session.messageCount,
      ...session.context
    },
    intent: intent
  };

  // Add product context for product-related intents
  if ([INTENTS.PRODUCT_SEARCH, INTENTS.PRODUCT_DETAIL, INTENTS.STOCK_CHECK, INTENTS.PRICING].includes(intent)) {
    const products = await searchProducts(tenant.id, message);
    context.products = products;
  }

  return context;
}

/**
 * Handle specific intents with appropriate responses
 */
async function handleIntent(tenant, customer, session, intent, message, context) {
  switch (intent) {
    case INTENTS.GREETING:
      return await handleGreeting(tenant, customer, session);
    
    case INTENTS.PRODUCT_SEARCH:
      return await handleProductSearch(tenant, message, context);
    
    case INTENTS.PRODUCT_DETAIL:
      return await handleProductDetail(tenant, session, message);
    
    case INTENTS.STOCK_CHECK:
      return await handleStockCheck(tenant, message, context);
    
    case INTENTS.ORDER_STATUS:
      return await handleOrderStatus(tenant, customer, message);
    
    case INTENTS.PRICING:
      return await handlePricing(tenant, message, context);
    
    case INTENTS.SHIPPING:
      return handleShipping(tenant);
    
    case INTENTS.PAYMENT:
      return handlePayment(tenant);
    
    case INTENTS.WARRANTY:
      return handleWarranty(tenant);
    
    case INTENTS.FAQ:
      return handleFAQ(tenant, message);
    
    case INTENTS.HUMAN_REQUEST:
      return { 
        text: 'Con mucho gusto 😊 Ya le aviso a una asesora del equipo para que te escriba por aquí en un momento. Mientras tanto, cuéntame qué estás buscando y te voy adelantando.',
        intent: INTENTS.HUMAN_REQUEST, 
        confidence: 1.0, 
        state: session.state, 
        context: session.context,
        transferToHuman: true, 
        reason: 'Customer requested human agent' 
      };
    
    case INTENTS.COMPLAINT:
      return { 
        text: 'Lamento mucho lo que me cuentas, de verdad 🙏 Quiero que lo resolvamos bien: ya le paso tu caso a una asesora del equipo para que te escriba por aquí lo más pronto posible. Si tienes el número de pedido o una foto, envíalo.',
        intent: INTENTS.COMPLAINT, 
        confidence: 0.9, 
        state: session.state, 
        context: session.context,
        transferToHuman: true, 
        reason: 'Customer complaint detected' 
      };
    
    case INTENTS.GOODBYE:
      return handleGoodbye(customer);
    
    default:
      return handleUnknown(tenant, session);
  }
}

// ─── Intent Handlers ───────────────────────────────────────────

async function handleGreeting(tenant, customer, session) {
  const hour = new Date().getHours();
  let greeting = hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches';
  
  if (session.messageCount === 0) {
    const knowledge = await loadKnowledge(tenant.id);
    const cats = [...knowledge.categories.values()].sort((a, b) => b.count - a.count).slice(0, 5).map(c => c.name);
    const brands = [...knowledge.brands.values()].sort((a, b) => b.count - a.count).slice(0, 6).map(b => b.name);
    return {
      text: `${greeting} ${customer.name && customer.name !== 'Cliente' ? customer.name : ''}! 👋 Bienvenido a *${tenant.business_name}*.\n\n` +
            (cats.length ? `Tenemos ${cats.join(', ')} y más, de marcas como ${brands.join(', ')}.\n\n` : '') +
            `Cuéntame qué estás buscando (marca, prenda o talla) y te digo al instante qué tenemos disponible.`,
      intent: INTENTS.GREETING,
      confidence: 1.0,
      state: 'browsing',
      context: {},
      transferToHuman: false
    };
  } else {
    return {
      text: `${greeting}! 👋 ¿En qué te puedo ayudar?`,
      intent: INTENTS.GREETING,
      confidence: 1.0,
      state: session.state,
      context: session.context,
      transferToHuman: false
    };
  }
}

async function handleProductSearch(tenant, message, context) {
  const products = context.products;
  
  if (!products || products.length === 0) {
    return {
      text: '🔍 No encontré productos con esa búsqueda. ¿Podrías ser más específico?\n\n' +
            'Puedes buscar por:\n• Categoría (camisetas, zapatos, jeans...)\n• Marca (Nike, Adidas, Calvin Klein...)\n• Tipo (conjunto, biker, blusa...)',
      intent: INTENTS.PRODUCT_SEARCH,
      confidence: 0.8,
      state: 'browsing',
      context: {},
      transferToHuman: false
    };
  }

  // Format product list
  let response = '🛍️ *Productos encontrados:*\n\n';
  const displayProducts = products.slice(0, 5); // Show max 5
  
  displayProducts.forEach((product, index) => {
    const stockStatus = product.in_stock ? '✅ Disponible' : '❌ Agotado';
    response += `${index + 1}. *${product.title}*\n`;
    response += `   💰 $${formatPrice(product.price)} COP\n`;
    let sizes = product.sizes;
    try { sizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes; } catch(e) {}
    response += `   📏 Tallas: ${Array.isArray(sizes) ? sizes.join(', ') : 'Única'}\n`;
    response += `   ${stockStatus}\n\n`;
  });

  if (products.length > 5) {
    response += `... y ${products.length - 5} productos más. ¿Te muestro más opciones?\n\n`;
  }

  response += '¿Te interesa alguno? Escribe el número o el nombre.';

  return {
    text: response,
    intent: INTENTS.PRODUCT_SEARCH,
    confidence: 0.9,
    state: 'browsing',
    context: { lastProducts: displayProducts.map(p => p.id) },
    transferToHuman: false
  };
}

async function handleProductDetail(tenant, session, message) {
  const productId = session.context.lastProduct;
  if (!productId) {
    return await handleProductSearch(tenant, message, { products: [] });
  }

  const product = await getProductById(tenant.id, productId);
  if (!product) {
    return {
      text: '😕 No encontré ese producto. ¿Podrías decirme qué buscas?',
      intent: INTENTS.PRODUCT_DETAIL,
      confidence: 0.7,
      state: 'browsing',
      context: {},
      transferToHuman: false
    };
  }

  const stockStatus = product.in_stock 
    ? `✅ *Disponible* (${product.stock_quantity} unidades)` 
    : '❌ *Agotado temporalmente*';

  let response = `📦 *${product.title}*\n\n`;
  response += `${product.description || ''}\n\n`;
  response += `💰 *Precio:* $${formatPrice(product.price)} COP\n`;
  response += `📏 *Tallas:* ${product.sizes?.join(', ') || 'Única'}\n`;
  response += `🎨 *Colores:* ${product.colors?.join(', ') || 'Consultar'}\n`;
  response += `${stockStatus}\n\n`;

  if (product.in_stock) {
    response += '¿Te gustaría comprarlo? Escribe "comprar" o dime tu talla.';
  } else {
    response += '¿Quieres que te avisen cuando vuelva a estar disponible?';
  }

  return {
    text: response,
    intent: INTENTS.PRODUCT_DETAIL,
    confidence: 0.95,
    state: 'browsing',
    context: { lastProduct: productId },
    transferToHuman: false
  };
}

async function handleStockCheck(tenant, message, context) {
  const products = context.products;
  
  if (!products || products.length === 0) {
    return {
      text: '📏 ¿De qué producto quieres consultar la talla y disponibilidad?',
      intent: INTENTS.STOCK_CHECK,
      confidence: 0.7,
      state: 'browsing',
      context: {},
      transferToHuman: false
    };
  }

  let response = '📏 *Disponibilidad:*\n\n';
  products.slice(0, 3).forEach(product => {
    response += `*${product.title}*\n`;
    if (product.sizes && product.sizes.length > 0) {
      product.sizes.forEach(size => {
        const inStock = product.stock_quantity > 0;
        response += `  ${size}: ${inStock ? '✅' : '❌'}\n`;
      });
    } else {
      response += `  ${product.in_stock ? '✅ Disponible' : '❌ Agotado'}\n`;
    }
    response += '\n';
  });

  return {
    text: response,
    intent: INTENTS.STOCK_CHECK,
    confidence: 0.9,
    state: 'browsing',
    context: { lastProducts: products.map(p => p.id) },
    transferToHuman: false
  };
}

async function handleOrderStatus(tenant, customer, message) {
  // Extract order number from message
  const orderMatch = message.match(/#?(\d{4,})/);
  
  if (!orderMatch) {
    return {
      text: '📦 Para consultar tu pedido, necesito el número de orden.\n\n' +
            '¿Tienes el número de pedido? También puedo buscar por tu nombre.',
      intent: INTENTS.ORDER_STATUS,
      confidence: 0.8,
      state: 'tracking',
      context: {},
      transferToHuman: false
    };
  }

  const orderNumber = orderMatch[1];
  const order = await getOrderStatus(tenant.id, customer.id, orderNumber);

  if (!order) {
    return {
      text: `😕 No encontré un pedido con el número #${orderNumber}.\n\n` +
            '¿Podrías verificar el número? También puedes darnos tu nombre para buscarlo.',
      intent: INTENTS.ORDER_STATUS,
      confidence: 0.8,
      state: 'tracking',
      context: {},
      transferToHuman: false
    };
  }

  const statusEmoji = {
    'pending': '⏳',
    'confirmed': '✅',
    'processing': '📦',
    'shipped': '🚚',
    'delivered': '🎉',
    'cancelled': '❌'
  };

  let response = `${statusEmoji[order.status] || '📦'} *Pedido #${order.order_number}*\n\n`;
  response += `*Estado:* ${getStatusText(order.status)}\n`;
  
  if (order.tracking_number) {
    response += `*Tracking:* ${order.tracking_number}\n`;
    response += `*Transportadora:* ${order.carrier}\n`;
  }
  
  if (order.estimated_delivery) {
    response += `*Entrega estimada:* ${formatDate(order.estimated_delivery)}\n`;
  }

  response += `\n*Productos:*\n`;
  order.items.forEach(item => {
    response += `• ${item.title} (${item.size}) x${item.quantity}\n`;
  });

  response += `\n💰 *Total:* $${formatPrice(order.total)} COP`;

  return {
    text: response,
    intent: INTENTS.ORDER_STATUS,
    confidence: 0.95,
    state: 'tracking',
    context: { lastOrder: order.id },
    transferToHuman: false
  };
}

async function handlePricing(tenant, message, context) {
  const products = context.products;
  
  if (products && products.length > 0) {
    let response = '💰 *Precios:*\n\n';
    products.slice(0, 3).forEach(product => {
      response += `*${product.title}*\n`;
      response += `  💵 $${formatPrice(product.price)} COP\n`;
      if (product.compare_at_price && product.compare_at_price > product.price) {
        const discount = Math.round((1 - product.price / product.compare_at_price) * 100);
        response += `  ~~$${formatPrice(product.compare_at_price)}~~ (-${discount}%)\n`;
      }
      response += '\n';
    });
    
    return {
      text: response,
      intent: INTENTS.PRICING,
      confidence: 0.9,
      state: 'browsing',
      context: { lastProducts: products.map(p => p.id) },
      transferToHuman: false
    };
  }

  return {
    text: '💰 Nuestros precios varían según el producto:\n\n' +
          '• Camisetas: $120,000 - $270,000\n' +
          '• Conjuntos: $350,000 - $400,000\n' +
          '• Zapatos: $450,000 - $900,000\n' +
          '• Jeans: $240,000\n' +
          '• Gorras: $80,000 - $150,000\n\n' +
          '¿Qué producto te interesa?',
    intent: INTENTS.PRICING,
    confidence: 0.8,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handleShipping(tenant) {
  return {
    text: '🚚 *Información de envíos:*\n\n' +
          '📍 *Medellín:* Envío mismo día o siguiente día\n' +
          '📍 *Resto de Colombia:* 2-5 días hábiles\n' +
          '💰 *Costo:* Varía según ciudad y peso\n\n' +
          '📦 *Pago contraentrega disponible en Medellín*\n\n' +
          '¿A qué ciudad necesitas el envío?',
    intent: INTENTS.SHIPPING,
    confidence: 0.95,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handlePayment(tenant) {
  return {
    text: '💳 *Métodos de pago:*\n\n' +
          '✅ Efectivo (contraentrega en Medellín)\n' +
          '✅ Transferencia bancaria (Nequi, Daviplata)\n' +
          '✅ Tarjeta de crédito/débito\n\n' +
          '🛡️ *Compra 100% segura*\n\n' +
          '¿Cuál método prefieres?',
    intent: INTENTS.PAYMENT,
    confidence: 0.95,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handleWarranty(tenant) {
  return {
    text: '🛡️ *Garantía y cambios:*\n\n' +
          '✅ Todos nuestros productos tienen garantía de calidad\n' +
          '🔄 Cambios por talla dentro de los primeros 15 días\n' +
          '↩️ Devoluciones por defecto de fábrica\n\n' +
          'Para un cambio o devolución, escríbenos con tu número de pedido.',
    intent: INTENTS.WARRANTY,
    confidence: 0.95,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handleFAQ(tenant, message) {
  return {
    text: `📍 *${tenant.business_name}*\n\n` +
          `🏠 ${tenant.address}\n` +
          `📱 ${tenant.phone}\n` +
          `📧 ${tenant.email}\n` +
          `🕐 Horario: Lunes a Sábado 11:00 AM - 9:00 PM\n\n` +
          `¿En qué más te puedo ayudar?`,
    intent: INTENTS.FAQ,
    confidence: 0.9,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handleGoodbye(customer) {
  return {
    text: `¡Gracias por visitarnos ${customer.name || ''}! 👋\n\n` +
          'Si necesitas algo más, aquí estamos. ¡Que tengas un excelente día! 😊',
    intent: INTENTS.GOODBYE,
    confidence: 1.0,
    state: 'browsing',
    context: {},
    transferToHuman: false
  };
}

function handleUnknown(tenant, session) {
  session.context.unknownCount = (session.context.unknownCount || 0) + 1;
  
  // After 2 unknowns, offer human transfer
  if (session.context.unknownCount >= 2) {
    return {
      text: '😕 Parece que no estoy entendiendo bien tu consulta.\n\n' +
            '¿Prefieres que te conecte con un asesor humano?',
      intent: INTENTS.UNKNOWN,
      confidence: 0.5,
      state: session.state,
      context: session.context,
      transferToHuman: false
    };
  }

  return {
    text: '🤔 No estoy seguro de entender. ¿Podrías reformular tu pregunta?\n\n' +
          'Puedo ayudarte con:\n• Buscar productos\n• Consultar precios\n• Estado de pedidos\n• Información de envíos',
    intent: INTENTS.UNKNOWN,
    confidence: 0.5,
    state: session.state,
    context: session.context,
    transferToHuman: false
  };
}

// ─── Validation & Helpers ──────────────────────────────────────

/**
 * Validate AI response to prevent hallucination
 */
async function validateResponse(tenant, response, intent) {
  // If no text (e.g. human transfer), skip validation
  if (!response.text) {
    return response;
  }

  // Check for caution keywords
  const hasCaution = CAUTION_KEYWORDS.some(keyword => 
    response.text.toLowerCase().includes(keyword)
  );

  if (hasCaution && response.confidence < 0.7) {
    logger.warn('⚠️ Low confidence response detected, offering human transfer');
    return {
      ...response,
      text: response.text + '\n\n¿Prefieres hablar con un asesor humano para información más precisa?',
      transferToHuman: false // Don't auto-transfer, let user decide
    };
  }

  // Validate product information against database
  if ([INTENTS.PRODUCT_SEARCH, INTENTS.PRODUCT_DETAIL, INTENTS.STOCK_CHECK].includes(intent)) {
    // Product info is already fetched from DB, so it's valid
  }

  return response;
}

/**
 * Check training data for FAQ matches
 */
async function checkTrainingData(tenantId, message) {
  try {
    const trainingData = await getTrainingData(tenantId);
    
    if (!trainingData || trainingData.length === 0) return null;

    // Simple keyword matching (can be enhanced with embeddings)
    const msg = message.toLowerCase();
    
    for (const item of trainingData) {
      const questionWords = item.question.toLowerCase().split(' ');
      const matchCount = questionWords.filter(word => msg.includes(word)).length;
      
      if (matchCount >= questionWords.length * 0.6) {
        return item.answer;
      }
    }

    return null;
  } catch (error) {
    logger.error('Error checking training data:', error);
    return null;
  }
}

// Format price with thousands separator
function formatPrice(price) {
  return new Intl.NumberFormat('es-CO').format(price);
}

// Format date
function formatDate(date) {
  return new Date(date).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Get status text
function getStatusText(status) {
  const texts = {
    'pending': 'Pendiente',
    'confirmed': 'Confirmado',
    'processing': 'En preparación',
    'shipped': 'Enviado',
    'delivered': 'Entregado',
    'cancelled': 'Cancelado'
  };
  return texts[status] || status;
}

module.exports = { processWithAI, INTENTS };
