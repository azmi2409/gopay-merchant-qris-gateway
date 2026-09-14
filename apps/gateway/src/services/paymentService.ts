import axios from 'axios';
import * as sessionManager from './sessionManager';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { dispatchWebhookEvent } from './webhookService';
import { getDatabase } from '../utils/db';
import { getMerchantId } from './settingsService';
import {
  ActivityLog,
  ClaimedTransactionRecord,
  QRISRecord,
  VerifiedPayment
} from '../types/payment';
import { GoPayRawTransaction, GoPayTransactionsResponse } from '../types/gopay';

export const GOJEK_TRANSACTIONS_URL =
  'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';
export const MAX_LOGS = 100;
export const CLAIMED_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const QRIS_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export const activityLogs: ActivityLog[] = [];

/**
 * Append an activity log with in-memory cap
 */
export function logActivity(
  type: ActivityLog['type'],
  message: string,
  details: unknown = null
): void {
  const timestamp = new Date().toISOString();
  const logObj: ActivityLog = { id: Date.now(), timestamp, type, message, details };
  activityLogs.unshift(logObj);
  if (activityLogs.length > MAX_LOGS) {
    activityLogs.pop();
  }
  logger.log(type, message, details);
  getDatabase().execute({
    sql: 'INSERT INTO activity_logs (timestamp, type, message) VALUES (?, ?, ?)',
    args: [timestamp, type, message]
  }).catch((error: any) => logger.debug(`[ActivityLog] Persistence skipped: ${error.message}`));
}

// ── DB Helpers for QRIS ──

