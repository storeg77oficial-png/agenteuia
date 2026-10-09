# STORE SG MEDELLÍN — CRM + WhatsApp AI Agent

Sistema completo de CRM con agente de IA para WhatsApp, integrado con Shopify.

## 🚀 Características

- ✅ Agente de IA para WhatsApp (mimo V2.5 PRO)
- ✅ Integración con Shopify (productos, pedidos, inventario)
- ✅ CRM multi-tenant (múltiples cuentas de WhatsApp)
- ✅ Dashboard de analytics profesional
- ✅ Detección de intención automática
- ✅ Anti-alucinación (solo responde con datos reales)
- ✅ Transferencia a agente humano
- ✅ Templates de WhatsApp aprobados por Meta
- ✅ Carritos abandonados
- ✅ Seguimiento posventa
- ✅ Entrenamiento personalizado del agente

## 📋 Requisitos

- Servidor VPS (Hostinger recomendado)
- Node.js 20+
- PostgreSQL 14+
- Redis 6+
- Cuenta de Meta Business
- Tienda Shopify activa

## 🛠️ Instalación

### 1. Clonar el proyecto

```bash
cd /var/www
git clone https://github.com/tu-usuario/storesg-crm.git
cd storesg-crm/backend
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus credenciales
```

### 4. Crear base de datos

```bash
sudo -u postgres psql
CREATE DATABASE storesg_crm;
CREATE USER storesg WITH PASSWORD 'tu_password';
GRANT ALL PRIVILEGES ON DATABASE storesg_crm TO storesg;
\q
```

### 5. Ejecutar migraciones

```bash
node migrations/run.js
```

### 6. Cargar datos de entrenamiento

```bash
node scripts/seed-training.js
```

### 7. Iniciar servidor

```bash
# Desarrollo
npm run dev

# Producción con PM2
pm2 start src/server.js --name storesg-crm
```

## 📱 Configuración de WhatsApp Business API

### Paso 1: Crear Meta Business Account

