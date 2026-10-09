#!/bin/bash
# Deployment Script for Hostinger VPS
# Run this on your Hostinger server

set -e

echo "=== STORE SG CRM - Deployment Script ==="

# 1. Update system
echo "[1/8] Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20
echo "[2/8] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version

# 3. Install PostgreSQL
echo "[3/8] Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 4. Install Redis
echo "[4/8] Installing Redis..."
sudo apt install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 5. Install Nginx
echo "[5/8] Installing Nginx..."
sudo apt install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 6. Setup database
echo "[6/8] Setting up database..."
sudo -u postgres psql -c "CREATE DATABASE storesg_crm;"
sudo -u postgres psql -c "CREATE USER storesg WITH PASSWORD 'your_secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE storesg_crm TO storesg;"

# 7. Clone and setup project
echo "[7/8] Setting up project..."
cd /var/www
sudo mkdir -p storesg-crm
sudo chown -R $USER:$USER storesg-crm
cd storesg-crm

# Clone your repository here (or upload files)
# git clone https://github.com/your-repo/storesg-crm.git .

# Install dependencies
cd backend
npm install --production

# Create .env file
cat > .env << EOF
PORT=3000
NODE_ENV=production
API_SECRET_KEY=$(openssl rand -hex 32)

DB_HOST=localhost
DB_PORT=5432
DB_NAME=storesg_crm
DB_USER=storesg
DB_PASSWORD=your_secure_password

REDIS_URL=redis://localhost:6379

WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 16)
WHATSAPP_APP_SECRET=your_app_secret
WHATSAPP_API_VERSION=v18.0

SHOPIFY_STORE_URL=https://storesgmedellin.co
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token
SHOPIFY_API_VERSION=2024-01

AI_API_URL=https://api.mimo.com/v1
AI_API_KEY=your_api_key
AI_MODEL=mimo-v2.5-pro

BUSINESS_NAME=STORE SG MEDELLÍN
BUSINESS_PHONE=+573233817923
BUSINESS_EMAIL=storegmedellin@gmail.com
BUSINESS_ADDRESS=Carrera 49A #94-58, Medellín, Colombia
BUSINESS_TIMEZONE=America/Bogota
EOF

# Run migrations
node migrations/run.js

# Seed training data
node scripts/seed-training.js

# 8. Setup PM2 and Nginx
echo "[8/8] Setting up PM2 and Nginx..."

# Install PM2
sudo npm install -g pm2

# Start with PM2
pm2 start src/server.js --name storesg-crm
pm2 save
pm2 startup

# Nginx config
sudo tee /etc/nginx/sites-available/storesg-crm << 'NGINX'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /webhook {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX

# Enable site
sudo ln -sf /etc/nginx/sites-available/storesg-crm /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL with Let's Encrypt
# sudo apt install certbot python3-certbot-nginx
# sudo certbot --nginx -d your-domain.com

echo "=== Deployment Complete! ==="
echo ""
echo "Next steps:"
echo "1. Update .env with your actual credentials"
echo "2. Configure your domain DNS to point to this server"
echo "3. Run: sudo certbot --nginx -d your-domain.com"
echo "4. Configure WhatsApp webhook URL: https://your-domain.com/webhook"
echo "5. Configure Shopify webhooks"
echo ""
echo "API: https://your-domain.com/api"
echo "Webhook: https://your-domain.com/webhook"
echo ""
echo "PM2 commands:"
echo "  pm2 status"
echo "  pm2 logs storesg-crm"
echo "  pm2 restart storesg-crm"
