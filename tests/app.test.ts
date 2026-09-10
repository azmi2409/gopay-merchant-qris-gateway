import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('API Gateway REST v1 Integration Tests', () => {
  beforeAll(() => {
    process.env.API_KEY = 'test-secret-key-123';
    process.env.QRIS_STATIC =
      '00020101021153033605802ID5913TEST MERCHANT6007JAKARTA63042E07';
  });

  describe('System endpoints', () => {
    it('GET /api/v1/healthz should return 200 healthy', async () => {
      const res = await request(app).get('/api/v1/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(typeof res.body.uptime).toBe('number');
    });

    it('GET /api/v1/health should return 200 with service info', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body.service).toBe('GoPay Partner API Gateway');
    });

    it('GET /api/v1/logs requires API key', async () => {
      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/logs with API key returns log array', async () => {
      const res = await request(app)
        .get('/api/v1/logs')
        .set('x-api-key', 'test-secret-key-123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.logs)).toBe(true);
    });
  });

  describe('QRIS endpoints', () => {
    it('POST /api/v1/qris should reject unauthorized requests without API key', async () => {
      const res = await request(app).post('/api/v1/qris').send({ amount: 50000 });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/qris should reject invalid amount', async () => {
      const res = await request(app)
        .post('/api/v1/qris')
        .set('x-api-key', 'test-secret-key-123')
        .send({ amount: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/qris should create dynamic QRIS', async () => {
      const res = await request(app)
        .post('/api/v1/qris')
        .set('x-api-key', 'test-secret-key-123')
        .send({ amount: 50000 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(50000);
      expect(res.body.data.qris_id).toBeDefined();
      expect(res.body.data.trx_id).toMatch(/^TRX-/);
      expect(res.body.data.qris_code).toContain('540550000');

      const qrisId = res.body.data.qris_id;

      // GET /api/v1/qris/:id
      const dataRes = await request(app).get(`/api/v1/qris/${qrisId}`);
      expect(dataRes.status).toBe(200);
      expect(dataRes.body.success).toBe(true);
      expect(dataRes.body.data.qris_id).toBe(qrisId);
      expect(dataRes.body.data.amount).toBe(50000);

      // GET /api/v1/qris/:id/status
      const statusRes = await request(app).get(`/api/v1/qris/${qrisId}/status`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.status).toBe('PENDING');

      // GET /qr/:id (serves HTML)
      const pageRes = await request(app).get(`/qr/${qrisId}`);
      expect(pageRes.status).toBe(200);
      expect(pageRes.headers['content-type']).toContain('text/html');
    });

    it('GET /api/v1/qris/:id returns 404 for nonexistent id', async () => {
      const res = await request(app).get('/api/v1/qris/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Legacy routes should return 404', () => {
    it('GET /create-qris is removed', async () => {
      const res = await request(app).get('/create-qris?amount=50000');
      expect(res.status).toBe(404);
    });

    it('GET /healthz legacy path is removed', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(404);
    });

    it('GET /transactions legacy path is removed', async () => {
      const res = await request(app).get('/transactions');
      expect(res.status).toBe(404);
    });
  });
});
