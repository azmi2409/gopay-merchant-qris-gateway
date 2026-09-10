import { QRISRecord } from '../types/payment';
import { generateDynamicQRIS } from '../utils/qris';
import { getQrisStatic } from './settingsService';
import { logActivity, QRIS_EXPIRY_MS, saveQRISRecord } from './paymentService';
import * as sessionManager from './sessionManager';

export class QrisCreationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface CreateQrisInput {
  amount: unknown;
  reference?: unknown;
  attributes?: unknown;
  callbackUrl?: unknown;
}

export async function createQris(input: CreateQrisInput, publicBaseUrl: string) {
  if (!input.amount || isNaN(Number(input.amount)) || Number(input.amount) <= 0) {
    throw new QrisCreationError('Payment amount must be greater than zero', 400);
  }

  let callbackUrl: string | null = null;
  if (input.callbackUrl !== null && input.callbackUrl !== undefined && input.callbackUrl !== '') {
    try {
      const parsed = new URL(String(input.callbackUrl));
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      callbackUrl = parsed.toString();
    } catch {
      throw new QrisCreationError('callback_url must be an absolute HTTP or HTTPS URL', 400);
    }
  }

  const staticTemplate = await getQrisStatic();
  if (!staticTemplate) throw new QrisCreationError('Static QRIS is not configured', 409);
  const amount = Math.trunc(Number(input.amount));
  const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
  if (!dynamicCode) throw new QrisCreationError('Failed to generate dynamic QRIS', 500);

  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
  const reference = input.reference ? String(input.reference).slice(0, 255) : null;
  const attributes = typeof input.attributes === 'object' && input.attributes !== null
    ? input.attributes as Record<string, unknown>
    : null;
  const record: QRISRecord = {
    id: qrisId,
    data: dynamicCode,
    amount,
    trxId,
    reference,
    attributes,
    callbackUrl,
    expiresAt,
    createdAt: new Date(),
    status: 'PENDING'
  };
  await saveQRISRecord(record);
  logActivity('INFO', `Dynamic QRIS created | TRX-ID: ${trxId} | Amount: Rp ${amount}`);

  const session = await sessionManager.loadSessionAsync();
  const verificationMode = session?.access_token ? 'auto' : 'manual';

  return {
    qris_id: qrisId,
    trx_id: trxId,
    reference,
    attributes,
    callback_url: callbackUrl,
    qris_url: `${publicBaseUrl.replace(/\/$/, '')}/qr/${qrisId}`,
    qris_code: dynamicCode,
    amount,
    expires_at: expiresAt.toISOString(),
    expires_in: '5 minutes',
    verification_mode: verificationMode
  };
}
