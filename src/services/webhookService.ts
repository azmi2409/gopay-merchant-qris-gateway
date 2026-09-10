import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

export interface WebhookRegistration {
  id: string;
  url: string;
  secret?: string;
  events: string[];
  createdAt: string;
}

export interface WebhookPayload {
  id: string;
  event: string;
  timestamp: string;
  data: unknown;
}

// In-memory webhooks store
export const webhookStore = new Map<string, WebhookRegistration>();

export function registerWebhook(
  url: string,
  events: string[] = ['payment.success'],
  secret?: string
): WebhookRegistration {
  const id = 'whk_' + Math.random().toString(36).substring(2, 10);
  const entry: WebhookRegistration = {
    id,
    url,
    secret,
    events: events.length > 0 ? events : ['payment.success'],
    createdAt: new Date().toISOString()
  };
  webhookStore.set(id, entry);
  logger.info(`Webhook registered: ${id} -> ${url}`);
  return entry;
}

export function removeWebhook(id: string): boolean {
  return webhookStore.delete(id);
}

export function listWebhooks(): WebhookRegistration[] {
  return Array.from(webhookStore.values());
}

export function clearWebhooks(): void {
  webhookStore.clear();
}

/**
 * Dispatches an event payload asynchronously to all matching webhooks with HMAC-SHA256 signature
 */
export async function dispatchWebhookEvent(event: string, data: unknown): Promise<void> {
  const matching = Array.from(webhookStore.values()).filter(
    (wh) => wh.events.includes('*') || wh.events.includes(event)
  );

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    id: 'evt_' + Math.random().toString(36).substring(2, 10),
    event,
    timestamp: new Date().toISOString(),
    data
  };
  const body = JSON.stringify(payload);

  for (const wh of matching) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'GoPay-Merchant-Webhook/1.0',
      'X-Webhook-Event': event,
      'X-Webhook-Delivery': payload.id
    };

    if (wh.secret) {
      const hmac = crypto.createHmac('sha256', wh.secret).update(body).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${hmac}`;
    }

    // Fire dispatch asynchronously with backoff retry
    withRetry(
      () =>
        axios.post(wh.url, body, {
          headers,
          timeout: 8000
        }),
      { retries: 2, delayMs: 1000 }
    ).catch((err: any) => {
      logger.error(`Failed dispatching webhook ${wh.id} to ${wh.url}: ${err.message}`);
    });
  }
}
