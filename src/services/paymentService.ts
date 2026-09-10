import axios from 'axios';
import * as sessionManager from './sessionManager';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { dispatchWebhookEvent } from './webhookService';
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

// In-memory stores
export const claimedTransactions = new Map<string, ClaimedTransactionRecord>();
export const qrisStore = new Map<string, QRISRecord>();
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
}

/**
 * Clean up expired claimed transactions to prevent memory leak
 */
export function cleanExpiredTransactions(now = Date.now()): number {
  let cleaned = 0;
  for (const [txId, claim] of claimedTransactions.entries()) {
    if (now - claim.claimedAt > CLAIMED_CLEANUP_INTERVAL_MS) {
      claimedTransactions.delete(txId);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * Pure helper function to match a raw GoPay transaction against a target amount and timestamp,
 * handling GoPay's x100 sen currency scaling and double-claim prevention.
 */
export function matchTransaction(
  rawTransactions: GoPayRawTransaction[],
  targetAmount: number,
  filterStartTimeMs: number,
  qrisId?: string | null
): VerifiedPayment | null {
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
    // E.g. Rp 50.000 is represented as 5000000.
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
      const existingClaim = claimedTransactions.get(txId);

      if (
        !existingClaim ||
        (qrisId && (existingClaim.qrisId === qrisId || existingClaim.qrisId === null))
      ) {
        claimedTransactions.set(txId, {
          qrisId: qrisId || existingClaim?.qrisId || null,
          claimedAt: Date.now()
        });

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
        // Already claimed by another QRIS
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
    throw new Error('GoPay session not found. Please log in via `npm run login`.');
  }

  const fetchCheckPayment = async (activeHeaders: Record<string, string>) => {
    const merchantId = merchantIdOverride || process.env.GOPAY_MERCHANT_ID || '';
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

  const matched = matchTransaction(rawTransactions, targetAmount, filterStartTimeMs, qrisId);

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
