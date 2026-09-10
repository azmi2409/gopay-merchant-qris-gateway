import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middlewares/auth';
import {
  registerWebhook,
  removeWebhook,
  listWebhooks,
  dispatchWebhookEvent,
  pingWebhookUrl
} from '../services/webhookService';

export const webhookRouter: Router = Router();

// POST /api/v1/webhooks - Register new webhook with pre-flight ping
webhookRouter.post('/api/v1/webhooks', apiKeyAuth, async (req: Request, res: Response) => {
  const { url, events, secret } = req.body || {};

  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    res.status(400).json({
      success: false,
      message: 'Invalid webhook url (must start with http:// or https://)'
    });
    return;
  }

  // Pre-flight ping to ensure webhook endpoint returns 2xx
  try {
    await pingWebhookUrl(url, secret);
  } catch (err: any) {
    const status = err.response ? `HTTP ${err.response.status}` : err.message;
    res.status(400).json({
      success: false,
      message: `Webhook validation failed: destination did not return 2xx (${status})`
    });
    return;
  }

  const registered = registerWebhook(
    url,
    Array.isArray(events) ? events : ['payment.success'],
    secret
  );

  res.status(201).json({
    success: true,
    data: registered
  });
});

// GET /api/v1/webhooks - List all registered webhooks
webhookRouter.get('/api/v1/webhooks', apiKeyAuth, (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: listWebhooks()
  });
});

// DELETE /api/v1/webhooks/:id - Delete webhook
webhookRouter.delete('/api/v1/webhooks/:id', apiKeyAuth, (req: Request, res: Response) => {
  const webhookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const deleted = removeWebhook(webhookId);
  if (!deleted) {
    res.status(404).json({
      success: false,
      message: 'Webhook registration not found'
    });
    return;
  }

  res.json({
    success: true,
    message: 'Webhook removed successfully'
  });
});

// POST /api/v1/webhooks/test - Test trigger webhook event
webhookRouter.post('/api/v1/webhooks/test', apiKeyAuth, async (req: Request, res: Response) => {
  const { event = 'payment.success', data = { test: true } } = req.body || {};
  await dispatchWebhookEvent(event, data);

  res.json({
    success: true,
    message: `Test event '${event}' dispatched`
  });
});
