import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/services/paymentService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/paymentService')>()),
  verifyPayment: vi.fn().mockRejectedValue(new Error('Synthetic verification unavailable'))
}));

import { app } from '../src/app';
import { initDatabase, getDatabase } from '../src/utils/db';

describe('API Gateway REST v1 Integration Tests', () => {
  beforeAll(async () => {
    process.env.API_KEY = 'test-secret-key-123';
    process.env.DATABASE_URL = 'file::memory:';
    process.env.QRIS_STATIC =
      '00020101021153033605802ID5913TEST MERCHANT6007JAKARTA63042E07';
    await initDatabase();
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

  describe('QRIS endpoints with reference and attributes', () => {
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

    it('POST /api/v1/qris should create dynamic QRIS and persist reference + attributes', async () => {
      const res = await request(app)
        .post('/api/v1/qris')
        .set('x-api-key', 'test-secret-key-123')
        .send({
          amount: 50000,
          reference: 'INV-2026-001',
          callback_url: 'https://merchant.example.com/payment/result?source=store',
          attributes: { customer_id: 'CUST-99', email: 'user@example.com' }
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(50000);
      expect(res.body.data.reference).toBe('INV-2026-001');
      expect(res.body.data.callback_url).toBe(
        'https://merchant.example.com/payment/result?source=store'
      );
      expect(res.body.data.attributes).toEqual({ customer_id: 'CUST-99', email: 'user@example.com' });
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
      expect(dataRes.body.data.reference).toBe('INV-2026-001');
      expect(dataRes.body.data.callback_url).toBe(
        'https://merchant.example.com/payment/result?source=store'
      );
      expect(dataRes.body.data.attributes).toEqual({ customer_id: 'CUST-99', email: 'user@example.com' });

      // GET /api/v1/qris/:id/status
      const statusRes = await request(app).get(`/api/v1/qris/${qrisId}/status`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.status).toBe('PENDING');
      expect(statusRes.body.reference).toBe('INV-2026-001');
      expect(statusRes.body.attributes).toEqual({ customer_id: 'CUST-99', email: 'user@example.com' });

      // GET /qr/:id (serves HTML)
      const pageRes = await request(app).get(`/qr/${qrisId}`);
      expect(pageRes.status).toBe(200);
      expect(pageRes.headers['content-type']).toContain('text/html');

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        })
      );
      const downloadRes = await request(app).get(`/qr/${qrisId}?download=1`);
      fetchMock.mockRestore();

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('image/png');
      expect(downloadRes.headers['content-disposition']).toBe(
        `attachment; filename="qris-${qrisId}.png"`
      );
    });

    it('POST /api/v1/qris should reject a non-HTTP callback URL', async () => {
      const res = await request(app)
        .post('/api/v1/qris')
        .set('x-api-key', 'test-secret-key-123')
        .send({ amount: 50000, callback_url: 'javascript:alert(1)' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('callback_url');
    });

    it('POST /api/v1/qris should keep callback_url optional', async () => {
      const res = await request(app)
        .post('/api/v1/qris')
        .set('x-api-key', 'test-secret-key-123')
        .send({ amount: 25000 });

      expect(res.status).toBe(201);
      expect(res.body.data.callback_url).toBeNull();
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
