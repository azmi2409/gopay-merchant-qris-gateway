import axios from 'axios';
import * as sessionManager from './sessionManager';
import { getDatabase } from '../utils/db';
import { getGatewaySettings } from './settingsService';
import { GoBizOtpRequestResponse, GoBizTokenResponse } from '../types/session';

export const GOBIZ_REQUEST_OTP_URL = 'https://api.gobiz.co.id/goid/login/request';
export const GOBIZ_VERIFY_OTP_URL = 'https://api.gobiz.co.id/goid/token';
export const GOBIZ_USER_CONFIG_URL = 'https://api.gobiz.co.id/goresto/v5/public/users/config';

export class AdminSetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function parsePhoneInput(rawPhone: string): string {
  let digits = String(rawPhone || '').trim().replace(/\D/g, '');
  if (digits.startsWith('62')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export async function requestGoBizOtp(rawPhone: string): Promise<{
  phone: string;
  otpToken: string;
  expiresIn: number;
  deviceId: string;
}> {
  const phone = parsePhoneInput(rawPhone);
  if (!/^8\d{7,13}$/.test(phone)) {
    throw new AdminSetupError(
      'Enter the Indonesian mobile number registered with GoBiz, for example 08xxxxxxxxxx',
      400,
      'INVALID_PHONE'
    );
  }
  const deviceId = sessionManager.generateUUID();
  let response;
  try {
    response = await axios.post<GoBizOtpRequestResponse>(
      GOBIZ_REQUEST_OTP_URL,
      { client_id: 'go-biz-web-new', phone_number: phone, country_code: '62' },
      { headers: sessionManager.getStandardGoBizHeaders(deviceId), timeout: 15000 }
    );
  } catch (error: any) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new AdminSetupError('GoBiz did not respond in time. Try again.', 504, 'GOBIZ_TIMEOUT');
    }
    if (error.response?.status === 429) {
      throw new AdminSetupError(
        'GoBiz rate-limited OTP requests. Wait before trying again.',
        429,
        'GOBIZ_RATE_LIMITED'
      );
    }
    throw new AdminSetupError(
      'GoBiz rejected the OTP request. Confirm the registered phone number and try again.',
      502,
      'GOBIZ_OTP_REJECTED'
    );
  }
  const data = (response.data?.data || response.data || {}) as any;
  const otpToken = data.otp_token || data.login_token;
  if (!otpToken) {
    throw new AdminSetupError('GoBiz returned an invalid OTP response. Try again.', 502, 'GOBIZ_INVALID_RESPONSE');
  }
  return { phone, otpToken, expiresIn: Number(data.expires_in || 720), deviceId };
}

