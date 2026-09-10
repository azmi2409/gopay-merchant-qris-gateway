import crypto from 'crypto';

export const COOKIE_NAME = 'gopay_admin';

export const pendingOtp = new Map<string, {
  phone: string;
  token: string;
  deviceId: string;
  expiresAt: number;
}>();

export const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const cookieVal = decodeURIComponent(match.substring(COOKIE_NAME.length + 1));
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  const [id, expires, signature] = cookieVal.split('.');
  if (!id || !expires || !signature || Number(expires) < Date.now()) return null;
  return constantTimeEqual(signature, sign(`${id}.${expires}`, secret)) ? id : null;
}

export async function gateway(pathname: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${process.env.GATEWAY_INTERNAL_URL || 'http://127.0.0.1:3001'}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': process.env.ADMIN_API_KEY || '',
      ...init.headers
    },
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({ message: 'Gateway returned an invalid response' }));
  if (!response.ok) {
    throw new GatewayError(
      body.message || `Gateway request failed (${response.status})`,
      response.status,
      body.code
    );
  }
  return body.data;
}
