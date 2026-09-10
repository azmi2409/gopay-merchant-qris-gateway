import crypto from 'crypto';
import { json } from '@sveltejs/kit';
import {
  COOKIE_NAME,
  constantTimeEqual,
  loginAttempts,
  sign
} from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, getClientAddress, cookies }) => {
  const ip = getClientAddress() || 'unknown';
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 5) {
    return json({ success: false, message: 'Too many login attempts. Try again later.' }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const expected = process.env.ADMIN_PASSWORD || '';
  if (expected.length < 12 || !constantTimeEqual(String(body?.password || ''), expected)) {
    loginAttempts.set(ip, {
      count: attempt && attempt.resetAt > Date.now() ? attempt.count + 1 : 1,
      resetAt: Date.now() + 15 * 60 * 1000
    });
    return json({ success: false, message: 'Invalid admin password' }, { status: 401 });
  }

  loginAttempts.delete(ip);
  const id = crypto.randomBytes(24).toString('base64url');
  const expires = String(Date.now() + 8 * 60 * 60 * 1000);
  const value = `${id}.${expires}.${sign(`${id}.${expires}`, process.env.ADMIN_SESSION_SECRET || '')}`;

  cookies.set(COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 28800
  });

  return json({ success: true });
};
