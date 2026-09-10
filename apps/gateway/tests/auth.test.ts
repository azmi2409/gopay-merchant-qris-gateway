import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { initDatabase } from '../src/utils/db';
import { signJWT } from '../src/utils/jwt';

describe('Auth Middleware (API Key & JWT Dual Modes)', () => {
  const jwtSecret = 'test-jwt-secret-key-456';
  const apiKey = 'test-static-api-key-123';

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file::memory:';
    await initDatabase();
  });

  describe('Static API Key Mode (AUTH_MODE=api_key)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'api_key';
      process.env.API_KEY = apiKey;
    });

    it('accepts valid x-api-key header', async () => {
      const res = await request(app).get('/api/v1/logs').set('x-api-key', apiKey);
      expect(res.status).toBe(200);
    });

    it('accepts valid api_key query param', async () => {
      const res = await request(app).get(`/api/v1/logs?api_key=${apiKey}`);
      expect(res.status).toBe(200);
    });

    it('rejects missing or invalid api key', async () => {
      const res = await request(app).get('/api/v1/logs').set('x-api-key', 'wrong');
      expect(res.status).toBe(401);
    });
  });

  describe('JWT Mode (AUTH_MODE=jwt)', () => {
    beforeEach(() => {
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = jwtSecret;
    });

    it('rejects request without Authorization header', async () => {
      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Missing Bearer token');
    });

    it('rejects request with invalid signature', async () => {
      const token = signJWT({ sub: 'admin' }, 'wrong-secret');
      const res = await request(app)
        .get('/api/v1/logs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Invalid or expired JWT');
    });

    it('accepts valid Authorization: Bearer <token>', async () => {
      const token = signJWT({ sub: 'merchant_admin', role: 'admin' }, jwtSecret, {
        expiresInSeconds: 3600
      });
      const res = await request(app)
        .get('/api/v1/logs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('accepts valid JWT via ?token= query parameter', async () => {
      const token = signJWT({ sub: 'user_456' }, jwtSecret, { expiresInSeconds: 60 });
      const res = await request(app).get(`/api/v1/logs?token=${token}`);
      expect(res.status).toBe(200);
    });
  });
});
