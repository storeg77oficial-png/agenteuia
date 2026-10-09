# STORE SG MEDELLÍN — Arquitectura del Sistema

## Visión General

Sistema completo de CRM + Agente de IA para WhatsApp integrado con Shopify.

```
┌─────────────────────────────────────────────────────────────────┐
│                    STORE SG CRM PLATFORM                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ WhatsApp │───▶│  Webhook     │───▶│  AI Agent Engine     │  │
│  │ Business │◀───│  Handler     │◀───│  (mimo V2.5 PRO)     │  │
│  │   API    │    └──────┬───────┘    └──────────┬───────────┘  │
│  └──────────┘           │                       │              │
│                         ▼                       ▼              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ Shopify  │◀──▶│  Product     │    │  Conversation        │  │
│  │   API    │    │  Sync        │    │  State Machine       │  │
│  └──────────┘    └──────────────┘    └──────────────────────┘  │
│                         │                       │              │
│                         ▼                       ▼              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    PostgreSQL Database                    │  │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐  │  │
│  │  │Products │ │ Orders   │ │Customers│ │Conversations │  │  │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                      │
│                         ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    CRM Dashboard                         │  │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐  │  │
│  │  │Analytics│ │ Agent    │ │Templates│ │ Multi-Agent  │  │  │
│  │  │  Panel  │ │ Manager  │ │ Manager │ │   Router     │  │  │
│  │  └─────────┘ └──────────┘ └─────────┘ └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Stack Tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| **Backend** | Node.js + Express | Rápido, ecosistema grande, fácil de deployar en Hostinger |
| **Base de datos** | PostgreSQL | Robusta, relaciones complejas, analytics |
| **Cache** | Redis | Sesiones, rate limiting, cache de productos |
| **IA/LLM** | mimo V2.5 PRO | Modelo principal para el agente |
| **WhatsApp** | Meta Cloud API | Directo, sin intermediarios, más control |
| **Frontend** | React + Tailwind | CRM dashboard moderno |
| **Hosting** | Hostinger VPS | Economífiel, escalable |

## Módulos Principales

### 1. WhatsApp Module (`/backend/src/whatsapp/`)
- Webhook handler para mensajes entrantes
- Envío de mensajes (texto, imagen, template)
- Gestión de sesiones de conversación
- Rate limiting y cola de mensajes

### 2. AI Agent Module (`/backend/src/ai/`)
- Engine de conversación con mimo V2.5 PRO
- RAG (Retrieval Augmented Generation) con catálogo de productos
- Detección de intención del usuario
- Anti-alucinación (guardrails)
- Fallback a agente humano

### 3. Shopify Module (`/backend/src/shopify/`)
- Sincronización de productos en tiempo real
- Consulta de inventario por talla/color
- Creación de pedidos
- Tracking de estado de pedidos
- Webhooks para cambios en productos/pedidos

### 4. CRM Module (`/backend/src/crm/`)
- Gestión de clientes
- Historial de conversaciones
- Etiquetas y segmentación
- Métricas de ventas
- Dashboard de analytics

### 5. Analytics Module (`/backend/src/analytics/`)
- Visitantes web
- Carritos abandonados
- Conversión de ventas
- Tiempo de respuesta del agente
- Productos más consultados

## Flujo de Conversación

```
Cliente envía "Hola"
    │
    ▼
┌─────────────────┐
│ ¿Es primer      │──Sí──▶ Mensaje de bienvenida
│ contacto?       │        + presentación de la tienda
└────────┬────────┘
         │No
         ▼
┌─────────────────┐
│ Detectar        │
│ intención       │
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┬──────────┐
    ▼         ▼          ▼          ▼          ▼
 Producto   Pedido    FAQ      Humano    Otro
    │         │          │          │          │
    ▼         ▼          ▼          ▼          ▼
 Buscar    Consultar  Responder  Transferir  Preguntar
 catálogo  estado     info       a asesor    qué necesita
    │         │          │          │          │
    ▼         ▼          ▼          ▼          ▼
 Recomendar Confirmar  ──────▶  Notificar   Ayudar
 + precio   + tracking           al equipo
```

## Anti-Alucinación

1. **RAG Estricto**: Solo responde con datos reales de Shopify
2. **Prompt de sistema**: "Si no sabes, di que no sabes y ofrece transferir a un asesor"
3. **Validación post-generación**: Chequeo contra DB antes de enviar
4. **Fallback automático**: Si la IA duda 2+ veces → transferir a humano
5. **Logs de auditoría**: Todas las respuestas se auditan

## Seguridad

- Encriptación de datos sensibles
- Rate limiting por número de teléfono
- Validación de webhooks de Meta
- Autenticación JWT para el CRM
- Logs de acceso
