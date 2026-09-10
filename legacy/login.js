const readline = require('readline');
const axios = require('axios');
const crypto = require('crypto');
const sessionManager = require('./sessionManager');

const GOBIZ_REQUEST_OTP_URL = 'https://api.gobiz.co.id/goid/login/request';
const GOBIZ_VERIFY_OTP_URL = 'https://api.gobiz.co.id/goid/token';
const GOBIZ_USER_CONFIG_URL = 'https://api.gobiz.co.id/goresto/v5/public/users/config';

/**
 * Menghasilkan UUID v4 acak untuk header x-uniqueid
 */
function generateUUID() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const randomNibble = (Math.random() * 16) | 0;
        const value = char === 'x' ? randomNibble : (randomNibble & 0x3) | 0x8;
        return value.toString(16);
    });
}

/**
 * Mendapatkan header standar browser GoBiz Web Dashboard
 * @param {string|null} authToken Optional Bearer token
 * @returns {object} Headers HTTP
 */
function getGoBizHeaders(authToken = null) {
    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'id',
        'authentication-type': 'go-id',
        'content-type': 'application/json',
        'gojek-country-code': 'ID',
        'gojek-timezone': 'Asia/Jakarta',
        'origin': 'https://portal.gofoodmerchant.co.id',
        'referer': 'https://portal.gofoodmerchant.co.id/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'x-appid': 'go-biz-web-dashboard',
        'x-appversion': 'platform-v3.111.0-1708bc9a',
        'x-deviceos': 'Web',
        'x-phonemake': 'Windows 10 64-bit',
        'x-phonemodel': 'Chrome 150.0.0.0 on Windows 10 64-bit',
        'x-platform': 'Web',
        'x-uniqueid': generateUUID(),
        'x-user-locale': 'en-GB',
        'x-user-type': 'merchant'
    };

    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    return headers;
}

/**
 * Membersihkan format nomor telepon menjadi nomor nasional (tanpa awalan 0 atau 62)
 * Contoh: '085119772671' -> '85119772671'
 * @param {string} rawPhone
 * @returns {string} Nomor telepon tanpa prefix negara/nol
 */
function parsePhoneInput(rawPhone) {
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
 * Menanyakan input ke user terminal via Readline dengan Promise
 * @param {string} query
 * @param {readline.Interface} rl
 * @returns {Promise<string>} Jawaban user
 */
function askQuestion(query, rl) {
    return new Promise((resolve) => rl.question(query, resolve));
}

/**
 * Alur Utama Login OTP Terminal
 */
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('====================================================');
    console.log('   GOPAY MERCHANT / GOFOOD MERCHANT LOGIN OTP CLI   ');
    console.log('====================================================\n');

    // Headers dibuat sekali per sesi login agar x-uniqueid identik antara Request OTP dan Verifikasi OTP
    const sessionHeaders = getGoBizHeaders();

    try {
        // 1. Input Nomor HP
        const rawPhone = await askQuestion('>> Masukkan Nomor HP GoBiz/GoFood Merchant (contoh: 085119772671): ', rl);
        const nationalPhone = parsePhoneInput(rawPhone);

        if (!nationalPhone || nationalPhone.length < 8) {
            console.log('[-] Nomor HP tidak valid. Silakan jalankan ulang perintah.');
            rl.close();
            return;
        }

        const formattedInternationalPhone = `+62${nationalPhone}`;
        console.log(`[*] Mengirim permintaan OTP ke nomor: ${formattedInternationalPhone}...`);

        // 2. Request OTP ke GoBiz (menggunakan sessionHeaders)
        let requestOtpResponse;
        try {
            requestOtpResponse = await axios.post(
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
        } catch (requestError) {
            const errorDetail = requestError.response
                ? JSON.stringify(requestError.response.data)
                : requestError.message;
            console.log(`[-] Gagal meminta OTP dari server GoBiz: ${errorDetail}`);
            rl.close();
            return;
        }

        const requestData = requestOtpResponse.data?.data || requestOtpResponse.data || {};
        const otpToken = requestData.otp_token || requestData.login_token;
        const expiresIn = requestData.expires_in || 720;

        if (!otpToken) {
            console.log('[-] Respon GoBiz tidak mengembalikan token OTP.');
            rl.close();
            return;
        }

        console.log('[+] Kode OTP (4 digit) berhasil dikirim via SMS!');
        console.log(`[*] Berlaku selama ${expiresIn} detik.\n`);

        // 3. Input Kode OTP
        const otpCode = await askQuestion('>> Masukkan Kode OTP (4 digit): ', rl);

        if (!otpCode || otpCode.trim().length === 0) {
            console.log('[-] Kode OTP tidak boleh kosong.');
            rl.close();
            return;
        }

        console.log('[*] Memverifikasi kode OTP...');

        // 4. Verifikasi OTP ke GoBiz Token Endpoint (menggunakan sessionHeaders yang sama persis)
        let verifyResponse;
        try {
            verifyResponse = await axios.post(
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
        } catch (verifyError) {
            const errorDetail = verifyError.response
                ? JSON.stringify(verifyError.response.data)
                : verifyError.message;
            console.log(`[-] Gagal verifikasi OTP: ${errorDetail}`);
            rl.close();
            return;
        }

        const tokenData = verifyResponse.data?.data || verifyResponse.data || {};
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const tokenExpiresIn = tokenData.expires_in || 86400;

        if (!accessToken) {
            console.log('[-] Verifikasi berhasil tetapi access_token tidak ditemukan.');
            rl.close();
            return;
        }

        // 5. Ambil data Merchant & Outlet Info
        console.log('[*] Mengambil data merchant & outlet info...');
        let merchantId = null;
        let outletName = 'Merchant GoPay';

        try {
            const configResponse = await axios.get(GOBIZ_USER_CONFIG_URL, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'authentication-type': 'go-id',
                    'Origin': 'https://portal.gofoodmerchant.co.id',
                    'Referer': 'https://portal.gofoodmerchant.co.id/',
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
        } catch (configError) {
            console.warn('[!] Peringatan: Tidak dapat mengambil rincian nama outlet dari GoBiz (menggunakan default).');
        }

        // 6. Simpan Sesi Menggunakan sessionManager
        const tokenExpirationIso = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();
        const cookieString = `access_token=${accessToken}; refresh_token=${refreshToken || ''}; auth_method=goid`;

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
        } catch (saveError) {
            console.log(`[-] Gagal menulis file sesi ${sessionManager.SESSION_FILE}: ${saveError.message}`);
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

    } catch (unexpectedError) {
        console.error('[-] Terjadi kesalahan tidak terduga:', unexpectedError.message);
    } finally {
        rl.close();
    }
}

// Jalankan jika dieksekusi langsung
if (require.main === module) {
    main();
}

module.exports = {
    parsePhoneInput,
    generateUUID,
    getGoBizHeaders,
    main
};