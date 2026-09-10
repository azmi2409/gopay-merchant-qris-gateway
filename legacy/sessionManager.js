const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const SESSION_FILE = path.join(__dirname, '.GOPAY_SESI_JANGAN_DIHAPUS.json');
const LEGACY_CACHE_FILE = path.join(__dirname, '.gopay_cache.json');
const GOBIZ_TOKEN_URL = 'https://api.gobiz.co.id/goid/token';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 menit sebelum kedaluwarsa

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
 * Memuat sesi GoPay dari file lokal atau environment variable fallback
 * @returns {object|null} Objek sesi atau null jika tidak ditemukan
 */
function loadSession() {
    // 1. Prioritas utama: File sesi resmi GoPay
    if (fs.existsSync(SESSION_FILE)) {
        try {
            const rawContent = fs.readFileSync(SESSION_FILE, 'utf-8');
            return JSON.parse(rawContent);
        } catch (error) {
            console.error('[SessionManager] Gagal membaca SESSION_FILE:', error.message);
        }
    }

    // 2. Fallback legacy: File cache lama .gopay_cache.json
    if (fs.existsSync(LEGACY_CACHE_FILE)) {
        try {
            const rawLegacy = fs.readFileSync(LEGACY_CACHE_FILE, 'utf-8');
            const parsedLegacy = JSON.parse(rawLegacy);
            const cookieString = parsedLegacy.gopay_cookie || '';
            const tokenMatch = cookieString.match(/access_token=([^;]+)/);
            const extractedToken = tokenMatch ? tokenMatch[1] : null;

            if (extractedToken) {
                return {
                    access_token: extractedToken,
                    refresh_token: null,
                    cookie: cookieString,
                    updated_at: new Date().toISOString(),
                    expires_at: null
                };
            }
        } catch (error) {
            console.error('[SessionManager] Gagal membaca LEGACY_CACHE_FILE:', error.message);
        }
    }

    // 3. Fallback env: GOPAY_COOKIE
    if (process.env.GOPAY_COOKIE) {
        const envCookie = process.env.GOPAY_COOKIE;
        const tokenMatch = envCookie.match(/access_token=([^;]+)/);
        const extractedToken = tokenMatch ? tokenMatch[1] : null;

        if (extractedToken) {
            return {
                access_token: extractedToken,
                refresh_token: null,
                cookie: envCookie,
                updated_at: new Date().toISOString(),
                expires_at: null
            };
        }
    }

    return null;
}

/**
 * Menyimpan data sesi ke file .GOPAY_SESI_JANGAN_DIHAPUS.json
 * @param {object} sessionData
 * @returns {object} Objek sesi tersimpan
 */
