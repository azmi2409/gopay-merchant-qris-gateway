import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createAdminApp } from '../src/app';

describe('admin web service', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'synthetic-admin-password';
    process.env.ADMIN_SESSION_SECRET = 'synthetic-session-secret-at-least-32-characters';
    process.env.ADMIN_API_KEY = 'synthetic-service-secret-at-least-32-characters';
    vi.restoreAllMocks();
  });

  it('requires login for gateway data', async () => {
    const response = await request(createAdminApp()).get('/admin/api/dashboard');
    expect(response.status).toBe(401);
  });

  it('creates an HttpOnly strict session cookie', async () => {
    const response = await request(createAdminApp())
      .post('/admin/api/login')
      .send({ password: 'synthetic-admin-password' });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
  });

  it('proxies analytics with the server-side service credential', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: { summary: { total: 2 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const agent = request.agent(createAdminApp());
    await agent.post('/admin/api/login').send({ password: 'synthetic-admin-password' });
    const response = await agent.get('/admin/api/dashboard?days=7');
    expect(response.status).toBe(200);
    expect(response.body.data.summary.total).toBe(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'x-admin-api-key': 'synthetic-service-secret-at-least-32-characters'
    });
  });

  it('preserves a safe gateway OTP error status and code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: false,
        code: 'GOBIZ_OTP_REJECTED',
        message: 'GoBiz rejected the OTP request.'
      }), { status: 502, headers: { 'content-type': 'application/json' } })
    );
    const agent = request.agent(createAdminApp());
    await agent.post('/admin/api/login').send({ password: 'synthetic-admin-password' });
    const response = await agent.post('/admin/api/setup/otp').send({ phone: '081234567890' });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('GOBIZ_OTP_REJECTED');
  });

  it('keeps OTP flow credentials server-side through verification', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          phone: '81234567890',
          otpToken: 'synthetic-otp-token',
          deviceId: 'synthetic-device-id',
          expiresIn: 720
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }));
    const agent = request.agent(createAdminApp());
    await agent.post('/admin/api/login').send({ password: 'synthetic-admin-password' });
    const otp = await agent.post('/admin/api/setup/otp').send({ phone: '081234567890' });
    const verify = await agent.post('/admin/api/setup/verify').send({ otp: '1234' });
    expect(otp.text).not.toContain('synthetic-otp-token');
    expect(otp.text).not.toContain('synthetic-device-id');
    expect(verify.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      otp_token: 'synthetic-otp-token',
      device_id: 'synthetic-device-id'
    });
  });

  it('serves first-time onboarding and detailed API documentation controls', async () => {
    const response = await request(createAdminApp()).get('/admin/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('FIRST-TIME SETUP');
    expect(response.text).toContain('id="qris-image"');
    expect(response.text).toContain('Generate QRIS');
    expect(response.text).toContain('Verify and register');

    const script = await request(createAdminApp()).get('/admin/admin.js');
    expect(script.text).toContain("'BarcodeDetector' in window");
    expect(script.text).toContain('Request body');
    expect(script.text).toContain('Example response');

    const alpine = await request(createAdminApp()).get('/admin/vendor/alpine-csp.js');
    expect(alpine.status).toBe(200);
    expect(alpine.headers['content-type']).toContain('javascript');
  });

  it('creates admin QRIS without exposing the public API key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: {
        qris_id: 'abcd1234', trx_id: 'TRX-EXAMPLE', amount: 50000,
        qris_url: 'https://pay.example/qr/abcd1234', expires_at: new Date().toISOString()
      } }), { status: 201, headers: { 'content-type': 'application/json' } })
    );
    const agent = request.agent(createAdminApp());
    await agent.post('/admin/api/login').send({ password: 'synthetic-admin-password' });
    const response = await agent.post('/admin/api/qris').send({ amount: 50000 });
    expect(response.status).toBe(201);
    expect(fetchMock.mock.calls[0][0]).toContain('/internal/admin/qris');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'x-admin-api-key': 'synthetic-service-secret-at-least-32-characters'
    });
  });
});
