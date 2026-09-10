import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { getDatabase } from '../utils/db';

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

/**
 * Resolves the effective secret key for signing / verifying a webhook payload.
 * Priority:
 * 1. Webhook-specific secret
 * 2. WEBHOOK_SECRET_KEY or WEBHOOK_SECRET environment variable
 */
export function resolveWebhookSecret(overrideSecret?: string): string | undefined {
  return overrideSecret || process.env.WEBHOOK_SECRET_KEY || process.env.WEBHOOK_SECRET || undefined;
}

/**
 * Computes an HMAC-SHA256 signature for a payload body.
 */
export function signWebhookPayload(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Validates an HMAC-SHA256 signature against a payload using timing-safe comparison.
 */
export function verifyWebhookSignature(body: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = signWebhookPayload(body, secret);
  try {
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signatureHeader);
    return (
      expectedBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  } catch {
    return false;
  }
}

/**
 * Pings the target webhook URL with a verification ping.
 * Returns true if the endpoint returns a 2xx HTTP status.
 */
export async function pingWebhookUrl(url: string, secret?: string): Promise<boolean> {
  const pingPayload: WebhookPayload = {
    id: 'ping_' + Math.random().toString(36).substring(2, 10),
    event: 'webhook.ping',
    timestamp: new Date().toISOString(),
    data: { message: 'Webhook verification ping' }
  };
  const body = JSON.stringify(pingPayload);
  const effectiveSecret = resolveWebhookSecret(secret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'GoPay-Merchant-Webhook/1.0',
    'X-Webhook-Event': 'webhook.ping',
    'X-Webhook-Delivery': pingPayload.id
  };

  if (effectiveSecret) {
    headers['X-Webhook-Signature'] = signWebhookPayload(body, effectiveSecret);
  }

  const response = await axios.post(url, body, {
    headers,
    timeout: 5000,
    validateStatus: (status) => status >= 200 && status < 300
  });

  return response.status >= 200 && response.status < 300;
}

export async function registerWebhook(
  url: string,
  events: string[] = ['payment.success'],
  secret?: string
): Promise<WebhookRegistration> {
  const id = 'whk_' + Math.random().toString(36).substring(2, 10);
  const createdAt = new Date().toISOString();
  const normalizedEvents = events.length > 0 ? events : ['payment.success'];

  const db = getDatabase();
  await db.execute({
    sql: `INSERT INTO webhooks (id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, url, secret || null, JSON.stringify(normalizedEvents), createdAt]
  });

  logger.info(`Webhook registered: ${id} -> ${url}`);
  return {
    id,
    url,
    secret,
    events: normalizedEvents,
    createdAt
  };
}

export async function removeWebhook(id: string): Promise<boolean> {
  const db = getDatabase();
  const res = await db.execute({
    sql: `DELETE FROM webhooks WHERE id = ?`,
    args: [id]
  });
  return res.rowsAffected > 0;
}

export async function listWebhooks(): Promise<WebhookRegistration[]> {
  const db = getDatabase();
  const res = await db.execute(`SELECT * FROM webhooks ORDER BY created_at DESC`);
  return res.rows.map((row: any) => ({
    id: String(row.id),
    url: String(row.url),
    secret: row.secret ? String(row.secret) : undefined,
    events: JSON.parse(String(row.events)),
    createdAt: String(row.created_at)
  }));
}

export async function clearWebhooks(): Promise<void> {
  const db = getDatabase();
  await db.execute(`DELETE FROM webhooks`);
}

/**
 * Dispatches an event payload asynchronously to all matching webhooks with HMAC-SHA256 signature
 */
export async function dispatchWebhookEvent(event: string, data: unknown): Promise<void> {
  const allHooks = await listWebhooks();
  const matching = allHooks.filter((wh) => wh.events.includes('*') || wh.events.includes(event));

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    id: 'evt_' + Math.random().toString(36).substring(2, 10),
    event,
    timestamp: new Date().toISOString(),
    data
  };
  const body = JSON.stringify(payload);

  for (const wh of matching) {
    const effectiveSecret = resolveWebhookSecret(wh.secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'GoPay-Merchant-Webhook/1.0',
      'X-Webhook-Event': event,
      'X-Webhook-Delivery': payload.id
    };

    if (effectiveSecret) {
      headers['X-Webhook-Signature'] = signWebhookPayload(body, effectiveSecret);
    }

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