1. Ve a [business.facebook.com](https://business.facebook.com)
2. Crea una cuenta de negocio
3. Verifica tu negocio

### Paso 2: Configurar WhatsApp Business API

1. Ve a Meta for Developers
2. Crea una nueva App
3. Agrega el producto "WhatsApp"
4. Configura el número de teléfono
5. Obtén los credenciales:
   - Phone Number ID
   - Business Account ID
   - Access Token
   - App Secret

### Paso 3: Configurar Webhook

1. En Meta for Developers > WhatsApp > Configuration
2. Webhook URL: `https://tu-dominio.com/webhook`
3. Verify Token: (el que configuraste en .env)
4. Subscribe to: `messages`, `message_deliveries`

### Paso 4: Crear Templates

Sigue las instrucciones en `docs/WHATSAPP_TEMPLATES.md`

## 🛍️ Configuración de Shopify

### Paso 1: Crear Private App

1. Ve a Shopify Admin > Apps > Develop apps
2. Crea una nueva app
3. Configura los permisos:
   - Products: Read and write
   - Orders: Read and write
   - Customers: Read and write

### Paso 2: Obtener credenciales

1. Copia el Access Token
2. Configura en .env:
   ```
   SHOPIFY_STORE_URL=https://storesgmedellin.co
   SHOPIFY_ACCESS_TOKEN=shpat_xxxxx
   ```

### Paso 3: Configurar Webhooks (opcional)

En Shopify Admin > Settings > Notifications > Webhooks:
- Product creation: `https://tu-dominio.com/webhook/shopify/products`
- Order creation: `https://tu-dominio.com/webhook/shopify/orders`

## 🤖 Entrenamiento del Agente

### Datos pre-cargados

El agente ya incluye información sobre:
- Horarios de atención
- Ubicación
- Métodos de pago
- Envíos y garantías
- Catálogo de productos
- Tallas disponibles

### Agregar nuevos datos

```bash
# Via API
curl -X POST https://tu-dominio.com/api/crm/training \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "category": "faq",
    "question": "¿Pregunta del cliente?",
    "answer": "Respuesta del agente"
  }'
```

### Bulk import

```bash
curl -X POST https://tu-dominio.com/api/crm/training/bulk \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"category": "faq", "question": "Pregunta 1", "answer": "Respuesta 1"},
      {"category": "faq", "question": "Pregunta 2", "answer": "Respuesta 2"}
    ]
  }'
```

## 📊 Dashboard de Analytics

### Panel CRM

- El panel principal está en `/` y la configuración de canales se conserva en `/settings`.
- Define `CRM_DASHBOARD_PASSWORD` con una contraseña larga y única; localmente puede vivir en `backend/.env.dashboard.local` (excluido por `.gitignore`), y en producción debe configurarse como variable secreta del hosting. El acceso usa una sesión firmada por `API_SECRET_KEY` que vence cada 12 horas.
- Inicia el backend desde la carpeta `backend` para que cargue ese archivo de entorno.
- Las personas atendidas se cuentan por clientes únicos con mensajes entrantes; la conversión relaciona esos clientes con pedidos del mismo periodo.
- La medición de confianza del asistente comienza con las respuestas nuevas. Los mensajes históricos no tienen esa puntuación.
- El panel muestra el estado de carritos abandonados como no conectado hasta que se integre una fuente de checkouts de Shopify.

Rota cualquier credencial que se haya compartido fuera del archivo local antes de publicar el sistema.

### Endpoints

```bash
# Dashboard completo
GET /api/crm/analytics/dashboard?days=30

# Estadísticas en tiempo real
GET /api/crm/analytics/realtime

# Clientes
GET /api/crm/customers?page=1&limit=50

# Detalle de cliente
GET /api/crm/customers/:id
```

### Métricas disponibles

- Conversaciones totales/activas/handoffs
- Mensajes enviados/recibidos
- Pedidos y revenue
- Clientes nuevos vs recurrentes
- Productos más consultados
- Carritos abandonados y recuperados
- Tendencia diaria de mensajes

## 🔒 Anti-Alucinación

El agente tiene múltiples capas de protección:

1. **RAG Estricto**: Solo responde con datos de la base de datos
2. **Prompt de sistema**: "Si no sabes, di que no sabes"
3. **Validación post-generación**: Chequeo contra respuestas de entrenamiento
4. **Fallback automático**: Después de 2 fallos → transferir a humano
5. **Logs de auditoría**: Todas las respuestas se auditan

## 🚀 Deploy en Hostinger

```bash
# En tu servidor Hostinger
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

O sigue la guía manual en `scripts/deploy.sh`

## 📁 Estructura del Proyecto

```
storesg-crm/
├── backend/
│   ├── src/
│   │   ├── api/           # Rutas API
│   │   ├── whatsapp/      # Integración WhatsApp
│   │   ├── shopify/       # Integración Shopify
│   │   ├── ai/            # Motor de IA
│   │   ├── crm/           # Gestión de clientes
│   │   ├── analytics/     # Analytics y reportes
│   │   ├── db/            # Conexiones DB
│   │   └── utils/         # Utilidades
│   ├── migrations/        # Scripts de migración
│   ├── scripts/           # Scripts de utilidad
│   └── config/            # Configuraciones
├── frontend/              # Dashboard CRM (React)
├── docs/                  # Documentación
└── scripts/               # Scripts de deploy
```

## 🔧 Comandos Útiles

```bash
# Iniciar en desarrollo
npm run dev

# Sincronizar productos de Shopify
curl -X POST http://localhost:3000/api/crm/sync/products \
  -H "Authorization: Bearer TU_TOKEN"

# Sincronizar pedidos
curl -X POST http://localhost:3000/api/crm/sync/orders \
  -H "Authorization: Bearer TU_TOKEN"

# Ver logs
pm2 logs storesg-crm

# Reiniciar
pm2 restart storesg-crm
```

## 📞 Soporte

- Email: storegmedellin@gmail.com
- WhatsApp: +57 323 381 7923

## 📄 Licencia

© 2026 STORE SG MEDELLÍN. Todos los derechos reservados.
