# Guía de Implementación - STORE SG MEDELLÍN

## ✅ Lo que ya está construido

### Backend Completo (25 archivos)
- **Server**: Express.js con seguridad, rate limiting, CORS
- **WhatsApp**: Webhook handler + Message sender (texto, imagen, botones, listas, templates)
- **Shopify**: Sincronización de productos y pedidos en tiempo real
- **AI Agent**: Motor de conversación con detección de intención y anti-alucinación
- **CRM**: Gestión de tenants (multi-agente), clientes, analytics
- **Database**: PostgreSQL con 10 tablas + migraciones automáticas
- **Cache**: Redis para sesiones y cache de productos
- **Analytics**: Dashboard completo con métricas de ventas, mensajes, clientes

### Datos Pre-cargados
- **25+ FAQs**: Horarios, ubicación, pagos, envíos, garantías
- **Catálogo**: Información de todos los productos de la tienda
- **Tallas**: Disponibilidad por producto
- **Marcas**: Nike, Adidas, Calvin Klein, Burberry, etc.

### Documentación
- Arquitectura del sistema
- Schema de base de datos
- Templates de WhatsApp para Meta
- Guía de deployment en Hostinger

---

## 📋 Próximos Pasos (En Orden)

### Fase 1: Meta Business (Semana 1-2)

#### 1.1 Crear Meta Business Account
```
1. Ve a https://business.facebook.com
2. Crea cuenta de negocio
3. Sube documentación:
   - NIT de la empresa
   - Cámara de comercio
   - RUT
4. Espera verificación (2-5 días)
```

#### 1.2 Configurar WhatsApp Business API
```
1. Ve a https://developers.facebook.com
2. Crea nueva App > Business > WhatsApp
3. Agrega número de teléfono
4. Obtén credenciales:
   - Phone Number ID
   - Business Account ID  
   - Access Token
   - App Secret
```

#### 1.3 Diseñar y Aprobar Templates
```
1. En WhatsApp Manager > Message Templates
2. Crea los 7 templates del archivo WHATSAPP_TEMPLATES.md
3. Envía para aprobación (1-24 horas)
4. Templates necesarios:
   - welcome_message
   - order_confirmation
   - order_shipped
   - abandoned_cart_reminder
   - post_sale_followup
   - back_in_stock
   - payment_reminder
```

### Fase 2: Shopify API (Semana 2)

#### 2.1 Crear Private App en Shopify
```
1. Ve a Shopify Admin > Apps > Develop apps
2. Crea "STORE SG WhatsApp Bot"
3. Configura permisos:
   - Products: Read and write
   - Orders: Read and write
   - Customers: Read and write
   - Inventory: Read
4. Instala la app y copia el Access Token
```

#### 2.2 Configurar Webhooks (Opcional)
```
En Shopify Admin > Settings > Notifications:
- Product creation → https://tu-dominio.com/webhook/shopify/products
- Order creation → https://tu-dominio.com/webhook/shopify/orders
```

### Fase 3: Hosting en Hostinger (Semana 2-3)

#### 3.1 Preparar Servidor
```bash
# Accede por SSH a tu VPS Hostinger
ssh root@tu-ip

# Ejecuta el script de deploy
chmod +x /path/to/scripts/deploy.sh
./scripts/deploy.sh
```

#### 3.2 Configurar Dominio
```
1. En Hostinger panel, apunta tu dominio al VPS
2. Configura SSL con Let's Encrypt
3. Prueba: https://tu-dominio.com/health
```

#### 3.3 Configurar Variables de Entorno
```bash
# En el servidor, edita /var/www/storesg-crm/backend/.env
nano /var/www/storesg-crm/backend/.env

# Agrega tus credenciales reales:
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_ACCESS_TOKEN=xxx
SHOPIFY_ACCESS_TOKEN=xxx
```

### Fase 4: Integración y Pruebas (Semana 3-4)

#### 4.1 Sincronizar Productos
```bash
# Desde tu máquina local o el servidor
curl -X POST https://tu-dominio.com/api/crm/sync/products \
  -H "Authorization: Bearer TU_TOKEN"
```

#### 4.2 Configurar Webhook en Meta
```
1. En Meta for Developers > WhatsApp > Configuration
2. Webhook URL: https://tu-dominio.com/webhook
3. Verify Token: (el de tu .env)
4. Subscribe to: messages, message_deliveries
```

#### 4.3 Probar el Agente
```
1. Envía un mensaje al número de WhatsApp configurado
2. El agente debe responder automáticamente
3. Prueba:
   - "Hola" → Saludo de bienvenida
   - "¿Qué camisetas tienen?" → Lista de productos
   - "¿Cuánto cuesta?" → Precios
   - "¿Hacen envíos?" → Info de envíos
   - "Hablar con asesor" → Transferencia a humano
```

### Fase 5: Dashboard CRM (Semana 4-5)

#### 5.1 Crear Usuario Admin
```bash
# Via API o directamente en la DB
curl -X POST https://tu-dominio.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin",
    "email": "admin@storesgmedellin.co",
    "password": "tu_password_seguro",
    "role": "admin"
  }'
```

#### 5.2 Acceder al Dashboard
```
URL: https://tu-dominio.com/crm
Email: admin@storesgmedellin.co
Password: tu_password_seguro
```

### Fase 6: Capacitación y Soporte (Semana 5-8)

#### 6.1 Capacitación del Cliente
```
- Cómo ver analytics
- Cómo responder conversaciones pendientes
- Cómo agregar datos de entrenamiento
- Cómo sincronizar productos
- Cómo ver reportes de ventas
```

#### 6.2 Soporte Post-Entrega (30 días)
```
- Monitoreo de errores
- Ajustes al agente de IA
- Nuevos datos de entrenamiento
- Optimización de respuestas
- Soporte técnico
```

---

## 🔑 Credenciales Necesarias

### Meta Business
- [ ] Business Manager ID
- [ ] WhatsApp Phone Number ID
- [ ] WhatsApp Business Account ID
- [ ] Access Token
- [ ] App Secret

### Shopify
- [ ] Store URL (ya tienes: storesgmedellin.co)
- [ ] Private App Access Token

### Hostinger
- [ ] IP del servidor
- [ ] Usuario SSH
- [ ] Contraseña SSH

### Dominio
- [ ] Dominio a usar (ej: api.storesgmedellin.co)

---

## 📞 Puntos de Contacto

### Para el Cliente
- Definir cuándo transferir a humano
- Definir horarios de atención de asesores
- Definir respuestas especiales para quejas

### Para Técnicos
- Acceso a Meta Business Manager
- Acceso a Shopify Admin
- Acceso al servidor Hostinger

---

## 💰 Costos Estimados

| Concepto | Costo Mensual |
|----------|---------------|
| Hostinger VPS | $10-20 USD |
| Meta Business (verificado) | Gratis |
| WhatsApp Business API | ~$0.05 USD/mensaje |
| Dominio | $10-15 USD/año |
| **Total estimado** | **$30-50 USD/mes** |

---

## 📊 Métricas de Éxito

- Tiempo de respuesta del agente: < 5 segundos
- Tasa de resolución automática: > 70%
- Satisfacción del cliente: > 4/5
- Conversión de carritos abandonados: > 15%
- Reducción de tiempo de asesores: > 50%
