import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import {
  clearWebhooks,
  registerWebhook,
  dispatchWebhookEvent,
  listWebhooks
} from '../src/services/webhookService';
import axios from 'axios';

vi.mock('axios');

describe('Webhook Service & REST API', () => {
  beforeEach(() => {
    clearWebhooks();
    vi.clearAllMocks();
    process.env.API_KEY = 'test-secret-key-123';
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
      expect(listWebhooks().length).toBe(0);
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
      expect(res.body.data.secret).toBe('whsec_test123');

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

      // Delete webhook
      const deleteRes = await request(app)
        .delete(`/api/v1/webhooks/${res.body.data.id}`)
        .set('x-api-key', 'test-secret-key-123');
      expect(deleteRes.status).toBe(200);
      expect(listWebhooks().length).toBe(0);
    });
  });

  describe('Event Dispatch & Signature', () => {
    it('dispatches webhook event with sha256 HMAC signature', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

      registerWebhook('https://merchant.example.com/hook', ['payment.success'], 'my_secret_key');

      await dispatchWebhookEvent('payment.success', { amount: 50000, transaction_id: 'TRX123' });

      expect(axios.post).toHaveBeenCalledTimes(1);
      const [calledUrl, body, config] = vi.mocked(axios.post).mock.calls[0];

      expect(calledUrl).toBe('https://merchant.example.com/hook');
      expect(config?.headers?.['X-Webhook-Event']).toBe('payment.success');
      expect(config?.headers?.['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);

      const parsedBody = JSON.parse(body as string);
      expect(parsedBody.event).toBe('payment.success');
      expect(parsedBody.data.amount).toBe(50000);
    });

    it('ignores webhooks not subscribed to the event', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: {} });

      registerWebhook('https://merchant.example.com/other', ['order.refund']);

      await dispatchWebhookEvent('payment.success', { amount: 50000 });

      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
