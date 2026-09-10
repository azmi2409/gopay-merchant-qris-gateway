import { Router, Request, Response } from 'express';
import path from 'path';
import { apiKeyAuth } from '../middlewares/auth';
import { generateDynamicQRIS } from '../utils/qris';
import {
  saveQRISRecord,
  getQRISRecord,
  updateQRISStatus,
  deleteQRISRecord,
  QRIS_EXPIRY_MS,
  logActivity,
  verifyPayment
} from '../services/paymentService';

export const qrisRouter: Router = Router();

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

// POST /api/v1/qris
qrisRouter.post('/api/v1/qris', apiKeyAuth, async (req: Request, res: Response) => {
  const amountParam = req.body?.amount ?? req.query?.amount;
  const reference = req.body?.reference ?? req.query?.reference ?? null;
  const attributes = req.body?.attributes ?? null;

  if (!amountParam || isNaN(Number(amountParam)) || Number(amountParam) <= 0) {
    res.status(400).json({
      success: false,
      message: 'Invalid payment amount (send { "amount": 50000 } in body)'
    });
    return;
  }

  const staticTemplate = process.env.QRIS_STATIC;
  if (!staticTemplate) {
    res.status(500).json({
      success: false,
      message: 'QRIS_STATIC is not configured in .env'
    });
    return;
  }

  const amount = parseInt(String(amountParam), 10);
  const dynamicCode = generateDynamicQRIS(staticTemplate, amount);
  if (!dynamicCode) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate dynamic QRIS from static template'
    });
    return;
  }

  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId = 'TRX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt = new Date(Date.now() + QRIS_EXPIRY_MS);
  const createdAt = new Date();

  await saveQRISRecord({
    id: qrisId,
    data: dynamicCode,
    amount,
    trxId,
    reference: reference ? String(reference) : null,
    attributes: typeof attributes === 'object' && attributes !== null ? attributes : null,
    expiresAt,
    createdAt,
    status: 'PENDING'
  });

  const host = req.get('host');
  const protocol = req.protocol;
  const publicUrl = `${protocol}://${host}/qr/${qrisId}`;

  logActivity('INFO', `Dynamic QRIS created | TRX-ID: ${trxId} | Amount: Rp ${amount}`);

  res.status(201).json({
    success: true,
    data: {
      qris_id: qrisId,
      trx_id: trxId,
      reference: reference ? String(reference) : null,
      attributes: typeof attributes === 'object' && attributes !== null ? attributes : null,
      qris_url: publicUrl,
      qris_code: dynamicCode,
      amount,
      expires_at: expiresAt.toISOString(),
      expires_in: '5 minutes'
    }
  });
});

// GET /api/v1/qris/:id
qrisRouter.get('/api/v1/qris/:id', async (req: Request, res: Response) => {
  const id = getParamId(req.params.id);
  const qris = await getQRISRecord(id);
  if (!qris) {
    res.status(404).json({ success: false, status: 'NOT_FOUND', message: 'QRIS not found' });
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
      reference: qris.reference,
      attributes: qris.attributes,
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

// GET /api/v1/qris/:id/status
qrisRouter.get('/api/v1/qris/:id/status', async (req: Request, res: Response) => {
  const qrisId = getParamId(req.params.id);
  const qris = await getQRISRecord(qrisId);
  if (!qris) {
    res.status(404).json({ success: false, status: 'NOT_FOUND', message: 'QRIS not found' });
    return;
  }

  if (qris.status === 'PAID') {
    res.json({
      success: true,
      paid: true,
      status: 'PAID',
      reference: qris.reference,
      attributes: qris.attributes,
      transaction: qris.transaction
    });
    return;
  }

  if (Date.now() > qris.expiresAt.getTime()) {
    await deleteQRISRecord(qrisId);
    res.status(410).json({
      success: false,
      paid: false,
      status: 'EXPIRED',
      message: 'QRIS has expired'
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
      await updateQRISStatus(qrisId, 'PAID', matched);
      logActivity(
        'SUCCESS',
        `QRIS payment ID ${qrisId} verified for amount Rp ${qris.amount}`
      );
      res.json({
        success: true,
        paid: true,
        status: 'PAID',
        reference: qris.reference,
        attributes: qris.attributes,
        transaction: matched
      });
      return;
    }

    res.json({
      success: true,
      paid: false,
      status: 'PENDING',
      reference: qris.reference,
      attributes: qris.attributes,
      message: 'No payment received yet'
    });
  } catch (err: any) {
    // Session absence or upstream timeouts during polling return pending status without 500
    // ponytail: upgrade to explicit upstream error reporting if caller asks for strict auth errors
    logActivity('WARNING', `QRIS payment polling warning for ${qrisId}: ${err.message}`);
    res.json({
      success: true,
      paid: false,
      status: 'PENDING',
      reference: qris.reference,
      attributes: qris.attributes,
      message: 'Payment verification pending'
    });
  }
});

// GET /qr/:id (Customer payment landing page)
qrisRouter.get('/qr/:id', async (req: Request, res: Response) => {
  const id = getParamId(req.params.id);
  const qris = await getQRISRecord(id);
  if (!qris) {
    res
      .status(404)
      .send(
        '<h3 style="font-family:sans-serif;color:#94a3b8;text-align:center;margin-top:40vh;">QRIS not found or has been removed</h3>'
      );
    return;
  }

  if (req.query.format === 'raw' || req.query.raw === '1') {
    if (Date.now() > qris.expiresAt.getTime()) {
      await deleteQRISRecord(id);
      res.status(410).send('QRIS Expired');
      return;
    }
    const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      qris.data
    )}`;
    res.redirect(302, qrServerUrl);
    return;
  }

  if (req.query.download === '1') {
    if (Date.now() > qris.expiresAt.getTime()) {
      await deleteQRISRecord(id);
      res.status(410).send('QRIS Expired');
      return;
    }

    const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1000x1000&format=png&data=${encodeURIComponent(
      qris.data
    )}`;
    const qrResponse = await fetch(qrServerUrl);
    if (!qrResponse.ok) {
      res.status(502).send('Failed to generate QRIS image');
      return;
    }

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="qris-${id}.png"`,
      'Cache-Control': 'private, no-store'
    });
    res.send(Buffer.from(await qrResponse.arrayBuffer()));
    return;
  }

  res.sendFile(path.join(process.cwd(), 'public', 'qris.html'));
});