function saveSession(sessionData) {
    let expiresAt = sessionData.expires_at || null;
    if (!expiresAt && sessionData.expires_in) {
        expiresAt = new Date(Date.now() + sessionData.expires_in * 1000).toISOString();
    }

    const payload = {
        phone_number: sessionData.phone_number || null,
        merchant_id: sessionData.merchant_id || null,
        outlet_name: sessionData.outlet_name || null,
        access_token: sessionData.access_token || null,
        refresh_token: sessionData.refresh_token || null,
        cookie: sessionData.cookie || (
            sessionData.access_token
                ? `access_token=${sessionData.access_token}; refresh_token=${sessionData.refresh_token || ''}; auth_method=goid`
                : null
        ),
        updated_at: new Date().toISOString(),
        expires_at: expiresAt
    };

    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[SessionManager] Sesi berhasil diperbarui dan disimpan ke ${SESSION_FILE}`);
    return payload;
}

/**
 * Memeriksa apakah sesi telah kedaluwarsa atau mendekati waktu kedaluwarsa (buffer 5 menit)
 * @param {object} session
 * @returns {boolean} true jika kedaluwarsa/tidak valid
 */
function isExpired(session) {
    if (!session || !session.access_token || !session.expires_at) {
        return true;
    }

    const expirationTimestamp = new Date(session.expires_at).getTime();
    if (isNaN(expirationTimestamp)) {
        return true;
    }

    return Date.now() >= (expirationTimestamp - EXPIRY_BUFFER_MS);
}

/**
 * Memperbarui access_token menggunakan refresh_token ke API GoBiz
 * @returns {Promise<object|null>} Sesi baru yang diperbarui atau null jika gagal
 */
async function refreshSession() {
    const currentSession = loadSession();
    if (!currentSession || !currentSession.refresh_token) {
        console.warn('[SessionManager] Auto-refresh dibatalkan: refresh_token tidak tersedia.');
        return null;
    }

    let cleanPhone = null;
    if (currentSession.phone_number) {
        cleanPhone = String(currentSession.phone_number).replace(/\D/g, '');
        if (cleanPhone.startsWith('62')) cleanPhone = cleanPhone.slice(2);
        if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
    }

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

    const requestBody = {
        client_id: 'go-biz-web-new',
        grant_type: 'refresh_token',
        data: {
            refresh_token: currentSession.refresh_token,
            phone_number: cleanPhone,
            country_code: '62'
        }
    };

    console.log('[SessionManager] Mengirimkan request auto-refresh token ke GoBiz...');

    try {
        const response = await axios.post(GOBIZ_TOKEN_URL, requestBody, {
            headers,
            timeout: 10000
        });

        const tokenData = response.data?.data || response.data || {};
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token || currentSession.refresh_token;
        const expiresInSeconds = tokenData.expires_in || 86400;

        if (!newAccessToken) {
            console.error('[SessionManager] Respon GoBiz tidak berisi access_token baru.');
            return null;
        }

        const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        const updatedSession = saveSession({
            phone_number: currentSession.phone_number,
            merchant_id: currentSession.merchant_id,
            outlet_name: currentSession.outlet_name,
            access_token: newAccessToken,
            refresh_token: newRefreshToken,
            cookie: `access_token=${newAccessToken}; refresh_token=${newRefreshToken}; auth_method=goid`,
            expires_at: newExpiresAt
        });

        console.log('[SessionManager] Auto-refresh token BERHASIL! Token baru telah ditulis ke .GOPAY_SESI_JANGAN_DIHAPUS.json');
        return updatedSession;
    } catch (error) {
        const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error(`[SessionManager] Gagal auto-refresh token: ${errorDetail}`);
        return null;
    }
}

/**
 * Mengambil headers HTTP terotentikasi yang valid untuk request ke GoJek/GoPay API.
 * Jika sesi expired, fungsi ini akan otomatis melakukan refresh token terlebih dahulu.
 * @param {string|null} clientUserAgent Optional User-Agent dari client
 * @returns {Promise<object|null>} Header HTTP untuk Axios atau null jika sesi belum ada
 */
async function getValidHeaders(clientUserAgent = null) {
    let session = loadSession();

    if (!session || !session.access_token) {
        console.warn('[SessionManager] PERINGATAN: Sesi GoPay belum tersedia. Silakan jalankan `node login.js` di terminal.');
        return null;
    }

    // Auto-refresh jika token mendekati kedaluwarsa dan refresh_token tersedia
    if (isExpired(session)) {
        if (session.refresh_token) {
            console.log('[SessionManager] Sesi mendekati kedaluwarsa. Menjalankan auto-refresh token...');
            const refreshed = await refreshSession();
            if (refreshed) {
                session = refreshed;
            }
        }
    }

    if (!session || !session.access_token) {
        return null;
    }

    const defaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
    const activeCookie = session.cookie || `access_token=${session.access_token}; refresh_token=${session.refresh_token || ''}; auth_method=goid`;

    return {
        'Authorization': `Bearer ${session.access_token}`,
        'Cookie': activeCookie,
        'authentication-type': 'go-id',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://portal.gofoodmerchant.co.id',
        'Referer': 'https://portal.gofoodmerchant.co.id/',
        'User-Agent': clientUserAgent || defaultUserAgent
    };
}

module.exports = {
    SESSION_FILE,
    loadSession,
    saveSession,
    isExpired,
    refreshSession,
    getValidHeaders
};