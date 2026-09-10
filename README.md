# gopay-merchant-qris-gateway

[![CI](https://github.com/azmi2409/gopay-merchant-qris-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/azmi2409/gopay-merchant-qris-gateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: 24 LTS](https://img.shields.io/badge/Node-24_LTS-green.svg)](https://nodejs.org)

GoPay Merchant & Dynamic QRIS Payment Gateway API (REST v1) built with TypeScript and Node.js.

## Key Features

- **100% TypeScript**: Type-safe end-to-end, modular architecture with DTOs and schemas.
- **Strict RESTful API (`/api/v1`)**: Clean REST design without legacy endpoints.
- **Embedded & Cloudflare SQLite Database**: Backed by `@libsql/client` supporting local SQLite (`file:data/gateway.db`), Cloudflare Workers / D1 compatibility, or remote Turso instances.
- **Embeddable Metadata**: Attach custom `reference` (e.g. order ID, invoice) and arbitrary JSON `attributes` to any QRIS creation request.
- **Webhooks with Pre-Flight Ping & HMAC**: Real-time event notifications with HMAC-SHA256 signature and destination reachability validation.
- **Configurable Backoff & Retry**: Resilient network calls against GoBiz and GoJek endpoints with automatic retry on transient failures.
- **Dynamic QRIS EMVCo Generator**: Automatic CRC16 calculation, TLV Tag 01 manipulation (Dynamic), and Tag 54 injection (Amount).
- **Anti Double-Claiming**: Ensures a single GoPay transaction can only be claimed by one QRIS record.
- **Session Auto-Refresh**: Automatic token refresh against GoBiz API prior to token expiration.
- **Centralized Dual Logging**: Stdout/stderr streaming alongside persistent file logging in `logs/app.log`.
- **Decoupled Frontend**: Modern interactive payment page styled with UnoCSS (`/qr/:id`).
- **Comprehensive Unit & Integration Tests**: Full test suite running on Vitest.
- **Multi-stage Docker Build**: Production-ready with lightweight Node.js Alpine container.

---

## Project Structure

```
src/
├── types/             # Type definitions (session, qris, gopay, payment)
├── utils/             # CRC16, crypto, retry, logger & EMVCo TLV parsing
├── services/          # SessionManager, PaymentService, WebhookService
├── middlewares/       # API Key authentication middleware
├── routes/            # RESTful v1 QRIS, Transactions, Webhooks, and System
├── app.ts             # Express app setup & middleware pipeline
├── server.ts          # Server listener & background maintenance timers
└── login.ts           # Interactive CLI login for GoBiz OTP
webhook.js             # Standalone test server for inspecting incoming webhooks
tests/                 # Vitest unit & integration test suites
public/                # Decoupled frontend (HTML, CSS, JS with UnoCSS)
dist/                  # Compiled JavaScript production build
```

---

## Installation & Setup

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```env
PORT=3000
API_KEY=your_secret_api_key
QRIS_STATIC=00020101021126610014COM.GO-JEK.WWW...
GOPAY_MERCHANT_ID=your_merchant_id
GOPAY_MASTER_KEY= # Optional: if empty, auto-generated to gopay.key (chmod 0600)

# Database (LibSQL / SQLite / Cloudflare SQLite / Turso)
# Default local file: file:data/gateway.db
DATABASE_URL=
DATABASE_AUTH_TOKEN=
```

### 3. Startup & Encrypted Session
- The gateway uses **AES-256-GCM** encryption following the Rails Master Key pattern (`gopay.key` / `GOPAY_MASTER_KEY`) to secure session data in `gopay_session`.
- When starting the application (`pnpm dev` or `pnpm start`):
  - **No Session**: When run in an interactive terminal (TTY), the CLI will automatically offer an OTP login prompt.
  - **Expired Session**: The system automatically attempts a token refresh with GoBiz before binding to the port.
- You can also initiate a login anytime via:
```bash
pnpm login
```

### 4. Running in Development Mode
```bash
pnpm dev
```

### 5. Running Tests
```bash
pnpm test
```

### 6. Production Build & Run
```bash
pnpm run build
pnpm start
```

### 7. Run Test Webhook Server (Optional)
To test webhook delivery locally:
```bash
pnpm webhook:test-server
```
Listens on `http://localhost:4000` and logs all incoming headers, payloads, and signatures.

---

## REST v1 API Specification

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/qris` | API Key (`x-api-key`) | Create dynamic QRIS (`{ "amount": 50000, "reference": "INV-001", "attributes": { ... } }`) |
| `GET` | `/api/v1/qris/:id` | Public | QRIS metadata, reference, attributes, and amount payload |
| `GET` | `/api/v1/qris/:id/status` | Public | Real-time payment verification status |
| `GET` | `/qr/:id` | Public | Interactive customer payment landing page |
| `POST` | `/api/v1/payments/verify` | API Key (`x-api-key`) | Verify settlement mutation manually |
| `GET` | `/api/v1/transactions` | API Key (`x-api-key`) | Merchant GoPay transaction history |
| `GET` | `/api/v1/session/status` | API Key (`x-api-key`) | GoBiz merchant session status |
| `POST` | `/api/v1/webhooks` | API Key (`x-api-key`) | Register a new webhook endpoint with pre-flight ping |
| `GET` | `/api/v1/webhooks` | API Key (`x-api-key`) | List all registered webhooks |
| `DELETE` | `/api/v1/webhooks/:id` | API Key (`x-api-key`) | Delete a webhook registration |
| `POST` | `/api/v1/webhooks/test` | API Key (`x-api-key`) | Dispatch a test event to matching webhooks |
| `GET` | `/api/v1/health` | Public | Basic service health information |
| `GET` | `/api/v1/healthz` | Public | Liveness & Readiness probe (Docker/K8s) |
| `GET` | `/api/v1/logs` | API Key (`x-api-key`) | Gateway audit and activity logs |

---

## Webhook Specification

### 1. Webhook Registration Request
`POST /api/v1/webhooks`
```json
{
  "url": "https://myshop.com/api/callbacks/gopay",
  "events": ["payment.success"],
  "secret": "whsec_your_secret_key"
}
```
*Note: The gateway issues an initial pre-flight `webhook.ping` request to verify the destination endpoint returns a `2xx` response before storing.*

### 2. HTTP Delivery Headers
Every webhook HTTP POST delivery includes the following headers:

| Header Name | Example | Description |
|---|---|---|
| `Content-Type` | `application/json` | JSON body |
| `User-Agent` | `GoPay-Merchant-Webhook/1.0` | Gateway webhook agent signature |
| `X-Webhook-Event` | `payment.success` | Event identifier |
| `X-Webhook-Delivery` | `evt_8f3a9b2c` | Unique delivery event ID |
| `X-Webhook-Signature` | `sha256=1a2b3c4d...` | HMAC-SHA256 signature (included if `secret` is set) |

### 3. Payload Schemas

#### A. `payment.success`
Triggered when a customer completes payment for a dynamic QRIS or via `/api/v1/payments/verify`.

```json
{
  "id": "evt_9b1a8f2c",
  "event": "payment.success",
  "timestamp": "2026-09-10T11:15:30.123Z",
  "data": {
    "qris_id": "hfawcihx",
    "transaction": {
      "transaction_id": "WTRX-123456789",
      "order_id": "ORDER-987654",
      "amount": 50000,
      "raw_amount": 5000000,
      "payer_issuer": "Bank Central Asia (BCA)",
      "payment_type": "QRIS",
      "transaction_time": "2026-09-10T11:15:28.000Z"
    }
  }
}
```

#### B. `webhook.ping` (Pre-flight & Verification)
Sent during registration to validate destination reachability.

```json
{
  "id": "ping_4f8c2b1e",
  "event": "webhook.ping",
  "timestamp": "2026-09-10T11:15:00.000Z",
  "data": {
    "message": "Webhook verification ping"
  }
}
```

### 4. Verifying Signatures (Node.js Example)
```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payloadString, signatureHeader, secret) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```
