import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { initDatabase } from '../src/utils/db';
import {
  clearWebhooks,
  registerWebhook,
  dispatchWebhookEvent,
  listWebhooks,
  verifyWebhookSignature,
  signWebhookPayload
} from '../src/services/webhookService';
import axios from 'axios';

vi.mock('axios');

describe('Webhook Service & REST API', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file::memory:';
    await initDatabase();
  });

  beforeEach(async () => {
    delete process.env.WEBHOOK_SECRET_KEY;
    delete process.env.WEBHOOK_SECRET;
    await clearWebhooks();
    vi.clearAllMocks();
    process.env.API_KEY = 'test-secret-key-123';
  });

  describe('Signature Helper functions', () => {
    it('signs and verifies payload correctly', () => {
      const payload = JSON.stringify({ event: 'test', amount: 10000 });
      const secret = 'super-secret-key';
      const signature = signWebhookPayload(payload, secret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
      expect(verifyWebhookSignature(payload, signature, 'wrong-secret')).toBe(false);
      expect(verifyWebhookSignature(payload + 'tampered', signature, secret)).toBe(false);
    });
  });

  describe('REST Endpoints', () => {
    it('POST /api/v1/webhooks requires authentication', async () => {
      const res = await request(app).post('/api/v1/webhooks').send({
        url: 'https://example.com/webhook'
      });
      expect(res.status).toBe(401);
    });

    it('POST /api/v1/webhooks validates URL format', async () => {
      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', 'test-secret-key-123')
        .send({ url: 'invalid-url' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/webhooks rejects registration if ping does not return 2xx', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { status: 500, data: 'Server Error' }
      });

      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', 'test-secret-key-123')
        .send({
          url: 'https://myshop.com/callbacks/failing-webhook'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Webhook validation failed');
      expect((await listWebhooks()).length).toBe(0);
    });

    it('POST /api/v1/webhooks pings and saves when ping returns 200', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        status: 200,
        data: { success: true }
      });

      const res = await request(app)
        .post('/api/v1/webhooks')
        .set('x-api-key', 'test-secret-key-123')
        .send({
          url: 'https://myshop.com/callbacks/gopay',
          events: ['payment.success'],
          secret: 'whsec_test123'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toMatch(/^whk_/);
      expect(res.body.data.url).toBe('https://myshop.com/callbacks/gopay');
      expect(res.body.data.secret).toBeUndefined();
      expect(res.body.data.has_secret).toBe(true);

      // Check ping call
      expect(axios.post).toHaveBeenCalledTimes(1);
      const [pingUrl, pingBody, pingConfig] = vi.mocked(axios.post).mock.calls[0];
      expect(pingUrl).toBe('https://myshop.com/callbacks/gopay');
      expect(pingConfig?.headers?.['X-Webhook-Event']).toBe('webhook.ping');
      expect(pingConfig?.headers?.['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

      const listRes = await request(app)
        .get('/api/v1/webhooks')
        .set('x-api-key', 'test-secret-key-123');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].secret).toBeUndefined();
      expect(listRes.body.data[0].has_secret).toBe(true);

      // Delete webhook
      const deleteRes = await request(app)
        .delete(`/api/v1/webhooks/${res.body.data.id}`)
        .set('x-api-key', 'test-secret-key-123');
      expect(deleteRes.status).toBe(200);
      expect((await listWebhooks()).length).toBe(0);
    });
  });

  describe('Event Dispatch & Signature with Global ENV secret', () => {
    it('uses WEBHOOK_SECRET_KEY from process.env when individual webhook has no secret', async () => {
      process.env.WEBHOOK_SECRET_KEY = 'global_env_secret_key';
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

      await registerWebhook('https://merchant.example.com/hook', ['payment.success']);

      await dispatchWebhookEvent('payment.success', { amount: 50000 });

      expect(axios.post).toHaveBeenCalledTimes(1);
      const [calledUrl, body, config] = vi.mocked(axios.post).mock.calls[0];
      expect(calledUrl).toBe('https://merchant.example.com/hook');
      expect(config?.headers?.['X-Webhook-Signature']).toBeDefined();

      const isValid = verifyWebhookSignature(
        body as string,
        config?.headers?.['X-Webhook-Signature'],
        'global_env_secret_key'
      );
      expect(isValid).toBe(true);
    });

    it('prefers registration-specific secret over global env secret', async () => {
      process.env.WEBHOOK_SECRET_KEY = 'global_env_secret_key';
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

      await registerWebhook('https://merchant.example.com/hook', ['payment.success'], 'custom_hook_secret');

      await dispatchWebhookEvent('payment.success', { amount: 50000 });

      expect(axios.post).toHaveBeenCalledTimes(1);
      const [calledUrl, body, config] = vi.mocked(axios.post).mock.calls[0];
      const isValidWithCustom = verifyWebhookSignature(
        body as string,
        config?.headers?.['X-Webhook-Signature'],
        'custom_hook_secret'
      );
      const isValidWithGlobal = verifyWebhookSignature(
        body as string,
        config?.headers?.['X-Webhook-Signature'],
        'global_env_secret_key'
      );

      expect(isValidWithCustom).toBe(true);
      expect(isValidWithGlobal).toBe(false);
    });

    it('ignores webhooks not subscribed to the event', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

      await registerWebhook('https://merchant.example.com/other', ['order.refund']);

      await dispatchWebhookEvent('payment.success', { amount: 50000 });

      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
