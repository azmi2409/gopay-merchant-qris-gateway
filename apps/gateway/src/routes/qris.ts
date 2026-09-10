import { Router, Request, Response } from 'express';
import path from 'path';
import { apiKeyAuth } from '../middlewares/auth';
import {
  getQRISRecord,
  updateQRISStatus,
  QRIS_EXPIRY_MS,
  logActivity,
  verifyPayment
} from '../services/paymentService';
import { createQris, QrisCreationError } from '../services/qrisService';
import * as sessionManager from '../services/sessionManager';

export const qrisRouter: Router = Router();

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

// POST /api/v1/qris
qrisRouter.post('/api/v1/qris', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const data = await createQris({
      amount: req.body?.amount ?? req.query?.amount,
      reference: req.body?.reference ?? req.query?.reference,
      attributes: req.body?.attributes,
      callbackUrl: req.body?.callback_url ?? req.query?.callback_url
    }, `${req.protocol}://${req.get('host')}`);
    res.status(201).json({ success: true, data });
  } catch (error) {
    const creationError = error instanceof QrisCreationError ? error : null;
    res.status(creationError?.status || 500).json({
      success: false,
      message: creationError?.message || 'Failed to create QRIS'
    });
  }
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

  const session = await sessionManager.loadSessionAsync();
  const verificationMode = session?.access_token ? 'auto' : 'manual';

  res.json({
    success: true,
    data: {
      qris_id: id,
      trx_id: qris.trxId,
      reference: qris.reference,
      attributes: qris.attributes,
      callback_url: qris.callbackUrl,
      amount: qris.amount,
      formatted_amount: formattedAmount,
      qr_image_url: qrImageUrl,
      qris_code: qris.data,
      expires_at: qris.expiresAt.getTime(),
      duration_ms: QRIS_EXPIRY_MS,
      created_at: qris.createdAt.toISOString(),
      status: qris.status,
      verification_mode: verificationMode,
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
    await updateQRISStatus(qrisId, 'EXPIRED');
    res.status(410).json({
      success: false,
      paid: false,
      status: 'EXPIRED',
      message: 'QRIS has expired'
    });
    return;
  }

  const session = await sessionManager.loadSessionAsync();
  if (!session?.access_token) {
    res.json({
      success: true,
      paid: false,
      status: 'PENDING',
      verification_mode: 'manual',
      reference: qris.reference,
      attributes: qris.attributes,
      message: 'Automatic verification not enabled. Confirm manually with merchant.'
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
      await updateQRISStatus(id, 'EXPIRED');
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
      await updateQRISStatus(id, 'EXPIRED');
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

  res.sendFile(path.join(__dirname, '..', '..', 'public', 'qris.html'));
});
