# Dokumentasi API Gojek / GoBiz & Arsitektur Gateway

Dokumen ini menjelaskan spesifikasi teknis API internal Gojek / GoBiz yang digunakan di dalam gateway ini ([login.js](login.js), [sessionManager.js](sessionManager.js), dan [server.js](server.js)), mencakup alur autentikasi OTP, manajemen sesi, auto-refresh token, serta verifikasi mutasi transaksi.

---

## Daftar Isi
1. [Ringkasan Arsitektur](#ringkasan-arsitektur)
2. [Alur Login OTP (Mermaid Sequence Diagram)](#alur-login-otp-mermaid-sequence-diagram)
3. [Alur Lifecycle & Auto-Refresh Sesi](#alur-lifecycle--auto-refresh-sesi)
4. [Alur Verifikasi Pembayaran QRIS](#alur-verifikasi-pembayaran-qris)
5. [Spesifikasi Header HTTP & Device Fingerprint](#spesifikasi-header-http--device-fingerprint)
6. [Katalog Endpoint API Gojek / GoBiz](#katalog-endpoint-api-gojek--gobiz)
   - [1. Request OTP](#1-request-otp-login-sms)
   - [2. Verifikasi OTP (Exchange Token)](#2-verifikasi-otp-exchange-token)
   - [3. Auto-Refresh Token](#3-auto-refresh-token)
   - [4. Konfigurasi Profil Merchant / Outlet](#4-konfigurasi-profil-merchant--outlet)
   - [5. Riwayat Mutasi & Transaksi QRIS](#5-riwayat-mutasi--transaksi-qris)

---

## Ringkasan Arsitektur

Gateway ini beroperasi menggunakan autentikasi resmi **GoID (GoBiz Web Dashboard)**. Sesi autentikasi disimpan dalam format token bearer JWT (`access_token`) dan `refresh_token` di dalam file `.GOPAY_SESI_JANGAN_DIHAPUS.json`.

```
+----------------+      +-------------------+      +-------------------------+
|  node login.js | ---> | sessionManager.js | <--- |        server.js        |
|  (CLI Terminal)|      | (Token Storage &  |      |   (Express API Gateway  |
|  OTP Login 1x) |      |   Auto-Refresh)   |      |   & QRIS Verification)  |
+----------------+      +-------------------+      +-------------------------+
         |                        |                             |
         v                        v                             v
+----------------------------------------------------------------------------+
|                       GoBiz & Gojek API Cloud Servers                      |
|  - api.gobiz.co.id (GoID Auth & Resto Config)                              |
|  - api.gojekapi.com (Merchant Analytics & Settlement Transactions)        |
+----------------------------------------------------------------------------+
```

---

## Alur Login OTP (Mermaid Sequence Diagram)

Diagram berikut menggambarkan seluruh interaksi antara User, CLI `login.js`, `sessionManager.js`, dan server GoBiz:

```mermaid
sequenceDiagram
    autonumber
    actor User as Merchant (User Terminal)
    participant CLI as login.js (CLI)
    participant SM as sessionManager.js
    participant GoID as api.gobiz.co.id (/goid)
    participant GoResto as api.gobiz.co.id (/goresto)

    User->>CLI: Jalankan `node login.js`
    CLI->>User: Minta nomor HP (contoh: 085119772671)
    User->>CLI: Masukkan nomor HP
    Note over CLI: Normalisasi HP: strip nondigit & leading 0/62 -> "85119772671"
    
    CLI->>GoID: POST /goid/login/request<br/>{ client_id: "go-biz-web-new", phone_number, country_code: "62" }
    GoID-->>User: Kirim SMS kode OTP (4 digit)
    GoID-->>CLI: Response { otp_token: "...", expires_in: 720 }
    
    CLI->>User: Tampilkan info SMS terkirim & minta kode OTP
    User->>CLI: Input 4-digit kode OTP (misal: "1234")
    
    CLI->>GoID: POST /goid/token (grant_type: "otp")<br/>{ otp: "1234", otp_token: "..." }
    GoID-->>CLI: Response { access_token, refresh_token, expires_in: 86400 }
    
    CLI->>GoResto: GET /goresto/v5/public/users/config<br/>Headers: Authorization: Bearer <access_token>
    GoResto-->>CLI: Response { merchant: { id, name }, merchants: [...], restaurants: [...] }
    Note over CLI: Ekstrak merchant_id & nama outlet
    
    CLI->>SM: saveSession({ phone_number, merchant_id, outlet_name, access_token, refresh_token, expires_at })
    SM-->>SM: Simpan ke `.GOPAY_SESI_JANGAN_DIHAPUS.json`
    SM-->>CLI: Sesi tersimpan sukses
    
    CLI->>User: Tampilkan banner sukses & detail sesi
```

---

## Alur Lifecycle & Auto-Refresh Sesi

Token akses Gojek memiliki masa aktif (biasanya 24 jam). `sessionManager.js` memiliki mekanisme **preventif 5 menit** sebelum token kedaluwarsa untuk memastikan gateway selalu memiliki token valid tanpa downtime.

```mermaid
flowchart TD
    A[Request Masuk ke server.js<br/>misal: /transactions atau /check-payment] --> B[Panggil sessionManager.getValidHeaders()]
    B --> C[loadSession() dari .GOPAY_SESI_JANGAN_DIHAPUS.json]
    
    C --> D{Apakah sesi & access_token ada?}
    D -- Tidak --> E[Return null -> Respon 400: Jalankan node login.js]
    D -- Ya --> F{isExpired(session)?<br/>Waktu sekarang >= expires_at - 5 Menit}
    
    F -- Tidak Expired --> G[Susun Headers Auth Bearer & Cookie]
    F -- Expired --> H{Apakah refresh_token ada?}
    
    H -- Tidak --> G
    H -- Ya --> I[refreshSession()]
    
    I --> J[POST https://api.gobiz.co.id/goid/token<br/>grant_type: 'refresh_token']
    J --> K{Refresh Berhasil?}
    K -- Ya --> L[Update access_token & expires_at baru di file sesi]
    L --> G
    K -- Gagal --> G
    
    G --> M[Kirim HTTP Request ke API Gojek]
    M --> N{Status HTTP 401 Unauthorized?}
    N -- Tidak --> O[Kembalikan Hasil Transaksi]
    N -- Ya --> P[Emergency Auto-Refresh token & Coba Ulang Request 1x]
    P --> O
```

---

## Alur Verifikasi Pembayaran QRIS

Proses verifikasi mutasi QRIS dilakukan secara real-time dengan pencocokan nominal dan proteksi **anti double-claim** melalui `trx_id` / `qris_id`:

```mermaid
sequenceDiagram
    autonumber
    actor Pembeli as Pelanggan
    participant Gateway as server.js
    participant GojekAPI as api.gojekapi.com (/merchants/transactions)
    
    Note over Gateway: Pelanggan scan QRIS dinamis nominal Rp 50.000
    Pembeli->>Gateway: Scan & Bayar via QRIS BCA / GoPay / Dana / OVO
    Pembeli->>Gateway: Polling status: GET /api/qr-status/:qrisId
    
    Gateway->>GojekAPI: GET /merchant-analytics/v2/merchants/transactions<br/>params: start_time, statuses: SETTLEMENT,CAPTURE
    GojekAPI-->>Gateway: Daftar transaksi terbaru
    
    Note over Gateway: Filter transaksi:<br/>1. gross_amount == nominal * 100 (satuan sen)<br/>2. timestamp >= start_time (toleransi drift)<br/>3. txId belum diklaim qrisId lain
    
    alt Transaksi Ditemukan & Belum Diklaim
        Gateway->>Gateway: Catat claimedTransactions.set(txId, qrisId)
        Gateway-->>Pembeli: { success: true, paid: true, transaction: {...} }
    else Belum Masuk / Sudah Diklaim Sesi Lain
        Gateway-->>Pembeli: { success: true, paid: false, status: 'PENDING' }
    end
```

---

## Spesifikasi Header HTTP & Device Fingerprint

Semua request ke API GoBiz wajib menyertakan identitas perangkat seluler/browser untuk melewati mekanisme *anti-fraud / WAF* Gojek:

| Header Name | Nilai Standar | Keterangan |
|-------------|---------------|------------|
| `accept` | `application/json, text/plain, */*` | Format respon |
| `accept-language` | `id` | Bahasa lokal Indonesia |
| `authentication-type` | `go-id` | Skema autentikasi GoBiz |
| `content-type` | `application/json` | Format payload request |
| `gojek-country-code`| `ID` | Kode negara Indonesia |
| `gojek-timezone` | `Asia/Jakarta` | Zona waktu merchant |
| `origin` | `https://portal.gofoodmerchant.co.id` | Web portal resmi GoFood Merchant |
| `referer` | `https://portal.gofoodmerchant.co.id/` | Referer portal |
| `user-agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...` | Browser signature |
| `x-appid` | `go-biz-web-dashboard` | Identitas aplikasi GoBiz Dashboard |
| `x-appversion` | `platform-v3.111.0-1708bc9a` | Versi platform web dashboard |
| `x-deviceos` | `Web` | Tipe platform |
| `x-phonemake` | `Windows 10 64-bit` | Fingerprint mesin |
| `x-phonemodel`| `Chrome 150.0.0.0 on Windows 10 64-bit` | Fingerprint browser |
| `x-platform` | `Web` | Platform web |
| `x-uniqueid` | `UUID v4` (contoh: `e09c85e9-51db-4328-b18c-7759c3c0235e`) | Device identifier acak unik per sesi login. **Wajib konsisten sama antara Request OTP dan Verifikasi OTP**. Jika berbeda, GoID menolak dengan error `Akses terbatas: Harap perbarui versi aplikasi resmi Anda`. |
| `x-user-locale` | `en-GB` | Locale pengguna |
| `x-user-type` | `merchant` | Tipe akun (merchant) |
| `Authorization` | `Bearer <access_token>` | Diterapkan pada endpoint private |

> [!IMPORTANT]
> **Pencegahan Error "Akses Terbatas / Perbarui Versi Aplikasi"**:
> Server autentikasi GoID mengikat token OTP (`otp_token`) dengan identitas perangkat (`x-uniqueid`). Jika `x-uniqueid` yang dikirim saat verifikasi OTP berbeda dari saat meminta OTP, GoID menganggapnya sebagai anomali/serangan man-in-the-middle dan mengembalikan error `goid:error:unauthorized`. Header harus diinisialisasi sekali per sesi interaktif dan digunakan bersama untuk kedua panggilan tersebut.

---

## Katalog Endpoint API Gojek / GoBiz

### 1. Request OTP Login (SMS)

Mengirimkan kode OTP 4 digit melalui SMS ke nomor handphone merchant GoBiz.

- **Method**: `POST`
- **URL**: `https://api.gobiz.co.id/goid/login/request`
- **Autentikasi**: Publik (Device Headers)
- **Request Body**:
  ```json
  {
    "client_id": "go-biz-web-new",
    "phone_number": "85119772671",
    "country_code": "62"
  }
  ```
  > *Catatan: `phone_number` tidak menyertakan angka `0` atau `62` di depan.*

- **Contoh Respon Berhasil (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "otp_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "expires_in": 720
    }
  }
  ```

---

### 2. Verifikasi OTP (Exchange Token)

Memvalidasi kode 4-digit OTP yang diinput oleh user dan menukarkannya dengan pasangan `access_token` & `refresh_token`.

- **Method**: `POST`
- **URL**: `https://api.gobiz.co.id/goid/token`
- **Autentikasi**: Publik (Device Headers)
- **Request Body**:
  ```json
  {
    "client_id": "go-biz-web-new",
    "grant_type": "otp",
    "data": {
      "otp": "1234",
      "otp_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  }
  ```

- **Contoh Respon Berhasil (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "access_token": "eyJhbGciOiJSUzI1NiIs...",
      "refresh_token": "d98e7f6a-5b4c-3d2e-1f0a-...",
      "token_type": "Bearer",
      "expires_in": 86400
    }
  }
  ```

---

### 3. Auto-Refresh Token

Memperbarui `access_token` yang telah atau hampir kedaluwarsa tanpa interaksi user manual.

- **Method**: `POST`
- **URL**: `https://api.gobiz.co.id/goid/token`
- **Autentikasi**: Publik (Device Headers)
- **Request Body**:
  ```json
  {
    "client_id": "go-biz-web-new",
    "grant_type": "refresh_token",
    "data": {
      "refresh_token": "d98e7f6a-5b4c-3d2e-1f0a-...",
      "phone_number": "85119772671",
      "country_code": "62"
    }
  }
  ```

- **Contoh Respon Berhasil (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "access_token": "eyJhbGciOiJSUzI1NiIs...(token baru)",
      "refresh_token": "d98e7f6a-5b4c-3d2e-1f0a-...(token baru)",
      "expires_in": 86400
    }
  }
  ```

---

### 4. Konfigurasi Profil Merchant / Outlet

Mengambil informasi identitas bisnis, nama merchant/outlet resto, dan ID Merchant GoFood/GoPay.

- **Method**: `GET`
- **URL**: `https://api.gobiz.co.id/goresto/v5/public/users/config`
- **Autentikasi**: `Bearer <access_token>`
- **Request Headers**:
  ```http
  Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
  authentication-type: go-id
  Origin: https://portal.gofoodmerchant.co.id
  Referer: https://portal.gofoodmerchant.co.id/
  ```

- **Contoh Respon Berhasil (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "merchant": {
        "id": "G123456789",
        "name": "Kopi Mantap Jiwa - Sudirman"
      },
      "merchants": [
        {
          "id": "G123456789",
          "name": "Kopi Mantap Jiwa - Sudirman"
        }
      ],
      "restaurants": [
        {
          "id": "R987654321",
          "name": "Kopi Mantap Jiwa - Sudirman"
        }
      ]
    }
  }
  ```

---

### 5. Riwayat Mutasi & Transaksi QRIS

Mengambil daftar transaksi pembayaran instore (QRIS / GoPay) yang telah berstatus `SETTLEMENT` atau `CAPTURE`.

- **Method**: `GET`
- **URL**: `https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions`
- **Autentikasi**: `Bearer <access_token>` + Cookie
- **Request Headers**:
  ```http
  Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
  Cookie: access_token=eyJhb...; refresh_token=...; auth_method=goid
  authentication-type: go-id
  Origin: https://portal.gofoodmerchant.co.id
  Referer: https://portal.gofoodmerchant.co.id/
  ```
- **Query Parameters**:
  | Param | Contoh | Keterangan |
  |-------|--------|------------|
  | `from` | `0` | Offset pagination |
  | `size` | `20` | Jumlah record per halaman |
  | `statuses` | `SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND` | Status transaksi yang dicari |
  | `payment_types`| `QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD` | Metode pembayaran |
  | `start_time` | `2026-09-10T00:00:00.000Z` | Rentang waktu awal (ISO 8601) |
  | `end_time` | `2026-09-10T16:00:00.000Z` | Rentang waktu akhir (ISO 8601) |
  | `merchant_ids` | `G123456789` | ID Merchant GoPay (opsional/otomatis) |

- **Contoh Respon Berhasil (200 OK)**:
  ```json
  {
    "data": {
      "transactions": [
        {
          "id": "WTRX-123456789",
          "order_id": "ORDER-987654",
          "gross_amount": 25000,
          "transaction_status": "SETTLEMENT",
          "transaction_time": "2026-09-10T09:15:20.000Z",
          "qris_provider_aspi_issuer": "Bank Central Asia (BCA)",
          "payment_type": "QRIS"
        }
      ]
    }
  }
  ```

---

## File Terkait Dalam Repository
- [login.js](login.js): Script CLI untuk otentikasi awal via terminal.
- [sessionManager.js](sessionManager.js): Modul persistensi sesi, evaluasi expiry, dan auto-refresh token.
- [server.js](server.js): Server API Gateway Express, generator QRIS dinamis, dan verifikator mutasi transaksi.
- [.GOPAY_SESI_JANGAN_DIHAPUS.json](.GOPAY_SESI_JANGAN_DIHAPUS.json): Berkas penyimpanan sesi terenkripsi/terstruktur (dibuat setelah login sukses).