export async function verifyGoBizOtp(
  phone: string,
  otpToken: string,
  otp: string,
  deviceId: string
): Promise<void> {
  const cleanPhone = parsePhoneInput(phone);
  if (!/^\d{4,8}$/.test(otp) || !otpToken || typeof deviceId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(deviceId) || cleanPhone.length < 8) {
    throw new AdminSetupError('Invalid OTP verification request', 400, 'INVALID_OTP_REQUEST');
  }
  const headers = sessionManager.getStandardGoBizHeaders(deviceId);
  let response;
  try {
    response = await axios.post<GoBizTokenResponse>(
      GOBIZ_VERIFY_OTP_URL,
      { client_id: 'go-biz-web-new', grant_type: 'otp', data: { otp, otp_token: otpToken } },
      { headers, timeout: 15000 }
    );
  } catch (error: any) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new AdminSetupError('GoBiz did not respond in time. Try again.', 504, 'GOBIZ_TIMEOUT');
    }
    if (error.response?.status === 401 || error.response?.status === 400) {
      throw new AdminSetupError(
        'The OTP is invalid or expired. Request a new OTP and try again.',
        401,
        'INVALID_OR_EXPIRED_OTP'
      );
    }
    if (error.response?.status === 429) {
      throw new AdminSetupError(
        'GoBiz rate-limited verification attempts. Wait before trying again.',
        429,
        'GOBIZ_RATE_LIMITED'
      );
    }
    throw new AdminSetupError(
      'GoBiz could not verify the OTP. Request a new OTP and try again.',
      502,
      'GOBIZ_VERIFY_FAILED'
    );
  }
  const tokenData = (response.data?.data || response.data || {}) as any;
  if (!tokenData.access_token) throw new Error('GoBiz did not return an access token');

  let merchantId: string | null = null;
  let outletName = 'GoPay Merchant';
  try {
    const config = await axios.get(GOBIZ_USER_CONFIG_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'authentication-type': 'go-id',
        Origin: 'https://portal.gofoodmerchant.co.id',
        Referer: 'https://portal.gofoodmerchant.co.id/',
        'User-Agent': headers['user-agent']
      },
      timeout: 10000
    });
    const data = config.data?.data || config.data || {};
    const merchant = data.merchant || data.merchants?.[0] || data.restaurants?.[0];
    merchantId = merchant?.id ? String(merchant.id) : null;
    outletName = merchant?.name || merchant?.brand_name || outletName;
  } catch {
    // Merchant metadata is optional; the authenticated session remains usable.
  }

  const session = sessionManager.saveSession({
    phone_number: `+62${cleanPhone}`,
    merchant_id: merchantId,
    outlet_name: outletName,
    device_id: deviceId,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_at: new Date(Date.now() + Number(tokenData.expires_in || 86400) * 1000).toISOString()
  });
  await sessionManager.saveSessionToDatabase(session);
}

export async function getDashboardData(days: number): Promise<Record<string, unknown>> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = getDatabase();
  await db.execute({
    sql: `UPDATE qris SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?`,
    args: [new Date().toISOString()]
  });
  const [summary, daily, status, recent, settings, session] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) total, COALESCE(SUM(amount), 0) volume,
            SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) paid,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) pending,
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) paid_volume
            FROM qris WHERE created_at >= ?`,
      args: [since]
    }),
    db.execute({
      sql: `SELECT substr(created_at, 1, 10) day, COUNT(*) total,
            SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) paid,
            COALESCE(SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END), 0) amount
            FROM qris WHERE created_at >= ? GROUP BY day ORDER BY day`,
      args: [since]
    }),
    db.execute({
      sql: `SELECT status, COUNT(*) count FROM qris WHERE created_at >= ? GROUP BY status`,
      args: [since]
    }),
    db.execute({
      sql: `SELECT id, trx_id, amount, reference, created_at, expires_at, status
            FROM qris ORDER BY created_at DESC LIMIT 20`
    }),
    getGatewaySettings(),
    sessionManager.loadSessionAsync()
  ]);
  const row = summary.rows[0] || {};
  const total = Number(row.total || 0);
  const paid = Number(row.paid || 0);
  return {
    range_days: days,
    summary: {
      total,
      paid,
      pending: Number(row.pending || 0),
      volume: Number(row.volume || 0),
      paid_volume: Number(row.paid_volume || 0),
      conversion_rate: total ? Math.round((paid / total) * 1000) / 10 : 0
    },
    daily: daily.rows,
    statuses: status.rows,
    recent: recent.rows,
    setup: {
      qris_configured: Boolean(settings.qrisStatic || process.env.QRIS_STATIC),
      merchant_id_configured: Boolean(settings.merchantId || process.env.GOPAY_MERCHANT_ID),
      session_configured: Boolean(session?.access_token),
      session_expires_at: session?.expires_at || null,
      outlet_name: session?.outlet_name || null,
      mode: (settings.qrisStatic || process.env.QRIS_STATIC)
        ? (session?.access_token ? 'full' : 'generation_only')
        : 'unconfigured'
    }
  };
}

export async function getPersistentLogs(limit: number): Promise<unknown[]> {
  const result = await getDatabase().execute({
    sql: 'SELECT id, timestamp, type, message FROM activity_logs ORDER BY id DESC LIMIT ?',
    args: [limit]
  });
  return result.rows;
}
