import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { app as publicApp } from '../src/app';
import { createInternalApp } from '../src/internalApp';
import { getDatabase, initDatabase } from '../src/utils/db';

describe('private admin API', () => {
  const app = createInternalApp();

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file::memory:';
    process.env.ADMIN_API_KEY = 'internal-test-key-that-is-at-least-32-characters';
    await initDatabase();
  });

  afterEach(() => vi.restoreAllMocks());

  it('rejects requests without the service credential', async () => {
    const response = await request(app).get('/internal/admin/dashboard');
    expect(response.status).toBe(401);
  });

  it('stores settings without returning the QRIS payload', async () => {
    const auth = { 'x-admin-api-key': process.env.ADMIN_API_KEY };
    const save = await request(app)
      .put('/internal/admin/settings')
      .set(auth)
      .send({
        merchant_id: 'SYNTHETIC-MERCHANT',
        qris_static: '00020101021126160012SYNTHETICPAY53033605802ID5913TEST MERCHANT6007JAKARTA6304FFFF'
      });
    expect(save.status).toBe(200);

    const response = await request(app).get('/internal/admin/settings').set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data.qris_configured).toBe(true);
    expect(response.body.data.merchant_id).toBe('SYNTHETIC-MERCHANT');
    expect(response.text).not.toContain('000201010211');
  });

  it('rejects a dynamic QRIS as the reusable static template', async () => {
    const response = await request(app)
      .put('/internal/admin/settings')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY)
      .send({
        qris_static: '00020101021226160012SYNTHETICPAY53033605802ID5913TEST MERCHANT6007JAKARTA6304FFFF'
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('not a valid static QRIS');
  });

  it('returns basic analytics and persistent logs', async () => {
    const auth = { 'x-admin-api-key': process.env.ADMIN_API_KEY };
    const dashboard = await request(app).get('/internal/admin/dashboard?days=7').set(auth);
    const logs = await request(app).get('/internal/admin/logs').set(auth);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.summary.total).toBeTypeOf('number');
    expect(Array.isArray(dashboard.body.data.recent)).toBe(true);
    expect(logs.status).toBe(200);
    expect(Array.isArray(logs.body.data)).toBe(true);
  });

  it('creates QRIS through the private admin API', async () => {
    process.env.PUBLIC_GATEWAY_URL = 'https://pay.example.test';
    const response = await request(app)
      .post('/internal/admin/qris')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY)
      .send({ amount: 42000, reference: 'ADMIN-QR-1' });
    expect(response.status).toBe(201);
    expect(response.body.data.amount).toBe(42000);
    expect(response.body.data.reference).toBe('ADMIN-QR-1');
    expect(response.body.data.qris_url).toMatch(/^https:\/\/pay\.example\.test\/qr\/[a-z0-9]{8}$/);
  });

  it('lists webhooks without exposing signing secrets', async () => {
    const db = getDatabase();
    await db.execute({
      sql: 'INSERT INTO webhooks (id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?)',
      args: ['whk_synthetic', 'https://merchant.example/hook', 'synthetic-secret', '["payment.success"]', new Date().toISOString()]
    });
    const response = await request(app)
      .get('/internal/admin/webhooks')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY);
    expect(response.status).toBe(200);
    expect(response.body.data[0].has_secret).toBe(true);
    expect(response.text).not.toContain('synthetic-secret');
  });

  it('validates GoBiz phone numbers before requesting an OTP', async () => {
    const response = await request(app)
      .post('/internal/admin/session/otp')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY)
      .send({ phone: '123' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_PHONE');
  });

  it('reports an upstream GoBiz OTP rejection as a gateway failure', async () => {
    vi.spyOn(axios, 'post').mockRejectedValueOnce({ response: { status: 400 } });
    const response = await request(app)
      .post('/internal/admin/session/otp')
      .set('x-admin-api-key', process.env.ADMIN_API_KEY)
      .send({ phone: '081234567890' });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('GOBIZ_OTP_REJECTED');
    expect(response.text).not.toContain('response');
  });

  it('reuses the OTP request device ID during verification', async () => {
    const post = vi.spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { data: { otp_token: 'synthetic-otp-token', expires_in: 720 } } })
      .mockResolvedValueOnce({
        data: {
          data: {
            access_token: 'synthetic-access-token',
            refresh_token: 'synthetic-refresh-token',
            expires_in: 86400
          }
        }
      });
    vi.spyOn(axios, 'get').mockRejectedValueOnce(new Error('Optional profile unavailable'));
    const auth = { 'x-admin-api-key': process.env.ADMIN_API_KEY };
    const otp = await request(app)
      .post('/internal/admin/session/otp')
      .set(auth)
      .send({ phone: '081234567890' });
    const verify = await request(app)
      .post('/internal/admin/session/verify')
      .set(auth)
      .send({
        phone: otp.body.data.phone,
        otp_token: otp.body.data.otpToken,
        device_id: otp.body.data.deviceId,
        otp: '1234'
      });
    expect(verify.status).toBe(200);
    expect(post.mock.calls[0][2]?.headers['x-uniqueid']).toBe(otp.body.data.deviceId);
    expect(post.mock.calls[1][2]?.headers['x-uniqueid']).toBe(otp.body.data.deviceId);
  });

  it('manually marks a pending QRIS as paid', async () => {
    const auth = { 'x-admin-api-key': process.env.ADMIN_API_KEY };
    const create = await request(app)
      .post('/internal/admin/qris')
      .set(auth)
      .send({ amount: 15000, reference: 'MANUAL-TEST' });
    expect(create.status).toBe(201);
    const qrisId = create.body.data.qris_id;

    const mark = await request(app)
      .post(`/internal/admin/qris/${qrisId}/mark-paid`)
      .set(auth);
    expect(mark.status).toBe(200);
    expect(mark.body.data.status).toBe('PAID');

    const statusCheck = await request(publicApp).get(`/api/v1/qris/${qrisId}/status`);
    expect(statusCheck.status).toBe(200);
    expect(statusCheck.body.paid).toBe(true);
    expect(statusCheck.body.status).toBe('PAID');
  });
});
