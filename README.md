# gopay-merchant-qris-gateway

[![CI](https://github.com/azmi2409/gopay-merchant-qris-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/azmi2409/gopay-merchant-qris-gateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: 24 LTS](https://img.shields.io/badge/Node-24_LTS-green.svg)](https://nodejs.org)

GoPay Merchant & Dynamic QRIS Payment Gateway monorepo with an isolated web administration service.

[Setup](#step-by-step-setup-guide) | [API](#rest-v1-api-specification) | [Contributing](CONTRIBUTE.md) | [Changelog](CHANGELOG.md) | [Deployment](DEPLOY.md)

> [!WARNING]
> **Disclaimer & Unofficial API Notice**
> This project interacts with unofficial, reverse-engineered private APIs of GoBiz / Gojek / GoPay. It is **not** affiliated with, endorsed by, or officially supported by PT GoTo Gojek Tokopedia Tbk or any of its subsidiaries.
> - Gojek / GoBiz may alter authentication schemes, introduce rate limits, add bot detection, or invalidate sessions without notice at any time.
> - Accounts utilizing automated private APIs risk temporary or permanent suspension/blocking.
> - Use this gateway entirely at your own risk. For critical enterprise production workloads, always prefer official payment gateway aggregator solutions (e.g. Midtrans, Xendit).

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
- **Decoupled Frontend**: Responsive payment page built with native HTML, CSS, and JavaScript (`/qr/:id`).
- **Comprehensive Unit & Integration Tests**: Full test suite running on Vitest.
- **Multi-stage Docker Build**: Production-ready with lightweight Node.js Alpine container.
- **Isolated Admin Service**: Guided onboarding, browser-based setup, analytics, reports, OpenAPI-style reference, and persistent log viewer run outside the gateway process.
- **Admin QRIS Generator**: Create, open, and download five-minute dynamic QRIS payments without exposing the public API key to the browser.
- **Webhook Management**: Verify, register, list, and remove payment webhooks from gateway setup; stored signing secrets are never displayed.

---

## Project Structure

```
apps/admin/            # Separate SvelteKit 2 + Tailwind CSS admin control plane
apps/gateway/          # Payment API, customer page, management API, and tests
docker-compose.yml     # Isolated gateway and admin containers
```

The public gateway listens on `PORT` (`3000`). Its management API listens separately on `INTERNAL_PORT` (`3001`) and defaults to loopback only. The admin service listens on `ADMIN_PORT` (`3100`) and calls the management listener server-to-server using `ADMIN_API_KEY`. Never expose port `3001` publicly.

Docker Compose persists SQLite data in the managed `gateway-data` named volume. The admin interface runs as a standalone SvelteKit node service built with Tailwind CSS v4; no external CDN dependencies are required.

---

## Step-by-Step Setup Guide

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Setting Up the Keys & Environment (`.env`)
Copy the template configuration:
```bash
cp .env.example .env
```

Configure the deployment trust roots in `.env`. Merchant QRIS and GoBiz login are completed later in the admin panel.

```env
API_KEY=replace_with_a_random_public_api_key
GOPAY_MASTER_KEY=replace_with_a_64_character_hex_key
ADMIN_PASSWORD=replace_with_a_strong_admin_password
ADMIN_SESSION_SECRET=replace_with_at_least_32_random_characters
ADMIN_API_KEY=replace_with_a_different_32_character_secret
PUBLIC_GATEWAY_URL=https://pay.example.com
```

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and `ADMIN_API_KEY` must be independent values. The admin browser receives only a signed, `HttpOnly`, `SameSite=Strict` session cookie. It never receives the service credential or GoBiz tokens.

Set `PUBLIC_GATEWAY_URL` to the externally reachable gateway origin. Admin-generated QRIS payment links use this value instead of the private container hostname.

#### A. Authentication Mode: `AUTH_MODE=api_key` or `AUTH_MODE=jwt`

The gateway supports two selectable authentication modes for private routes (`/api/v1/qris`, `/api/v1/transactions`, `/api/v1/webhooks`):

1. **Static API Key (`AUTH_MODE=api_key`, default)**:
   - Generate a 32-byte secret:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - Set in `.env`:
     ```env
     AUTH_MODE=api_key
     API_KEY=your_static_api_key_here
     ```
   - Send requests with header: `x-api-key: your_static_api_key_here` (or query `?api_key=...`).

2. **Self-Signed JWT Bearer Token (`AUTH_MODE=jwt`)**:
   - Only configure the signing secret in `.env`:
     ```env
     AUTH_MODE=jwt
     JWT_SECRET=your_super_secret_jwt_key
     ```
   - Clients sign their own HS256 tokens and send requests with:
     ```http
     Authorization: Bearer <signed_jwt_token>
     ```
   - (Optional) Tokens can also be supplied via `?token=<jwt>`.

##### How to sign a JWT token for the client (Node.js example):
```javascript
const crypto = require('crypto');

function signToken(payload, secret, expiresInSeconds = 86400) {
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = b64(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) }));
  const sig = b64(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

const token = signToken({ sub: 'merchant_admin', role: 'admin' }, 'your_super_secret_jwt_key');
console.log('Bearer Token:', token);
```

#### B. `QRIS_STATIC` (Your Static Merchant QR Code)
1. Open your **GoBiz** app or web dashboard (or scan your physical merchant QRIS sticker).
2. Decode the QR code using any QR scanner app to obtain the raw string (it begins with `00020101...`).
3. Set this string in `.env`:
```env
QRIS_STATIC=00020101021126610014COM.GO-JEK.WWW...
```

#### C. `GOPAY_MASTER_KEY` (Session Encryption Key)
The gateway encrypts your GoBiz credentials using **AES-256-GCM**:
- **Automatic generation (Recommended for local dev / single VPS)**: Leave `GOPAY_MASTER_KEY=` empty in `.env`. On first run, the gateway generates `gopay.key` (chmod `0600`) automatically.
- **Manual / Multi-instance / Docker**: Generate a 64-character hex key:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  Set in `.env`:
  ```env
  GOPAY_MASTER_KEY=your_64_character_hex_master_key
  ```

#### D. `WEBHOOK_SECRET_KEY` (Webhook Signing Secret)
Generate a secret key to sign all outgoing webhook deliveries with `X-Webhook-Signature: sha256=<hmac>`:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
Set in `.env`:
```env
WEBHOOK_SECRET_KEY=whsec_your_generated_secret_key
```

#### Complete `.env` Example:
```env
PORT=3000
API_KEY=4a7c8e9f1b2d3c4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f
QRIS_STATIC=your_static_qris_payload
GOPAY_MERCHANT_ID=
GOPAY_MASTER_KEY=
DATABASE_URL=file:data/gateway.db
DATABASE_AUTH_TOKEN=
WEBHOOK_SECRET_KEY=whsec_8e7f6a5b4c3d2e1f0a9b8c7d
```

#### Stateless / Serverless Deployments (Turso, Cloudflare, AWS Lambda):
The gateway automatically stores its encrypted session inside the `app_sessions` table in your database (`DATABASE_URL`).
- For serverless hosting, set `DATABASE_URL` to your remote LibSQL/Turso URL (e.g. `libsql://your-db.turso.io`) with `DATABASE_AUTH_TOKEN`.
- The local filesystem is no longer a hard dependency for session persistence; fresh Lambda or container cold starts restore the encrypted session directly from the database.

---

### 3. Complete Browser Setup

GoBiz setup saves the original device ID inside the encrypted session and reuses it
for token refresh. Older sessions without a device ID require reconnecting GoBiz.

#### Unique payment amounts

Send `{"amount":50000,"use_unique_code":true}` to `POST /api/v1/qris`, or enable
the unique-code checkbox in the admin generator. This adds Rp 1-999 (for example,
Rp 50,123), rather than concatenating digits. The option defaults to false.
Amounts must be positive whole rupiah, at most `Number.MAX_SAFE_INTEGER - 999`.
Boolean flags also accept `1`, `0`, `"true"`, `"false"`, `"1"`, and `"0"`.

Creation and detail responses include `base_amount`, `unique_code`, and payable
`amount`. Customers must pay `amount` exactly; QR generation and automatic
verification use that total. Allocation uses a database write transaction to avoid
duplicate totals among unexpired QRIS, including paid records. Exhausted codes or
an exact-amount request conflicting with a reserved total return HTTP 409.
Codes can be reused after expiry; they do not replace transaction-ID matching.

1. Start both services with `docker compose up -d --build`.
2. Open `http://localhost:3100/admin/` and sign in with `ADMIN_PASSWORD`.
3. Open **Gateway setup**, save the static merchant QRIS and optional merchant ID.
4. Request and verify the GoBiz SMS OTP in the same page.

You can upload a PNG, JPEG, WebP, or GIF containing the merchant's static QRIS. Current Chrome and Edge decode the image locally through `BarcodeDetector`; the source image is never uploaded or stored. Browsers without this API show a manual payload fallback. The gateway validates that decoded text is an Indonesian static QRIS before encrypting it.

The gateway encrypts runtime settings and GoBiz session data with AES-256-GCM. OTP and device tokens stay in admin-process memory and are not returned to browser JavaScript. First-time onboarding remains active until both static QRIS and the GoBiz session are configured.

---

### 4. Running the Application

- **Development mode (instant auto-reload)**:
  ```bash
  pnpm dev
  pnpm dev:admin
  ```
- **Run automated test suite**:
  ```bash
  pnpm test
  ```
- **Production build & start**:
  ```bash
  pnpm run build
  pnpm start
  pnpm --filter @gopay/admin start
  ```
- **Run local webhook inspector server (optional)**:
  ```bash
  pnpm webhook:test-server
  ```
  Listens on `http://localhost:4000`, logs payloads, and verifies HMAC signatures.

---

## REST v1 API Specification

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/qris` | API Key (`x-api-key`) | Create dynamic QRIS with optional `reference`, `attributes`, and `callback_url` |
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

### Generate a QRIS payment with curl

With the default `AUTH_MODE=api_key` configuration:

```bash
curl --request POST http://localhost:3000/api/v1/qris \
  --header "Content-Type: application/json" \
  --header "x-api-key: your_static_api_key_here" \
  --data '{
    "amount": 50000,
    "reference": "INV-001",
    "callback_url": "https://merchant.example.com/payment/result",
    "attributes": {
      "customer_id": "CUST-99"
    }
  }'
```

The response includes `qris_url`, which opens the mobile-responsive payment page, and `qris_code`, which contains the raw dynamic QRIS payload. For `AUTH_MODE=jwt`, replace the `x-api-key` header with `Authorization: Bearer <signed_jwt_token>`.

`callback_url` is optional and must be an absolute HTTP or HTTPS URL. When supplied, the payment page displays a **Back to merchant** button and automatically redirects after three seconds when payment succeeds or the QRIS expires. The gateway preserves existing callback query parameters and adds `payment_status=success|failed`, `qris_id`, `trx_id`, and `reference` when available.

---

## Webhook Specification

### 1. Webhook Registration Request
`POST /api/v1/webhooks`
```json
{
  "url": "https://myshop.com/api/callbacks/gopay",
  "events": ["payment.success"],
  "secret": "whsec_custom_override_secret"
}
```
*Note: The gateway issues an initial pre-flight `webhook.ping` request to verify the destination endpoint returns a `2xx` response before storing.*

### 2. HTTP Delivery Headers

| Header Name | Example | Description |
|---|---|---|
| `Content-Type` | `application/json` | JSON body |
| `User-Agent` | `GoPay-Merchant-Webhook/1.0` | Gateway webhook agent signature |
| `X-Webhook-Event` | `payment.success` | Event identifier |
| `X-Webhook-Delivery` | `evt_8f3a9b2c` | Unique delivery event ID |
| `X-Webhook-Signature` | `sha256=1a2b3c4d...` | HMAC-SHA256 signature (signed using webhook secret or `WEBHOOK_SECRET_KEY`) |

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
    "reference": "INV-2026-001",
    "attributes": {
      "customer_id": "CUST-99",
      "email": "user@example.com"
    },
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
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signatureHeader);
  return expectedBuf.length === sigBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);
}
```

---

## Releases and Versioning

The project follows [Semantic Versioning](https://semver.org/). Release history and pending user-visible changes are tracked in [CHANGELOG.md](CHANGELOG.md). Git release tags use the `vX.Y.Z` format and should match the version in `package.json`.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTE.md](CONTRIBUTE.md) before submitting changes, never include real merchant credentials or QRIS payloads, and run `pnpm run build` plus `pnpm test` before opening a pull request.
