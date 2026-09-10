import { Router, Request, Response } from 'express';
import { apiKeyAuth } from '../middlewares/auth';
import { activityLogs } from '../services/paymentService';

export const systemRouter: Router = Router();

// GET /api/v1/health
systemRouter.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({
    status: 'OK',
    service: 'GoPay Partner API Gateway',
    timestamp: new Date()
  });
});

// GET /api/v1/healthz
systemRouter.get('/api/v1/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// GET /api/v1/logs
systemRouter.get('/api/v1/logs', apiKeyAuth, (_req: Request, res: Response) => {
  res.json({ success: true, logs: activityLogs });
});

// Root ping
systemRouter.get('/', (_req: Request, res: Response) => {
  res.send('GoPay Partner API Gateway Running');
});
