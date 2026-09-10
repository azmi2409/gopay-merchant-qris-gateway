import crypto from 'crypto';

export interface JWTOptions {
  expiresInSeconds?: number;
}

export interface JWTPayload {
  [key: string]: unknown;
  exp?: number;
  iat?: number;
}

function base64UrlEncode(str: string | Buffer): string {
  const base64 = (Buffer.isBuffer(str) ? str : Buffer.from(str)).toString('base64');
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Signs a JWT using HMAC-SHA256 (HS256)
 */
export function signJWT(payload: JWTPayload, secret: string, options: JWTOptions = {}): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JWTPayload = {
    ...payload,
    iat: payload.iat ?? now
  };

  if (options.expiresInSeconds && !fullPayload.exp) {
    fullPayload.exp = now + options.expiresInSeconds;
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', secret).update(dataToSign).digest();
  const encodedSignature = base64UrlEncode(signature);

  return `${dataToSign}.${encodedSignature}`;
}

/**
 * Verifies a HS256 JWT using crypto.timingSafeEqual.
 * Returns parsed payload if valid and unexpired; otherwise returns null.
 */
export function verifyJWT<T = JWTPayload>(token: string, secret: string): T | null {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = base64UrlEncode(crypto.createHmac('sha256', secret).update(dataToSign).digest());

    const sigBuf = Buffer.from(encodedSignature);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JWTPayload;

    // Check expiration if exp is present
    if (payload.exp && typeof payload.exp === 'number') {
      const now = Math.floor(Date.now() / 1000);
      if (now > payload.exp) {
        return null;
      }
    }

    return payload as T;
  } catch {
    return null;
  }
}
