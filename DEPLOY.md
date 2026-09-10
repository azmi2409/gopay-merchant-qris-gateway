# Deployment Guide

Deployment instructions for **gopay-merchant-qris-gateway** across bare metal VPS (Node.js 24 LTS), Docker, and Cloudflare / Serverless environments.

---

## 1. System Requirements

- **Node.js**: `v24.x` (Active LTS)
- **Package Manager**: `pnpm` (`v10.x` or `v11.x`)
- **Memory**: Minimum 256MB RAM (512MB recommended)
- **OS**: Linux (Ubuntu 22.04+, Debian 12+, Alpine 3.20+), macOS, or Docker

---

## 2. Environment Variables Checklist

Configure your `.env` file with the following keys before starting in production:

```env
NODE_ENV=production
PORT=3000

# Required: API key for authenticating private routes
API_KEY=generate_a_strong_random_secret_here

# Required: Static QRIS payload string from GoBiz merchant dashboard
QRIS_STATIC=00020101021126610014COM.GO-JEK.WWW...

# Optional: Merchant ID (auto-extracted from login session if omitted)
GOPAY_MERCHANT_ID=

# Optional: Master Key for AES-256-GCM encryption of gopay_session
# If omitted, auto-generated to gopay.key with 0600 permissions
GOPAY_MASTER_KEY=

# Database Configuration (LibSQL / SQLite / Cloudflare D1 / Turso)
# Default local persistent SQLite: file:data/gateway.db
# Cloudflare / Turso remote URL: libsql://your-database.turso.io
DATABASE_URL=file:data/gateway.db
DATABASE_AUTH_TOKEN=
```

---

## 3. Initial Session Login

Before running in an automated background daemon, run the interactive OTP login once to generate the encrypted `gopay_session` and master key:

```bash
pnpm install
pnpm login
```

- Enter your GoBiz merchant phone number.
- Input the 4-digit SMS OTP.
- Verifies and saves the encrypted session to `gopay_session` and `gopay.key`.

---

## 4. Bare Metal / VPS Deployment (PM2 + Node 24)

### Step 1: Install PM2
```bash
npm install -g pm2
```

### Step 2: Build & Start
```bash
pnpm build
pm2 start dist/server.js --name gopay-gateway --time
pm2 save
pm2 startup
```

### Step 3: Nginx Reverse Proxy (HTTPS + SSL)
```nginx
server {
    listen 80;
    server_name pay.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pay.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/pay.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pay.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. Docker & Docker Compose Deployment

### Docker Multi-Stage Build (Node 24 LTS)
The root `Dockerfile` uses `node:24-alpine` for a lightweight (<150MB) container.

```bash
# Build image
docker build -t gopay-merchant-gateway:latest .

# Run container with mounted session & persistent DB
docker run -d \
  --name gopay-gateway \
  -p 3000:3000 \
  -e PORT=3000 \
  -e API_KEY="your_api_key" \
  -e QRIS_STATIC="your_static_qris" \
  -v $(pwd)/gopay_session:/app/gopay_session \
  -v $(pwd)/gopay.key:/app/gopay.key \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --restart unless-stopped \
  gopay-merchant-gateway:latest
```

### Docker Compose
`docker-compose.yml`:
```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: gopay-gateway
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - API_KEY=${API_KEY}
      - QRIS_STATIC=${QRIS_STATIC}
      - GOPAY_MERCHANT_ID=${GOPAY_MERCHANT_ID}
      - GOPAY_MASTER_KEY=${GOPAY_MASTER_KEY}
      - DATABASE_URL=file:data/gateway.db
    volumes:
      - ./gopay_session:/app/gopay_session
      - ./gopay.key:/app/gopay.key
      - ./data:/app/data
      - ./logs:/app/logs
```

Start the service:
```bash
docker compose up -d
```

---

## 6. Cloudflare & Distributed Database Deployment

Because the gateway uses `@libsql/client`:

1. **Remote Cloudflare / Turso SQLite**:
   ```env
   DATABASE_URL=libsql://your-database-name.turso.io
   DATABASE_AUTH_TOKEN=your_turso_auth_token
   ```
2. **Stateless Scale**: All dynamic QRIS metadata, transaction claims, and registered webhooks persist in the distributed database, enabling multi-instance deployment behind a load balancer without race conditions.

---

## 7. Health Checks & Verification

Verify the deployment using the health endpoint:

```bash
curl http://localhost:3000/api/v1/healthz
```

Expected response:
```json
{
  "status": "healthy",
  "uptime": 12.34
}
```
