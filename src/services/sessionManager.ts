import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { GoPaySession, GoBizTokenResponse } from '../types/session';
import { encryptPayload, decryptPayload } from '../utils/crypto';

export const SESSION_FILE = path.join(process.cwd(), 'gopay_session');
export const LEGACY_SESSION_FILE = path.join(process.cwd(), '.GOPAY_SESI_JANGAN_DIHAPUS.json');
export const LEGACY_CACHE_FILE = path.join(process.cwd(), '.gopay_cache.json');
export const GOBIZ_TOKEN_URL = 'https://api.gobiz.co.id/goid/token';
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes buffer

/**
 * Generates a random UUID v4 for GoBiz HTTP headers
 */
export function generateUUID(): string {
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
 * Loads the active GoPay merchant session.
 * Decrypts gopay_session using the master key.
 * Automatically migrates legacy .GOPAY_SESI_JANGAN_DIHAPUS.json if present.
 */
export function loadSession(): GoPaySession | null {
  // 1. Primary: Encrypted gopay_session file
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const rawEncrypted = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
      if (rawEncrypted) {
        return decryptPayload<GoPaySession>(rawEncrypted);
      }
    } catch (error: any) {
      console.error('[SessionManager] Failed to decrypt SESSION_FILE (gopay_session):', error.message);
    }
  }

  // 2. Legacy Migration: .GOPAY_SESI_JANGAN_DIHAPUS.json
  if (fs.existsSync(LEGACY_SESSION_FILE)) {
    try {
      const rawLegacy = fs.readFileSync(LEGACY_SESSION_FILE, 'utf-8');
      const legacySession = JSON.parse(rawLegacy) as GoPaySession;

      if (legacySession && legacySession.access_token) {
        console.log('[SessionManager] Migrating legacy unencrypted session to encrypted gopay_session...');
        const saved = saveSession(legacySession);

        // Remove unencrypted legacy file
        try {
          fs.unlinkSync(LEGACY_SESSION_FILE);
          console.log('[SessionManager] Removed legacy unencrypted session file.');
        } catch (unlinkErr: any) {
          console.warn(`[SessionManager] Could not delete legacy file: ${unlinkErr.message}`);
        }

        return saved;
      }
    } catch (error: any) {
      console.error('[SessionManager] Failed to read LEGACY_SESSION_FILE:', error.message);
    }
  }

  // 3. Legacy fallback: .gopay_cache.json
  if (fs.existsSync(LEGACY_CACHE_FILE)) {
    try {
      const rawLegacy = fs.readFileSync(LEGACY_CACHE_FILE, 'utf-8');
      const parsedLegacy = JSON.parse(rawLegacy);
      const cookieString: string = parsedLegacy.gopay_cookie || '';
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
      console.error('[SessionManager] Failed to read LEGACY_CACHE_FILE:', (error as Error).message);
    }
  }

  // 4. Fallback env: GOPAY_COOKIE
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
 * Saves and encrypts session data to `gopay_session` (mode 0600)
 */
export function saveSession(
  sessionData: Partial<GoPaySession> & { expires_in?: number }
): GoPaySession {
  let expiresAt = sessionData.expires_at || null;
  if (!expiresAt && sessionData.expires_in) {
    expiresAt = new Date(Date.now() + sessionData.expires_in * 1000).toISOString();
  }

  const payload: GoPaySession = {
    phone_number: sessionData.phone_number || null,
    merchant_id: sessionData.merchant_id || null,
    outlet_name: sessionData.outlet_name || null,
    access_token: sessionData.access_token || null,
    refresh_token: sessionData.refresh_token || null,
    cookie:
      sessionData.cookie ||
      (sessionData.access_token
        ? `access_token=${sessionData.access_token}; refresh_token=${sessionData.refresh_token || ''}; auth_method=goid`
        : null),
    updated_at: new Date().toISOString(),
    expires_at: expiresAt
  };

  const encryptedEnvelope = encryptPayload(payload);
  fs.writeFileSync(SESSION_FILE, encryptedEnvelope, { mode: 0o600, encoding: 'utf-8' });
  console.log(`[SessionManager] Session successfully encrypted and saved to ${SESSION_FILE}`);
  return payload;
}

