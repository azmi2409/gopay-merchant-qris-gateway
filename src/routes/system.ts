import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middlewares/auth';
import { activityLogs } from '../services/paymentService';

export const systemRouter: Router = Router();

systemRouter.get('/', (_req: Request, res: Response) => {
  res.send('GoPay Partner API Gateway Berjalan');
});

systemRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'OK', service: 'GoPay Partner API Gateway', timestamp: new Date() });
});

systemRouter.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Layanan API GoPay Berfungsi Normal',
    timestamp: new Date()
  });
});

systemRouter.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

systemRouter.get('/api/logs', apiKeyAuth, (_req: Request, res: Response) => {
  res.json({ success: true, logs: activityLogs });
});
