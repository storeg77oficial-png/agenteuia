# Guía de Configuración Rápida

## 1. WhatsApp Cloud API de Meta

En Meta for Developers, selecciona tu aplicación y configura el producto WhatsApp. Guarda estas variables en `backend/.env` o en el gestor de secretos del servidor; nunca publiques el archivo ni incluyas tokens en logs.

```env
WHATSAPP_PHONE_NUMBER_ID=tu-phone-number-id
WHATSAPP_ACCESS_TOKEN=tu-token-de-acceso
WHATSAPP_API_VERSION=v25.0
WHATSAPP_REQUEST_TIMEOUT_MS=15000
WHATSAPP_WEBHOOK_VERIFY_TOKEN=un-secreto-que-configuras-en-meta
WHATSAPP_APP_SECRET=app-secret-de-meta
```

El token debe tener permisos para administrar y enviar mensajes de WhatsApp. `WHATSAPP_APP_SECRET` es el secreto de la aplicación de Meta y valida la firma de cada webhook; no es el token de verificación del webhook.

En la configuración de Webhooks de Meta, usa `https://tu-dominio.com/webhook` como callback, el mismo valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` para verificarlo y suscribe el campo `messages`. Para desarrollo local, expón el puerto 3000 con un túnel HTTPS.

---

## 🛍️ Paso 2: Conectar Shopify

### 2.1 Crear Private App
1. Ve a https://storesgmedellin.co/admin
2. **Settings > Apps and sales channels > Develop apps**
3. Click **"Create an app"**
4. Nombre: `WhatsApp Bot`
5. En **Configuration > Admin API access scopes**, marca:
   - ✅ `read_products`
   - ✅ `write_products`
   - ✅ `read_orders`
   - ✅ `write_orders`
   - ✅ `read_customers`
   - ✅ `write_customers`
6. Click **"Install app"**
7. Copia el **"Admin API access token"** (empieza con `shpat_`)

### 2.2 Configurar en .env
```bash
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
```

### 2.3 Sincronizar productos
```bash
cd backend
node scripts/sync-shopify.js
```

---

## 🚀 Paso 3: Ejecutar Localmente

### 3.1 Iniciar servidor
```bash
cd backend
node src/server.js
```

### 3.2 Probar con curl
```bash
# Health check
curl http://localhost:3000/health

# Probar el motor de respuestas sin enviar WhatsApp
curl -X POST http://localhost:3000/test/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer tu-API_SECRET_KEY" \
  -d '{"message":"Hola","phone":"573001234567"}'
```

### 3.3 Probar WhatsApp
Envía un mensaje desde un teléfono suscrito a tu número de WhatsApp Business. El agente debe responder automáticamente.

---

## 🌐 Paso 4: Deploy en Producción (Hostinger)

### 4.1 Subir código
```bash
# En tu servidor Hostinger
cd /var/www
git clone tu-repositorio
cd storesg-crm/backend
npm install --production
```

### 4.2 Configurar variables
```bash
cp .env.example .env
nano .env  # Agrega tus credenciales reales
```

### 4.3 Iniciar con PM2
```bash
npm install -g pm2
pm2 start src/server.js --name storesg-crm
pm2 save
pm2 startup
```

### 4.4 Configurar dominio
1. Apunta tu dominio al servidor Hostinger
2. Configura Nginx como reverse proxy
3. Instala SSL con Let's Encrypt

### 4.5 Configurar webhook en Meta
```
https://tu-dominio.com/webhook
```

---

## 📊 Resumen de Credenciales

| Servicio | Qué necesitas | Dónde obtenerlo |
|----------|---------------|-----------------|
| **Meta WhatsApp** | Phone Number ID, access token, app secret | Meta for Developers |
| **Shopify** | Access Token | storesgmedellin.co/admin |
| **Hosting** | IP, SSH | Hostinger panel |

---

## 🆓 Costos

| Servicio | Costo |
|----------|-------|
| Meta WhatsApp | Según tarifas vigentes de Meta |
| Shopify | Ya lo tienes |
| Hostinger VPS | ~$10-20 USD/mes |
| **Total para pruebas** | **$0** |

---

## ❓ Problemas Comunes

### Webhook rechazado con 401
- Verifica que `WHATSAPP_APP_SECRET` sea el secreto de la aplicación y que el servidor conserve el cuerpo original de la solicitud.

### "No tenant found"
- Ejecuta: `node scripts/seed-training.js`

### "No products found"
- Ejecuta: `node scripts/sync-shopify.js`

### El bot no responde
- Verifica que el webhook de Meta esté suscrito al campo `messages` y tenga una URL HTTPS accesible.
- Verifica que el servidor esté corriendo
- Revisa los logs: `pm2 logs storesg-crm`