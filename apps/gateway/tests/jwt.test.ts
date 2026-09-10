import { describe, it, expect } from 'vitest';
import { signJWT, verifyJWT } from '../src/utils/jwt';

describe('JWT Utility (HS256)', () => {
  const secret = 'super-secret-jwt-key-123';

  it('signs and verifies valid JWT successfully', () => {
    const token = signJWT({ sub: 'user_123', role: 'admin' }, secret, {
      expiresInSeconds: 3600
    });

    const verified = verifyJWT<{ sub: string; role: string }>(token, secret);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('user_123');
    expect(verified?.role).toBe('admin');
  });

  it('rejects token with invalid signature', () => {
    const token = signJWT({ sub: 'user_123' }, secret);
    const verified = verifyJWT(token, 'wrong-secret');
    expect(verified).toBeNull();
  });

  it('rejects expired token', () => {
    // Generate token expired 10 seconds ago
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = signJWT({ sub: 'user_123', exp: past }, secret);
    const verified = verifyJWT(token, secret);
    expect(verified).toBeNull();
  });

  it('rejects malformed token strings', () => {
    expect(verifyJWT('invalid.jwt', secret)).toBeNull();
    expect(verifyJWT('a.b.c.d', secret)).toBeNull();
    expect(verifyJWT('', secret)).toBeNull();
  });
});
