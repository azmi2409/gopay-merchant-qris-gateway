# GoPay Merchant Payment Gateway & QRIS API (TypeScript)

Microservice gateway pembayaran GoPay dan QRIS Dinamis standar ASPI / Bank Indonesia EMVCo berbasis TypeScript dan Node.js.

## Fitur Utama

- **100% TypeScript**: Type-safe end-to-end, modular architecture dengan DTO dan schemas.
- **Dynamic QRIS EMVCo Generator**: Kalkulasi CRC16 otomatis, manipulasi TLV Tag 01 (Dynamic), dan injeksi Tag 54 (Amount).
- **Anti Double-Claiming**: Memastikan 1 mutasi GoPay hanya dapat diklaim oleh 1 transaksi QRIS.
- **Session Auto-Refresh**: Refresh token otomatis ke API GoBiz sebelum token kedaluwarsa.
- **Decoupled Frontend**: Halaman pembayaran interaktif modern menggunakan UnoCSS (`/qr/:id`).
- **Comprehensive Unit & Integration Tests**: 22 unit & integration test menggunakan Vitest.
- **Multi-stage Docker Build**: Siap produksi dengan container ringan Node.js Alpine.

---

## Struktur Proyek

```
src/
├── types/             # Type definitions (session, qris, gopay, payment)
├── utils/             # CRC16 calculation & EMVCo TLV parsing
├── services/          # SessionManager & PaymentService (verification, claiming)
├── middlewares/       # API Key authentication middleware
├── routes/            # QRIS, Transactions, and System endpoints
├── app.ts             # Express app setup & middleware pipeline
├── server.ts          # Server listener & background maintenance timers
└── login.ts           # Interactive CLI login for GoBiz OTP
tests/                 # Vitest unit & integration test suites
public/                # Decoupled frontend (HTML, CSS, JS with UnoCSS)
dist/                  # Compiled JavaScript production build
legacy/                # Backup of original CommonJS files
```

---

## Instalasi & Menjalankan

### 1. Instalasi Dependensi
```bash
pnpm install
```

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` ke `.env`:
```env
PORT=3000
API_KEY=your_secret_api_key
QRIS_STATIC=00020101021126610014COM.GO-JEK.WWW...
GOPAY_MERCHANT_ID=your_merchant_id
```

### 3. Login Sesi GoBiz
Jalankan CLI interaktif untuk menerima OTP via SMS dan menyimpan sesi:
```bash
pnpm login
```

### 4. Menjalankan dalam Mode Development
Menggunakan `tsx watch` dengan auto-reload instan:
```bash
pnpm dev
```

### 5. Menjalankan Unit & Integration Test
```bash
pnpm test
```

### 6. Build & Jalankan untuk Production
```bash
pnpm run build
pnpm start
```

---

## API Endpoints

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET/POST` | `/create-qris?amount=50000` | API Key | Buat QRIS dinamis baru dengan nominal tertentu |
| `GET` | `/qr/:id` | Publik | Halaman interaktif pembayaran QRIS untuk customer |
| `GET` | `/api/qr-data/:id` | Publik | Metadata QRIS dan nominal untuk frontend |
| `GET` | `/api/qr-status/:id` | Publik | Cek status pembayaran secara realtime |
| `ALL` | `/check-payment` | API Key | Verifikasi manual mutasi pembayaran GoPay |
| `GET` | `/transactions` | API Key | Riwayat transaksi GoPay merchant |
| `GET` | `/token-status` | API Key | Status masa berlaku sesi GoBiz |
| `GET` | `/healthz` | Publik | Liveness & Readiness probe (Docker/K8s) |
| `GET` | `/api/logs` | API Key | Log aktivitas audit gateway |
