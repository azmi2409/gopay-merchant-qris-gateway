# gopay-merchant-qris-gateway

GoPay Merchant & Dynamic QRIS Payment Gateway API (REST v1) built with TypeScript and Node.js.

## Key Features

- **100% TypeScript**: Type-safe end-to-end, modular architecture with DTOs and schemas.
- **Strict RESTful API (`/api/v1`)**: Clean REST design without legacy endpoints.
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
├── services/          # SessionManager & PaymentService (verification, claiming)
├── middlewares/       # API Key authentication middleware
├── routes/            # RESTful v1 QRIS, Transactions, and System endpoints
├── app.ts             # Express app setup & middleware pipeline
├── server.ts          # Server listener & background maintenance timers
└── login.ts           # Interactive CLI login for GoBiz OTP
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

---

## REST v1 API Specification

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/qris` | API Key (`x-api-key`) | Create dynamic QRIS (`{ "amount": 50000 }`) |
| `GET` | `/api/v1/qris/:id` | Public | QRIS metadata and amount payload |
| `GET` | `/api/v1/qris/:id/status` | Public | Real-time payment verification status |
| `GET` | `/qr/:id` | Public | Interactive customer payment landing page |
| `POST` | `/api/v1/payments/verify` | API Key (`x-api-key`) | Verify settlement mutation manually |
| `GET` | `/api/v1/transactions` | API Key (`x-api-key`) | Merchant GoPay transaction history |
| `GET` | `/api/v1/session/status` | API Key (`x-api-key`) | GoBiz merchant session status |
| `GET` | `/api/v1/health` | Public | Basic service health information |
| `GET` | `/api/v1/healthz` | Public | Liveness & Readiness probe (Docker/K8s) |
| `GET` | `/api/v1/logs` | API Key (`x-api-key`) | Gateway audit and activity logs |
