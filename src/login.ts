import readline from 'readline';
import axios from 'axios';
import * as sessionManager from './services/sessionManager';
import { GoBizOtpRequestResponse, GoBizTokenResponse } from './types/session';

export const GOBIZ_REQUEST_OTP_URL = 'https://api.gobiz.co.id/goid/login/request';
export const GOBIZ_VERIFY_OTP_URL = 'https://api.gobiz.co.id/goid/token';
export const GOBIZ_USER_CONFIG_URL = 'https://api.gobiz.co.id/goresto/v5/public/users/config';

/**
 * Normalizes phone input into national format without leading zero or 62
 * e.g. '085119772671' -> '85119772671'
 */
export function parsePhoneInput(rawPhone: string): string {
  if (!rawPhone) return '';
  let digits = String(rawPhone).trim().replace(/\D/g, '');
  if (digits.startsWith('62')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Ask question in terminal via Readline
 */
export function askQuestion(query: string, rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Main Interactive CLI for GoBiz OTP Login
 */
export async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('====================================================');
  console.log('   GOPAY MERCHANT / GOFOOD MERCHANT LOGIN OTP CLI   ');
  console.log('====================================================\n');

  const sessionHeaders = sessionManager.getStandardGoBizHeaders();

  try {
    // 1. Input Phone Number
    const rawPhone = await askQuestion(
      '>> Masukkan Nomor HP GoBiz/GoFood Merchant (contoh: 085119772671): ',
      rl
    );
    const nationalPhone = parsePhoneInput(rawPhone);

    if (!nationalPhone || nationalPhone.length < 8) {
      console.log('[-] Nomor HP tidak valid. Silakan jalankan ulang perintah.');
      rl.close();
      return;
    }

    const formattedInternationalPhone = `+62${nationalPhone}`;
    console.log(`[*] Mengirim permintaan OTP ke nomor: ${formattedInternationalPhone}...`);

    // 2. Request OTP from GoBiz
    let requestOtpResponse;
    try {
      requestOtpResponse = await axios.post<GoBizOtpRequestResponse>(
        GOBIZ_REQUEST_OTP_URL,
        {
          client_id: 'go-biz-web-new',
          phone_number: nationalPhone,
          country_code: '62'
        },
        {
          headers: sessionHeaders,
          timeout: 15000
        }
      );
    } catch (requestError: any) {
      const errorDetail = requestError.response
        ? JSON.stringify(requestError.response.data)
        : requestError.message;
      console.log(`[-] Gagal meminta OTP dari server GoBiz: ${errorDetail}`);
      rl.close();
      return;
    }

    const requestData = (requestOtpResponse.data?.data || requestOtpResponse.data || {}) as any;
    const otpToken = requestData.otp_token || requestData.login_token;
    const expiresIn = requestData.expires_in || 720;

    if (!otpToken) {
      console.log('[-] Respon GoBiz tidak mengembalikan token OTP.');
      rl.close();
      return;
    }

    console.log('[+] Kode OTP (4 digit) berhasil dikirim via SMS!');
    console.log(`[*] Berlaku selama ${expiresIn} detik.\n`);

    // 3. Input OTP Code
    const otpCode = await askQuestion('>> Masukkan Kode OTP (4 digit): ', rl);

    if (!otpCode || otpCode.trim().length === 0) {
      console.log('[-] Kode OTP tidak boleh kosong.');
      rl.close();
      return;
    }

    console.log('[*] Memverifikasi kode OTP...');

    // 4. Verify OTP
    let verifyResponse;
    try {
      verifyResponse = await axios.post<GoBizTokenResponse>(
        GOBIZ_VERIFY_OTP_URL,
        {
          client_id: 'go-biz-web-new',
          grant_type: 'otp',
          data: {
            otp: otpCode.trim(),
            otp_token: otpToken
          }
        },
        {
          headers: sessionHeaders,
          timeout: 15000
        }
      );
    } catch (verifyError: any) {
      const errorDetail = verifyError.response
        ? JSON.stringify(verifyError.response.data)
        : verifyError.message;
      console.log(`[-] Gagal verifikasi OTP: ${errorDetail}`);
      rl.close();
      return;
    }

    const tokenData = (verifyResponse.data?.data || verifyResponse.data || {}) as any;
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const tokenExpiresIn = tokenData.expires_in || 86400;

    if (!accessToken) {
      console.log('[-] Verifikasi berhasil tetapi access_token tidak ditemukan.');
      rl.close();
      return;
    }

    // 5. Fetch Merchant & Outlet Info
    console.log('[*] Mengambil data merchant & outlet info...');
    let merchantId: string | null = null;
    let outletName = 'Merchant GoPay';

    try {
      const configResponse = await axios.get(GOBIZ_USER_CONFIG_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'authentication-type': 'go-id',
          Origin: 'https://portal.gofoodmerchant.co.id',
          Referer: 'https://portal.gofoodmerchant.co.id/',
          'User-Agent': sessionHeaders['user-agent']
        },
        timeout: 10000
      });

      const configData = configResponse.data?.data || configResponse.data || {};
      const merchants = configData.merchants || [];
      const restaurants = configData.restaurants || [];
      const singleMerchant = configData.merchant || null;

      if (singleMerchant?.id) {
        merchantId = singleMerchant.id;
        outletName = singleMerchant.name || singleMerchant.brand_name || outletName;
      } else if (merchants.length > 0 && merchants[0]?.id) {
        merchantId = merchants[0].id;
        outletName = merchants[0].name || merchants[0].brand_name || outletName;
      } else if (restaurants.length > 0 && restaurants[0]?.id) {
        merchantId = restaurants[0].id;
        outletName = restaurants[0].name || restaurants[0].brand_name || outletName;
      }
    } catch {
      console.warn(
        '[!] Peringatan: Tidak dapat mengambil rincian nama outlet dari GoBiz (menggunakan default).'
      );
    }

    // 6. Save session
    const tokenExpirationIso = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();
    const cookieString = `access_token=${accessToken}; refresh_token=${
      refreshToken || ''
    }; auth_method=goid`;

    try {
      sessionManager.saveSession({
        phone_number: formattedInternationalPhone,
        merchant_id: merchantId,
        outlet_name: outletName,
        access_token: accessToken,
        refresh_token: refreshToken,
        cookie: cookieString,
        expires_at: tokenExpirationIso
      });
    } catch (saveError: any) {
      console.log(
        `[-] Gagal menulis file sesi ${sessionManager.SESSION_FILE}: ${saveError.message}`
      );
      rl.close();
      return;
    }

    console.log('\n====================================================');
    console.log('   [SUCCESS] LOGIN BERHASIL & SESI TERSIMPAN!       ');
    console.log('====================================================');
    console.log(`File Sesi    : .GOPAY_SESI_JANGAN_DIHAPUS.json`);
    console.log(`Nomor HP     : ${formattedInternationalPhone}`);
    console.log(`Merchant ID  : ${merchantId || '-'}`);
    console.log(`Outlet Name  : ${outletName}`);
    console.log(`Token Exp    : ${tokenExpirationIso}`);
    console.log('\nSesi akan diperbarui (auto-refresh) secara otomatis oleh gateway.\n');
  } catch (unexpectedError: any) {
    console.error('[-] Terjadi kesalahan tidak terduga:', unexpectedError.message);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}