/**
 * Checks whether the session has expired or is nearing expiration (with buffer)
 */
export function isExpired(session: GoPaySession | null): boolean {
  if (!session || !session.access_token || !session.expires_at) {
    return true;
  }

  const expirationTimestamp = new Date(session.expires_at).getTime();
  if (isNaN(expirationTimestamp)) {
    return true;
  }

  return Date.now() >= expirationTimestamp - EXPIRY_BUFFER_MS;
}

/**
 * Refreshes the access_token using refresh_token against GoBiz API
 */
export function getStandardGoBizHeaders(uniqueId: string = generateUUID()): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'id',
    'authentication-type': 'go-id',
    'content-type': 'application/json',
    'gojek-country-code': 'ID',
    'gojek-timezone': 'Asia/Jakarta',
    origin: 'https://portal.gofoodmerchant.co.id',
    referer: 'https://portal.gofoodmerchant.co.id/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'x-appid': 'go-biz-web-dashboard',
    'x-appversion': 'platform-v3.111.0-1708bc9a',
    'x-deviceos': 'Web',
    'x-phonemake': 'Windows 10 64-bit',
    'x-phonemodel': 'Chrome 150.0.0.0 on Windows 10 64-bit',
    'x-platform': 'Web',
    'x-uniqueid': uniqueId,
    'x-user-locale': 'en-GB',
    'x-user-type': 'merchant'
  };
}

export async function refreshSession(): Promise<GoPaySession | null> {
  const currentSession = loadSession();
  if (!currentSession || !currentSession.refresh_token) {
    console.warn('[SessionManager] Auto-refresh skipped: refresh_token not found.');
    return null;
  }

  let cleanPhone: string | null = null;
  if (currentSession.phone_number) {
    cleanPhone = String(currentSession.phone_number).replace(/\D/g, '');
    if (cleanPhone.startsWith('62')) cleanPhone = cleanPhone.slice(2);
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
  }

  const headers = getStandardGoBizHeaders();
  const requestBody = {
    client_id: 'go-biz-web-new',
    grant_type: 'refresh_token',
    data: {
      refresh_token: currentSession.refresh_token,
      phone_number: cleanPhone,
      country_code: '62'
    }
  };

  console.log('[SessionManager] Sending auto-refresh token request to GoBiz...');

  try {
    const response = await axios.post<GoBizTokenResponse>(GOBIZ_TOKEN_URL, requestBody, {
      headers,
      timeout: 10000
    });

    const tokenData = response.data?.data || response.data || {};
    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token || currentSession.refresh_token;
    const expiresInSeconds = tokenData.expires_in || 86400;

    if (!newAccessToken) {
      console.error('[SessionManager] GoBiz response missing access_token.');
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

    console.log('[SessionManager] Auto-refresh token SUCCEEDED! New tokens written to session file.');
    return updatedSession;
  } catch (error: any) {
    const errorDetail = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[SessionManager] Failed to auto-refresh token: ${errorDetail}`);
    return null;
  }
}

/**
 * Returns authenticated HTTP headers for GoJek / GoPay API calls.
 * Automatically attempts a refresh if the token is nearing expiration.
 */
export async function getValidHeaders(
  clientUserAgent: string | null = null
): Promise<Record<string, string> | null> {
  let session = loadSession();

  if (!session || !session.access_token) {
    console.warn('[SessionManager] WARNING: GoPay session not available. Run `npm run login`.');
    return null;
  }

  // Auto-refresh if token is near expiration
  if (isExpired(session) && session.refresh_token) {
    console.log('[SessionManager] Session near expiration. Triggering auto-refresh...');
    const refreshed = await refreshSession();
    if (refreshed) {
      session = refreshed;
    }
  }

  if (!session || !session.access_token) {
    return null;
  }

  const defaultUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
  const activeCookie =
    session.cookie ||
    `access_token=${session.access_token}; refresh_token=${session.refresh_token || ''}; auth_method=goid`;

  return {
    Authorization: `Bearer ${session.access_token}`,
    Cookie: activeCookie,
    'authentication-type': 'go-id',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://portal.gofoodmerchant.co.id',
    Referer: 'https://portal.gofoodmerchant.co.id/',
    'User-Agent': clientUserAgent || defaultUserAgent
  };
}
