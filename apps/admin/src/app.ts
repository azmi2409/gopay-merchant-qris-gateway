import crypto from 'crypto';
import path from 'path';
import express, { Express, NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'gopay_admin';
const pendingOtp = new Map<string, {
  phone: string;
  token: string;
  deviceId: string;
  expiresAt: number;
}>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function readCookies(req: Request): Record<string, string> {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').flatMap((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]];
  }));
}

function sessionId(req: Request): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET || '';
  const [id, expires, signature] = (readCookies(req)[COOKIE_NAME] || '').split('.');
  if (!id || !expires || !signature || Number(expires) < Date.now()) return null;
  return constantTimeEqual(signature, sign(`${id}.${expires}`, secret)) ? id : null;
}

function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!sessionId(req)) {
    res.status(401).json({ success: false, message: 'Admin login required' });
    return;
  }
  next();
}

async function gateway(pathname: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3000'}${pathname}`, {
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

export function createAdminApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/admin/healthz', (_req, res) => res.json({ status: 'healthy' }));

  app.post('/admin/api/login', (req, res) => {
    const key = req.ip || 'unknown';
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
      res.status(429).json({ success: false, message: 'Too many login attempts. Try again later.' });
      return;
    }
    const expected = process.env.ADMIN_PASSWORD || '';
    if (expected.length < 12 || !constantTimeEqual(String(req.body?.password || ''), expected)) {
      loginAttempts.set(key, {
        count: attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1,
        resetAt: Date.now() + 15 * 60 * 1000
      });
      res.status(401).json({ success: false, message: 'Invalid admin password' });
      return;
    }
    loginAttempts.delete(key);
    const id = crypto.randomBytes(24).toString('base64url');
    const expires = String(Date.now() + 8 * 60 * 60 * 1000);
    const value = `${id}.${expires}.${sign(`${id}.${expires}`, process.env.ADMIN_SESSION_SECRET || '')}`;
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ success: true });
  });

  app.post('/admin/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ success: true });
  });

  app.get('/admin/api/session', (req, res) => {
    res.json({ success: true, data: { authenticated: Boolean(sessionId(req)) } });
  });

  app.get('/admin/api/dashboard', requireSession, async (req, res) => {
    try {
      res.json({ success: true, data: await gateway(`/internal/admin/dashboard?days=${Number(req.query.days) || 30}`) });
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });
  app.get('/admin/api/logs', requireSession, async (_req, res) => {
    try {
      res.json({ success: true, data: await gateway('/internal/admin/logs?limit=200') });
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });
  app.post('/admin/api/qris', requireSession, async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        data: await gateway('/internal/admin/qris', { method: 'POST', body: JSON.stringify(req.body) })
      });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({ success: false, message: error.message });
    }
  });
  app.get('/admin/api/qris/:id/image', requireSession, async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!/^[a-z0-9]{8}$/.test(id)) {
      res.status(400).json({ success: false, message: 'Invalid QRIS ID' });
      return;
    }
    try {
      const response = await fetch(
        `${process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3000'}/internal/admin/qris/${id}/image`,
        { headers: { 'x-admin-api-key': process.env.ADMIN_API_KEY || '' }, signal: AbortSignal.timeout(15000) }
      );
      if (!response.ok) throw new Error('QR image unavailable');
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });
  app.get('/admin/api/webhooks', requireSession, async (_req, res) => {
    try {
      res.json({ success: true, data: await gateway('/internal/admin/webhooks') });
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });
  app.post('/admin/api/webhooks', requireSession, async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        data: await gateway('/internal/admin/webhooks', { method: 'POST', body: JSON.stringify(req.body) })
      });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({ success: false, message: error.message });
    }
  });
  app.delete('/admin/api/webhooks/:id', requireSession, async (req, res) => {
    try {
      await gateway(`/internal/admin/webhooks/${encodeURIComponent(String(req.params.id))}`, { method: 'DELETE' });
      res.json({ success: true });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({ success: false, message: error.message });
    }
  });
  app.post('/admin/api/qris/:id/mark-paid', requireSession, async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const data = await gateway(`/internal/admin/qris/${encodeURIComponent(String(id))}/mark-paid`, { method: 'POST' });
      res.json({ success: true, data });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({ success: false, message: error.message });
    }
  });
  app.get('/admin/api/settings', requireSession, async (_req, res) => {
    try {
      res.json({ success: true, data: await gateway('/internal/admin/settings') });
    } catch (error: any) {
      res.status(502).json({ success: false, message: error.message });
    }
  });
  app.put('/admin/api/settings', requireSession, async (req, res) => {
    try {
      await gateway('/internal/admin/settings', { method: 'PUT', body: JSON.stringify(req.body) });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  });
  app.post('/admin/api/setup/otp', requireSession, async (req, res) => {
    try {
      const id = sessionId(req)!;
      const data = await gateway('/internal/admin/session/otp', {
        method: 'POST', body: JSON.stringify({ phone: req.body?.phone })
      });
      pendingOtp.set(id, {
        phone: data.phone,
        token: data.otpToken,
        deviceId: data.deviceId,
        expiresAt: Date.now() + data.expiresIn * 1000
      });
      res.json({ success: true, data: { expires_in: data.expiresIn } });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({
        success: false,
        code: gatewayError?.code || 'OTP_REQUEST_FAILED',
        message: error.message || 'OTP request failed'
      });
    }
  });
  app.post('/admin/api/setup/verify', requireSession, async (req, res) => {
    const id = sessionId(req)!;
    const pending = pendingOtp.get(id);
    if (!pending || pending.expiresAt < Date.now()) {
      res.status(400).json({ success: false, message: 'Request a new OTP first' });
      return;
    }
    try {
      await gateway('/internal/admin/session/verify', {
        method: 'POST',
        body: JSON.stringify({
          phone: pending.phone,
          otp_token: pending.token,
          device_id: pending.deviceId,
          otp: req.body?.otp
        })
      });
      pendingOtp.delete(id);
      res.json({ success: true });
    } catch (error: any) {
      const gatewayError = error instanceof GatewayError ? error : null;
      res.status(gatewayError?.status || 502).json({
        success: false,
        code: gatewayError?.code || 'OTP_VERIFICATION_FAILED',
        message: error.message || 'OTP verification failed'
      });
    }
  });

  app.use('/admin', express.static(path.join(__dirname, '..', 'public')));
  app.get('/admin/vendor/alpine-csp.js', (_req, res) => {
    res.sendFile(path.join(path.dirname(require.resolve('@alpinejs/csp')), 'cdn.min.js'), {
      dotfiles: 'allow'
    });
  });
  app.get('/', (_req, res) => res.redirect('/admin/'));
  return app;
}
