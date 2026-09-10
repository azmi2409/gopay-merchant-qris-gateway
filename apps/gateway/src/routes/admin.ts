import { Request, Response, Router } from 'express';
import { adminApiAuth } from '../middlewares/adminAuth';
import {
  getDashboardData,
  getPersistentLogs,
  requestGoBizOtp,
  verifyGoBizOtp,
  AdminSetupError
} from '../services/adminService';
import { getGatewaySettings, updateGatewaySettings } from '../services/settingsService';
import { generateDynamicQRIS, parseEMVCoTags } from '../utils/qris';
import { createQris, QrisCreationError } from '../services/qrisService';
import { getQRISRecord, logActivity, updateQRISStatus } from '../services/paymentService';
import {
  listWebhooks,
  pingWebhookUrl,
  registerWebhook,
  removeWebhook
} from '../services/webhookService';

export const adminRouter: Router = Router();
adminRouter.use('/internal/admin', adminApiAuth);

adminRouter.get('/internal/admin/dashboard', async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  res.json({ success: true, data: await getDashboardData(days) });
});

adminRouter.get('/internal/admin/logs', async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  res.json({ success: true, data: await getPersistentLogs(limit) });
});

adminRouter.post('/internal/admin/qris', async (req: Request, res: Response) => {
  try {
    const data = await createQris({
      amount: req.body?.amount,
      reference: req.body?.reference,
      callbackUrl: req.body?.callback_url
    }, process.env.PUBLIC_GATEWAY_URL || 'http://localhost:3000');
    res.status(201).json({ success: true, data });
  } catch (error) {
    const creationError = error instanceof QrisCreationError ? error : null;
    res.status(creationError?.status || 500).json({
      success: false,
      message: creationError?.message || 'Failed to create QRIS'
    });
  }
});

adminRouter.get('/internal/admin/qris/:id/image', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const qris = await getQRISRecord(id);
  if (!qris) {
    res.status(404).json({ success: false, message: 'QRIS not found' });
    return;
  }
  const response = await fetch(
    `https://api.qrserver.com/v1/create-qr-code/?size=700x700&format=png&data=${encodeURIComponent(qris.data)}`
  );
  if (!response.ok) {
    res.status(502).json({ success: false, message: 'QR image service unavailable' });
    return;
  }
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
  res.send(Buffer.from(await response.arrayBuffer()));
});

adminRouter.get('/internal/admin/webhooks', async (_req: Request, res: Response) => {
  const hooks = await listWebhooks();
  res.json({
    success: true,
    data: hooks.map(({ secret, ...hook }) => ({ ...hook, has_secret: Boolean(secret) }))
  });
});

adminRouter.post('/internal/admin/webhooks', async (req: Request, res: Response) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const secret = typeof req.body?.secret === 'string' ? req.body.secret.trim() : undefined;
  const events = Array.isArray(req.body?.events) ? req.body.events : ['payment.success'];
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    res.status(400).json({ success: false, message: 'Webhook URL must be absolute HTTP or HTTPS' });
    return;
  }
  try {
    await pingWebhookUrl(url, secret);
    const { secret: _secret, ...hook } = await registerWebhook(url, events, secret);
    res.status(201).json({ success: true, data: { ...hook, has_secret: Boolean(secret) } });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: `Webhook validation failed: ${error.response ? `HTTP ${error.response.status}` : 'destination unavailable'}`
    });
  }
});

adminRouter.delete('/internal/admin/webhooks/:id', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const removed = await removeWebhook(id);
  res.status(removed ? 200 : 404).json({
    success: removed,
    message: removed ? 'Webhook removed' : 'Webhook not found'
  });
});

adminRouter.post('/internal/admin/qris/:id/mark-paid', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const qris = await getQRISRecord(id);
  if (!qris) {
    res.status(404).json({ success: false, message: 'QRIS not found' });
    return;
  }
  if (qris.status === 'PAID') {
    res.json({ success: true, message: 'QRIS is already paid' });
    return;
  }

  const manualTx = {
    transaction_id: 'MANUAL-' + Date.now(),
    order_id: qris.trxId || qris.id,
    amount: qris.amount,
    raw_amount: qris.amount,
    payer_issuer: 'Manual Merchant Confirmation',
    payment_type: 'MANUAL_QRIS',
    transaction_time: new Date().toISOString()
  };

  await updateQRISStatus(id, 'PAID', manualTx);
  logActivity('SUCCESS', `QRIS ${id} manually marked as PAID by admin`);
  res.json({ success: true, data: { status: 'PAID', transaction: manualTx } });
});

adminRouter.get('/internal/admin/settings', async (_req: Request, res: Response) => {
  const settings = await getGatewaySettings();
  res.json({
    success: true,
    data: {
      qris_configured: Boolean(settings.qrisStatic || process.env.QRIS_STATIC),
      merchant_id: settings.merchantId || process.env.GOPAY_MERCHANT_ID || null
    }
  });
});

adminRouter.put('/internal/admin/settings', async (req: Request, res: Response) => {
  const merchantId = typeof req.body?.merchant_id === 'string' ? req.body.merchant_id.trim() : null;
  const qrisStatic = typeof req.body?.qris_static === 'string' ? req.body.qris_static.trim() : null;
  if (!merchantId && !qrisStatic) {
    res.status(400).json({ success: false, message: 'No settings supplied' });
    return;
  }
  if (qrisStatic) {
    const tags = parseEMVCoTags(qrisStatic);
    const isStaticQris = tags.some(({ tag, val }) => tag === '00' && val === '01') &&
      tags.some(({ tag, val }) => tag === '01' && val === '11') &&
      tags.some(({ tag, val }) => tag === '58' && val === 'ID') &&
      tags.some(({ tag }) => Number(tag) >= 26 && Number(tag) <= 51) &&
      Boolean(generateDynamicQRIS(qrisStatic, 1000));
    if (!isStaticQris) {
      res.status(400).json({ success: false, message: 'The image or payload is not a valid static QRIS' });
      return;
    }
  }
  await updateGatewaySettings({
    ...(merchantId ? { merchantId } : {}),
    ...(qrisStatic ? { qrisStatic } : {})
  });
  res.json({ success: true });
});

adminRouter.post('/internal/admin/session/otp', async (req: Request, res: Response) => {
  try {
    const result = await requestGoBizOtp(req.body?.phone);
    res.json({ success: true, data: result });
  } catch (error: any) {
    const setupError = error instanceof AdminSetupError ? error : null;
    res.status(setupError?.status || 502).json({
      success: false,
      code: setupError?.code || 'OTP_REQUEST_FAILED',
      message: setupError?.message || 'OTP request failed'
    });
  }
});

adminRouter.post('/internal/admin/session/verify', async (req: Request, res: Response) => {
  try {
    await verifyGoBizOtp(
      req.body?.phone,
      req.body?.otp_token,
      String(req.body?.otp || ''),
      req.body?.device_id
    );
    res.json({ success: true });
  } catch (error: any) {
    const setupError = error instanceof AdminSetupError ? error : null;
    res.status(setupError?.status || 502).json({
      success: false,
      code: setupError?.code || 'OTP_VERIFICATION_FAILED',
      message: setupError?.message || 'OTP verification failed'
    });
  }
});
