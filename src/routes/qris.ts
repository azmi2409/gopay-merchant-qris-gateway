import { Router, Request, Response } from 'express';
import path from 'path';
import { apiKeyAuth } from '../middlewares/auth';
import { generateDynamicQRIS } from '../utils/qris';
import {
  qrisStore,
  QRIS_EXPIRY_MS,
  logActivity,
  verifyPayment
} from '../services/paymentService';

export const qrisRouter: Router = Router();

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

// Create dynamic QRIS (GET query or POST body)
qrisRouter.all('/create-qris', apiKeyAuth, (req: Request, res: Response) => {
  const amountParam = req.body?.amount || req.query?.amount;
  if (!amountParam || isNaN(Number(amountParam)) || Number(amountParam) <= 0) {
    res.status(400).json({
      success: false,
      message: 'Nominal pembayaran tidak valid (gunakan ?amount=...)'
    });
    return;
  }

  const staticTemplate = process.env.QRIS_STATIC;
  if (!staticTemplate) {
    res.status(500).json({
      success: false,
      message: 'QRIS_STATIC belum dikonfigurasi di .env'
    });
    return;
  }

  const amount = parseInt(String(amountParam), 10);
  const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
  if (!dynamicCode) {
    res.status(500).json({
      success: false,
      message: 'Gagal membuat QRIS dinamis dari template statis'
    });
    return;
  }

  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
  const createdAt = new Date();

  qrisStore.set(qrisId, {
    id: qrisId,
    data: dynamicCode,
    amount,
    trxId,
    expiresAt,
    createdAt,
    status: 'PENDING'
  });

  const host = req.get('host');
  const protocol = req.protocol;
  const publicUrl = `${protocol}://${host}/qr/${qrisId}`;

  logActivity('INFO', `QRIS Dinamis dibuat | TRX-ID: ${trxId} | Nominal: Rp ${amount}`);

  res.json({
    success: true,
    data: {
      qris_id: qrisId,
      trx_id: trxId,
      qris_url: publicUrl,
      qris_code: dynamicCode,
      amount,
      expires_at: expiresAt.toISOString(),
      expires_in: '5 menit'
    }
  });
});

// JSON data endpoint for the frontend interactive page
qrisRouter.get('/api/qr-data/:id', (req: Request, res: Response) => {
  const id = getParamId(req.params.id);
  const qris = qrisStore.get(id);
  if (!qris) {
    res.json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    return;
  }

  const formattedAmount = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(qris.amount);

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
    qris.data
  )}`;

  res.json({
    success: true,
    data: {
      qris_id: id,
      trx_id: qris.trxId,
      amount: qris.amount,
      formatted_amount: formattedAmount,
      qr_image_url: qrImageUrl,
      qris_code: qris.data,
      expires_at: qris.expiresAt.getTime(),
      duration_ms: QRIS_EXPIRY_MS,
      created_at: qris.createdAt.toISOString(),
      status: qris.status,
      transaction: qris.transaction || null
    }
  });
});

// Serve frontend HTML page or redirect to raw QR code image
qrisRouter.get('/qr/:id', (req: Request, res: Response) => {
  const id = getParamId(req.params.id);
  const qris = qrisStore.get(id);
  if (!qris) {
    res
      .status(404)
      .send(
        '<h3 style="font-family:sans-serif;color:#94a3b8;text-align:center;margin-top:40vh;">QRIS tidak ditemukan atau telah dihapus</h3>'
      );
    return;
  }

  if (req.query.format === 'raw' || req.query.raw === '1') {
    if (Date.now() > qris.expiresAt.getTime()) {
      qrisStore.delete(id);
      res.status(410).send('QRIS Kedaluwarsa');
      return;
    }
    const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      qris.data
    )}`;
    res.redirect(302, qrServerUrl);
    return;
  }

  res.sendFile(path.join(process.cwd(), 'public', 'qris.html'));
});

// Public payment status checking endpoint
qrisRouter.get('/api/qr-status/:id', async (req: Request, res: Response) => {
  const qrisId = getParamId(req.params.id);
  const qris = qrisStore.get(qrisId);
  if (!qris) {
    res.json({ success: false, status: 'NOT_FOUND', message: 'QRIS tidak ditemukan' });
    return;
  }

  if (qris.status === 'PAID') {
    res.json({ success: true, paid: true, status: 'PAID', transaction: qris.transaction });
    return;
  }

  if (Date.now() > qris.expiresAt.getTime()) {
    qrisStore.delete(qrisId);
    res.json({
      success: false,
      paid: false,
      status: 'EXPIRED',
      message: 'QRIS sudah kedaluwarsa'
    });
    return;
  }

  try {
    const userAgent = (req.headers['user-agent'] as string) || null;
    const scopeId = qris.trxId || qrisId;
    const matched = await verifyPayment(
      qris.amount,
      qris.createdAt,
      null,
      userAgent,
      scopeId
    );

    if (matched) {
      qris.status = 'PAID';
      qris.transaction = matched;
      qrisStore.set(qrisId, qris);
      logActivity(
        'SUCCESS',
        `Pembayaran QRIS ID ${qrisId} terverifikasi lunas untuk nominal Rp ${qris.amount}`
      );
      res.json({ success: true, paid: true, status: 'PAID', transaction: matched });
      return;
    }

    res.json({
      success: true,
      paid: false,
      status: 'PENDING',
      message: 'Belum ada pembayaran masuk'
    });
  } catch (err: any) {
    res.json({ success: false, paid: false, status: 'PENDING', message: err.message });
  }
});
