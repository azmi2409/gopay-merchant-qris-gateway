import { describe, it, expect } from 'vitest';
import { parseSessionCookie, sign } from '$lib/server/adminAuth';

describe('SvelteKit Admin Auth utilities', () => {
  const secret = 'super-secret-key-at-least-32-chars-long';

  it('correctly verifies a signed session cookie', () => {
    process.env.ADMIN_SESSION_SECRET = secret;
    const id = 'test-session-id';
    const expires = String(Date.now() + 60000);
    const signature = sign(`${id}.${expires}`, secret);
    const cookieVal = `${id}.${expires}.${signature}`;

    const parsed = parseSessionCookie(`gopay_admin=${encodeURIComponent(cookieVal)}; other=val`);
    expect(parsed).toBe(id);
  });

  it('rejects expired cookies', () => {
    process.env.ADMIN_SESSION_SECRET = secret;
    const id = 'test-session-id';
    const expires = String(Date.now() - 1000);
    const signature = sign(`${id}.${expires}`, secret);
    const cookieVal = `${id}.${expires}.${signature}`;

    const parsed = parseSessionCookie(`gopay_admin=${encodeURIComponent(cookieVal)}`);
    expect(parsed).toBeNull();
  });

  it('rejects tampered signatures', () => {
    process.env.ADMIN_SESSION_SECRET = secret;
    const id = 'test-session-id';
    const expires = String(Date.now() + 60000);
    const cookieVal = `${id}.${expires}.invalid-signature`;

    const parsed = parseSessionCookie(`gopay_admin=${encodeURIComponent(cookieVal)}`);
    expect(parsed).toBeNull();
  });
});
