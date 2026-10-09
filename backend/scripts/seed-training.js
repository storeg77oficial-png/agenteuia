/**
 * Seed Training Data for STORE SG MEDELLÍN
 * Works with SQLite (local development)
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'storesg.db');

if (!fs.existsSync(dbPath)) {
  console.error('Database not found. Run the server first to create it.');
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const trainingData = [
  { category: 'faq', question: '¿Cuál es el horario de atención?', answer: '🕐 Nuestro horario es de Lunes a Sábado de 11:00 AM a 9:00 PM. ¡Te esperamos!' },
  { category: 'faq', question: '¿Dónde están ubicados?', answer: '📍 Estamos en Carrera 49A #94-58, Medellín, Colombia. ¡Ven a visitarnos!' },
  { category: 'faq', question: '¿Cuál es el número de teléfono?', answer: '📱 Puedes escribirnos por WhatsApp al +57 300 211 0658 o por correo a storegmedellin@gmail.com' },
  { category: 'faq', question: '¿Tienen tienda física?', answer: '¡Sí! Tenemos tienda física en Medellín. También puedes comprar por WhatsApp y te enviamos a todo Colombia.' },
  { category: 'shipping', question: '¿Hacen envíos?', answer: '🚚 ¡Sí! Hacemos envíos a todo Colombia.\n\n📍 *Medellín:* Envío mismo día o siguiente día\n📍 *Resto de Colombia:* 2-5 días hábiles' },
  { category: 'shipping', question: '¿Cuánto cuesta el envío?', answer: '💰 El costo varía según ciudad y peso. En Medellín desde $5,000 COP. Para otras ciudades te cotizamos al confirmar tu pedido.' },
  { category: 'payment', question: '¿Qué métodos de pago aceptan?', answer: '💳 Aceptamos:\n✅ Efectivo (contraentrega en Medellín)\n✅ Transferencia bancaria (Nequi, Daviplata)\n✅ Tarjeta de crédito/débito' },
  { category: 'payment', question: '¿Tienen pago contra entrega?', answer: '¡Sí! Tenemos pago contraentrega disponible en Medellín. Para otras ciudades manejamos pago previo por transferencia o tarjeta.' },
  { category: 'warranty', question: '¿Tienen garantía?', answer: '🛡️ ¡Todos nuestros productos tienen garantía de calidad!\n\n🔄 Cambios por talla dentro de los primeros 15 días\n↩️ Devoluciones por defecto de fábrica' },
  { category: 'product_info', question: '¿Qué conjuntos tienen?', answer: '🧥 Tenemos conjuntos premium:\n• BOSS Turco - $380,000\n• LACOSTE Turco - $400,000\n• COACH Turco - $400,000\n• NIKE NOCTA - $350,000\n\nTallas: S, M, L, XL, 2XL' },
  { category: 'product_info', question: '¿Qué camisetas tienen?', answer: '👕 Camisetas premium:\n• BURBERRY Turca - $270,000\n• ARMANI EXCHANGE - $120,000\n• GUCCI Turca - $220,000\n• EMOTION Premium - $160,000\n• LOUIS VUITTON - $270,000' },
  { category: 'product_info', question: '¿Qué zapatos tienen?', answer: '👟 Tenis premium:\n• LV Stellar Turco - $900,000\n• CK Alondra Original - $450,000\n• OFF Out of Office - $780,000\n• GUESS Lawrence - $550,000' },
  { category: 'product_info', question: '¿Qué jeans tienen?', answer: '👖 Jeans PURPLE premium:\n• PB228 - $240,000\n• PB132 - $240,000\n• PB128 - $240,000\n• PB192 - $240,000\n• PB119 - $240,000' },
  { category: 'product_info', question: '¿Qué tallas manejan?', answer: '📏 Tallas por producto:\n• *Ropa:* XS, S, M, L, XL, 2XL\n• *Jeans:* 30, 32, 34, 36, 38\n• *Zapatos:* 40, 41, 42' },
  { category: 'product_info', question: '¿Qué marcas tienen?', answer: '🏷️ Marcas premium: Nike, Adidas, Calvin Klein, Burberry, Gucci, Louis Vuitton, Armani, Coach, Lacoste, Purple, Michael Kors, Emotion, Godspeed, Off White, Guess' },
  { category: 'order', question: '¿Cómo puedo rastrear mi pedido?', answer: '📦 Para rastrear tu pedido:\n1. Escribe tu número de pedido\n2. Te diremos el estado actual\n3. Si está enviado, te daremos el número de guía' },
];

function seed() {
  console.log('🌱 Seeding training data for STORE SG MEDELLÍN...\n');

  let tenant = db.prepare('SELECT id FROM tenants WHERE business_name = ?').get('STORE SG MEDELLÍN');

  if (!tenant) {
    const stmt = db.prepare(`
      INSERT INTO tenants (name, business_name, email, phone, address, city, website, business_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      'STORE SG',
      'STORE SG MEDELLÍN',
      'storegmedellin@gmail.com',
      '+573002110658',
      'Carrera 49A #94-58',
      'Medellín',
      'https://storesgmedellin.co/',
      JSON.stringify({
        mon: { open: '11:00', close: '21:00' },
        tue: { open: '11:00', close: '21:00' },
        wed: { open: '11:00', close: '21:00' },
        thu: { open: '11:00', close: '21:00' },
        fri: { open: '11:00', close: '21:00' },
        sat: { open: '11:00', close: '21:00' }
      })
    );
    
    tenant = db.prepare('SELECT id FROM tenants WHERE business_name = ?').get('STORE SG MEDELLÍN');
    console.log('✅ Created tenant: STORE SG MEDELLÍN');
  } else {
    console.log('ℹ️  Tenant already exists');
  }

  const tenantId = tenant.id;
  const insertStmt = db.prepare('INSERT OR IGNORE INTO ai_training_data (tenant_id, category, question, answer) VALUES (?, ?, ?, ?)');

  let inserted = 0;
  for (const item of trainingData) {
    const result = insertStmt.run(tenantId, item.category, item.question, item.answer);
    if (result.changes > 0) inserted++;
  }

  console.log('✅ Inserted ' + inserted + ' training items');
  
  const count = db.prepare('SELECT COUNT(*) as count FROM ai_training_data WHERE tenant_id = ?').get(tenantId);
  console.log('📊 Total training items: ' + count.count);
  
  console.log('\n🎉 Seeding complete!');
}

seed();
db.close();