export async function saveQRISRecord(qris: QRISRecord, db: Pick<ReturnType<typeof getDatabase>, 'execute'> = getDatabase()): Promise<void> {
  await db.execute({
    sql: `INSERT INTO qris (id, trx_id, amount, data, reference, attributes, callback_url, created_at, expires_at, status, transaction_json, unique_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      qris.id,
      qris.trxId || null,
      qris.amount,
      qris.data,
      qris.reference || null,
      qris.attributes ? JSON.stringify(qris.attributes) : null,
      qris.callbackUrl || null,
      qris.createdAt.toISOString(),
      qris.expiresAt.toISOString(),
      qris.status,
      qris.transaction ? JSON.stringify(qris.transaction) : null,
      qris.uniqueCode || 0
    ]
  });
}

export async function getQRISRecord(id: string): Promise<QRISRecord | null> {
  const db = getDatabase();
  const res = await db.execute({
    sql: `SELECT * FROM qris WHERE id = ?`,
    args: [id]
  });

  if (res.rows.length === 0) return null;
  const row: any = res.rows[0];

  return {
    id: String(row.id),
    trxId: row.trx_id ? String(row.trx_id) : undefined,
    amount: Number(row.amount),
    baseAmount: Number(row.amount) - Number(row.unique_code || 0),
    uniqueCode: Number(row.unique_code || 0),
    data: String(row.data),
    reference: row.reference ? String(row.reference) : null,
    attributes: row.attributes ? JSON.parse(String(row.attributes)) : null,
    callbackUrl: row.callback_url ? String(row.callback_url) : null,
    createdAt: new Date(String(row.created_at)),
    expiresAt: new Date(String(row.expires_at)),
    status: row.status as QRISRecord['status'],
    transaction: row.transaction_json ? JSON.parse(String(row.transaction_json)) : null
  };
}

export async function updateQRISStatus(
  id: string,
  status: QRISRecord['status'],
  transaction?: VerifiedPayment | null
): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: `UPDATE qris SET status = ?, transaction_json = ? WHERE id = ?`,
    args: [status, transaction ? JSON.stringify(transaction) : null, id]
  });
}

// ── DB Helpers for Claimed Transactions ──

export async function getClaimedTransaction(txId: string): Promise<ClaimedTransactionRecord | null> {
  const db = getDatabase();
  const res = await db.execute({
    sql: `SELECT * FROM claimed_transactions WHERE tx_id = ?`,
    args: [txId]
  });
  if (res.rows.length === 0) return null;
  const row: any = res.rows[0];
  return {
    qrisId: row.qris_id ? String(row.qris_id) : null,
    claimedAt: Number(row.claimed_at)
  };
}

export async function setClaimedTransaction(txId: string, qrisId: string | null, claimedAt = Date.now()): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: `INSERT OR REPLACE INTO claimed_transactions (tx_id, qris_id, claimed_at) VALUES (?, ?, ?)`,
    args: [txId, qrisId, claimedAt]
  });
}

export async function cleanExpiredTransactions(now = Date.now()): Promise<number> {
  const db = getDatabase();
  const threshold = now - CLAIMED_CLEANUP_INTERVAL_MS;
  const res = await db.execute({
    sql: `DELETE FROM claimed_transactions WHERE claimed_at < ?`,
    args: [threshold]
  });
  return res.rowsAffected;
}

/**
 * Pure helper function to match a raw GoPay transaction against a target amount and timestamp,
 * handling GoPay's x100 sen currency scaling and double-claim prevention.
 */
export async function matchTransaction(
  rawTransactions: GoPayRawTransaction[],
  targetAmount: number,
  filterStartTimeMs: number,
  qrisId?: string | null
): Promise<VerifiedPayment | null> {
  for (const tx of rawTransactions) {
    let rawAmount = 0;
    if (typeof tx.gross_amount !== 'undefined') {
      rawAmount = parseInt(String(tx.gross_amount), 10);
    } else if (typeof tx.real_gross_amount !== 'undefined') {
      rawAmount = parseInt(String(tx.real_gross_amount), 10);
    } else if (typeof tx.amount === 'object' && tx.amount?.value) {
      rawAmount = parseInt(String(tx.amount.value), 10);
    } else if (typeof tx.amount !== 'undefined') {
      rawAmount = parseInt(String(tx.amount), 10);
    }

    if (isNaN(rawAmount)) continue;

    // GoPay merchant-analytics/v2 returns gross_amount in sen (x100)
    const isAmountMatch =
      rawAmount === targetAmount ||
      rawAmount === targetAmount * 100 ||
      Math.round(rawAmount / 100) === targetAmount;

    const txTimeString =
      tx.transaction_time || tx.settlement_time || tx.created_at || tx.time || 0;
    const txTimestamp = new Date(txTimeString).getTime();
    const txId = String(tx.id || tx.order_id || tx.wallstreet_transaction_id || '');

    if (!txId) continue;

    if (isAmountMatch && txTimestamp >= filterStartTimeMs) {
      const existingClaim = await getClaimedTransaction(txId);

      if (
        !existingClaim ||
        (qrisId && (existingClaim.qrisId === qrisId || existingClaim.qrisId === null))
      ) {
        await setClaimedTransaction(txId, qrisId || existingClaim?.qrisId || null, Date.now());

        const displayAmount =
          rawAmount % 100 === 0 && rawAmount >= 100000 ? rawAmount / 100 : rawAmount;

        return {
          transaction_id: txId,
          order_id: tx.order_id,
          amount: displayAmount,
          raw_amount: rawAmount,
          payer_issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
          payment_type: tx.payment_type || tx.transaction_source || 'GOPAY_INSTORE',
          transaction_time: String(tx.transaction_time || tx.settlement_time || '')
        };
      } else if (qrisId && existingClaim.qrisId === qrisId) {
        // Re-check from same QRIS
        const displayAmount =
          rawAmount % 100 === 0 && rawAmount >= 100000 ? rawAmount / 100 : rawAmount;

        return {
          transaction_id: txId,
          order_id: tx.order_id,
          amount: displayAmount,
          raw_amount: rawAmount,
          payer_issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
          payment_type: tx.payment_type || tx.transaction_source || 'GOPAY_INSTORE',
          transaction_time: String(tx.transaction_time || tx.settlement_time || '')
        };
      } else {
        continue;
      }
    }
  }

  return null;
}

/**
 * Fetch and verify incoming settlement from GoPay API
 */
export async function verifyPayment(
  amount: number | string,
  startTime?: string | number | Date | null,
  merchantIdOverride: string | null = null,
  userAgent: string | null = null,
  qrisId: string | null = null
): Promise<VerifiedPayment | null> {
  let headers = await sessionManager.getValidHeaders(userAgent);
  if (!headers) {
    throw new Error('GoPay session not found. Configure it in the admin panel.');
  }

  const fetchCheckPayment = async (activeHeaders: Record<string, string>) => {
    const merchantId = merchantIdOverride || await getMerchantId() || '';
    const now = new Date();
    const startTimeDate = startTime
      ? new Date(startTime)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // 5-minute backward buffer for server clock drift
    const startTimeISO = new Date(startTimeDate.getTime() - 5 * 60 * 1000).toISOString();
    const endTimeISO = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

    return await axios.get<GoPayTransactionsResponse>(GOJEK_TRANSACTIONS_URL, {
      headers: activeHeaders,
      params: {
        from: 0,
        size: 20,
        statuses: 'SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND',
        payment_types: 'QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD',
        start_time: startTimeISO,
        end_time: endTimeISO,
        merchant_ids: merchantId
      },
      timeout: 10000
    });
  };

  let response;
  try {
    response = await withRetry(() => fetchCheckPayment(headers));
  } catch (firstErr: any) {
    if (firstErr.response && firstErr.response.status === 401) {
      logActivity('WARNING', 'Session expired (401) in verifyPayment. Refreshing...');
      const refreshed = await sessionManager.refreshSession();
      if (refreshed) {
        const newHeaders = await sessionManager.getValidHeaders(userAgent);
        if (!newHeaders) throw new Error('Failed to obtain new session headers after refresh');
        response = await withRetry(() => fetchCheckPayment(newHeaders));
      } else {
        throw firstErr;
      }
    } else {
      throw firstErr;
    }
  }

  const rawTransactions =
    response.data?.transactions ||
    (Array.isArray(response.data?.data)
      ? response.data.data
      : (response.data?.data as any)?.transactions) ||
    [];

  const targetAmount = typeof amount === 'number' ? amount : parseInt(amount, 10);
  const filterStartTimeMs = startTime ? new Date(startTime).getTime() - 60 * 1000 : 0;

  const matched = await matchTransaction(rawTransactions, targetAmount, filterStartTimeMs, qrisId);

  if (matched) {
    logActivity('INFO', `TRX ${matched.transaction_id} claimed by QRIS ${qrisId || 'manual'}`);
    dispatchWebhookEvent('payment.success', {
      transaction: matched,
      qris_id: qrisId || null
    }).catch((err) => {
      logger.error(`Webhook dispatch error: ${err.message}`);
    });
  }

  return matched;
}
