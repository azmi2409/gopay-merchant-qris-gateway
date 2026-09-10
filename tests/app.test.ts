import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('API Gateway Integration Tests', () => {
  beforeAll(() => {
    process.env.API_KEY = 'test-secret-key-123';
    process.env.QRIS_STATIC =
      '00020101021153033605802ID5913TEST MERCHANT6007JAKARTA63042E07';
  });

  it('GET /healthz should return 200 healthy', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /create-qris should reject unauthorized requests without API key', async () => {
    const res = await request(app).get('/create-qris?amount=50000');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /create-qris should reject invalid amount', async () => {
    const res = await request(app)
      .get('/create-qris?amount=abc')
      .set('x-api-key', 'test-secret-key-123');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /create-qris should successfully create dynamic QRIS with valid API key', async () => {
    const res = await request(app)
      .get('/create-qris?amount=50000')
      .set('x-api-key', 'test-secret-key-123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(50000);
    expect(res.body.data.qris_id).toBeDefined();
    expect(res.body.data.trx_id).toMatch(/^TRX-/);
    expect(res.body.data.qris_code).toContain('540550000');

    // Test GET /api/qr-data/:id
    const qrisId = res.body.data.qris_id;
    const dataRes = await request(app).get(`/api/qr-data/${qrisId}`);
    expect(dataRes.status).toBe(200);
    expect(dataRes.body.success).toBe(true);
    expect(dataRes.body.data.qris_id).toBe(qrisId);
    expect(dataRes.body.data.amount).toBe(50000);

    // Test GET /qr/:id (serves HTML)
    const pageRes = await request(app).get(`/qr/${qrisId}`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers['content-type']).toContain('text/html');
  });
});
