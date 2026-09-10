import { Router, Request, Response } from 'express';
import axios from 'axios';
import { apiKeyAuth } from '../middlewares/auth';
import * as sessionManager from '../services/sessionManager';
import {
  GOJEK_TRANSACTIONS_URL,
  verifyPayment,
  logActivity
} from '../services/paymentService';
import { FormattedTransaction, GoPayTransactionsResponse } from '../types/gopay';

export const transactionRouter: Router = Router();

// Token and Session Status
transactionRouter.get('/token-status', apiKeyAuth, async (req: Request, res: Response) => {
  const activeHeaders = await sessionManager.getValidHeaders(req.headers['user-agent']);
  if (!activeHeaders) {
    res.json({
      success: false,
      data: {
        token_status: 'invalid',
        message: 'Sesi belum dikonfigurasi. Jalankan `npm run login` di terminal.'
      }
    });
    return;
  }

  try {
    const merchantId = process.env.GOPAY_MERCHANT_ID || '';
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000).toISOString();

    await axios.get(GOJEK_TRANSACTIONS_URL, {
      headers: activeHeaders,
      params: {
        from: 0,
        size: 1,
        statuses: 'SETTLEMENT,CAPTURE',
        payment_types: 'QRIS,GOPAY',
        start_time: oneHourAgo,
        end_time: now.toISOString(),
        merchant_ids: merchantId
      },
      timeout: 5000
    });

    res.json({
      success: true,
      data: { token_status: 'valid', message: 'Token dan Sesi GoPay Merchant Aktif' }
    });
  } catch (err: any) {
    res.json({ success: false, data: { token_status: 'invalid', message: err.message } });
  }
});

// Fetch transaction history
transactionRouter.get('/transactions', apiKeyAuth, async (req: Request, res: Response) => {
  const clientUa = req.headers['user-agent'] || null;
  const headers = await sessionManager.getValidHeaders(clientUa);

  if (!headers) {
    res.status(400).json({
      success: false,
      error: 'Sesi GoPay belum tersedia. Silakan jalankan `npm run login` di terminal.'
    });
    return;
  }

  try {
    const fetchTransactions = async (activeHeaders: Record<string, string>) => {
      const merchantId =
        (req.headers['x-gopay-merchant-id'] as string) ||
        process.env.GOPAY_MERCHANT_ID ||
        '';
      const now = new Date();
      const startTimeISO = req.query.startTime
        ? new Date(parseInt(String(req.query.startTime), 10) * 1000).toISOString()
        : new Date(now.getTime() - 3 * 24 * 3600 * 1000).toISOString();
      const endTimeISO = req.query.endTime
        ? new Date(parseInt(String(req.query.endTime), 10) * 1000).toISOString()
        : now.toISOString();

      return await axios.get<GoPayTransactionsResponse>(GOJEK_TRANSACTIONS_URL, {
        headers: activeHeaders,
        params: {
          from: 0,
          size: parseInt(String(req.query.pageSize || '20'), 10),
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
      response = await fetchTransactions(headers);
    } catch (firstErr: any) {
      if (firstErr.response && firstErr.response.status === 401) {
        logActivity('WARNING', 'Sesi expired (401). Memulai auto-refresh...');
        const refreshed = await sessionManager.refreshSession();
        if (refreshed) {
          const newHeaders = await sessionManager.getValidHeaders(clientUa);
          if (!newHeaders) throw new Error('Headers invalid after refresh');
          response = await fetchTransactions(newHeaders);
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

    const formattedTransactions: FormattedTransaction[] = rawTransactions.map((tx: any) => {
      const raw = parseInt(String(tx.gross_amount || tx.real_gross_amount || 0), 10);
      const amountRupiah = raw % 100 === 0 && raw >= 100000 ? raw / 100 : raw;
      return {
        amount: amountRupiah,
        gross_amount_raw: raw,
        status: tx.transaction_status ? tx.transaction_status.toLowerCase() : 'success',
        time: tx.transaction_time || tx.settlement_time || '',
        issuer: tx.qris_provider_aspi_issuer || 'GoPay / Bank',
        order_id: tx.order_id,
        transaction_id: tx.id
      };
    });

    res.json({
      success: true,
      total_amount: String(formattedTransactions.reduce((total, tx) => total + tx.amount, 0)),
      data: { transactions: formattedTransactions }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Shortcut for all transactions this month
transactionRouter.get('/transactions/all', apiKeyAuth, async (req: Request, res: Response) => {
  const now = new Date();
  const startOfMonthUnix = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
  );
  req.query.startTime = String(startOfMonthUnix);
  req.query.pageSize = '100';

  // Delegate directly to the transactions endpoint logic
  (req.app._router as any).handle({ ...req, url: '/transactions', method: 'GET' }, res);
});

// Check payment (supports GET and POST)
transactionRouter.all('/check-payment', apiKeyAuth, async (req: Request, res: Response) => {
  const amount = req.body?.amount || req.query?.amount;
  const startTime = req.body?.startTime || req.query?.startTime || req.query?.start_time;
  const scopeId = req.body?.trx_id || req.query?.trx_id || null;

  if (!amount || isNaN(Number(amount))) {
    res.status(400).json({ success: false, message: 'Nominal pembayaran tidak valid' });
    return;
  }

  try {
    const merchantId = (req.headers['x-gopay-merchant-id'] as string) || null;
    const userAgent = (req.headers['user-agent'] as string) || null;
    const matchedTransaction = await verifyPayment(
      amount,
      startTime,
      merchantId,
      userAgent,
      scopeId
    );

    if (matchedTransaction) {
      logActivity(
        'SUCCESS',
        `Pembayaran terverifikasi lunas untuk nominal Rp ${parseInt(String(amount), 10)}`,
        matchedTransaction
      );
      res.json({
        success: true,
        paid: true,
        transaction: matchedTransaction
      });
      return;
    }

    res.json({
      success: true,
      paid: false,
      message: 'Pembayaran belum ditemukan atau sudah pernah diklaim'
    });
  } catch (err: any) {
    const errorDetail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    logActivity('ERROR', `Gagal periksa pembayaran: ${errorDetail}`);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data transaksi dari API GoPay',
      error: errorDetail
    });
  }
});
