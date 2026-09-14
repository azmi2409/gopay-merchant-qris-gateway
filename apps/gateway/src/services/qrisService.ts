import { QRISRecord } from '../types/payment';
import { generateDynamicQRIS } from '../utils/qris';
import { getQrisStatic } from './settingsService';
import { logActivity, QRIS_EXPIRY_MS, saveQRISRecord } from './paymentService';
import * as sessionManager from './sessionManager';
import { randomInt } from 'crypto';
import { getDatabase } from '../utils/db';

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
  useUniqueCode?: unknown;
}

export async function createQris(input: CreateQrisInput, publicBaseUrl: string) {
  const baseAmount = Number(input.amount);
  if (!['number', 'string'].includes(typeof input.amount) || !Number.isSafeInteger(baseAmount) || baseAmount <= 0 || baseAmount > Number.MAX_SAFE_INTEGER - 999) {
    throw new QrisCreationError('Payment amount must be a positive safe integer in rupiah', 400);
  }
  const flag = input.useUniqueCode;
  if (flag !== undefined && ![true, false, 1, 0, 'true', 'false', '1', '0'].includes(flag as any)) {
    throw new QrisCreationError('use_unique_code must be a boolean', 400);
  }
  const useUniqueCode = [true, 1, 'true', '1'].includes(flag as any);

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
  const transaction = await getDatabase().transaction('write');
  let uniqueCode = 0;
  try {
  if (useUniqueCode) {
    const occupied = await transaction.execute({
      sql: 'SELECT amount FROM qris WHERE expires_at > ? AND amount BETWEEN ? AND ?',
      args: [new Date().toISOString(), baseAmount + 1, baseAmount + 999]
    });
    const used = new Set(occupied.rows.map(row => Number(row.amount)));
    const available = Array.from({ length: 999 }, (_, i) => i + 1).filter(code => !used.has(baseAmount + code));
    if (!available.length) throw new QrisCreationError('Unique payment amounts exhausted. Try again after existing QRIS expire.', 409);
    uniqueCode = available[randomInt(available.length)];
  } else {
    const reserved = await transaction.execute({
      sql: 'SELECT id FROM qris WHERE amount = ? AND unique_code > 0 AND expires_at > ? LIMIT 1',
      args: [baseAmount, new Date().toISOString()]
    });
    if (reserved.rows.length) throw new QrisCreationError('Payment amount reserved by an active QRIS. Enable use_unique_code or try later.', 409);
  }
  const amount = baseAmount + uniqueCode;
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
    baseAmount,
    uniqueCode,
    trxId,
    reference,
    attributes,
    callbackUrl,
    expiresAt,
    createdAt: new Date(),
    status: 'PENDING'
  };
  await saveQRISRecord(record, transaction);
  await transaction.commit();
  logActivity('INFO', `Dynamic QRIS created | TRX-ID: ${trxId} | Amount: Rp ${amount}${uniqueCode ? ` (base: ${baseAmount}, unique: ${uniqueCode})` : ''}`);

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
    base_amount: baseAmount,
    unique_code: uniqueCode,
    amount,
    expires_at: expiresAt.toISOString(),
    expires_in: '5 minutes',
    verification_mode: verificationMode
  };
  } finally {
    transaction.close();
  }
}
