import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { systemRouter } from './routes/system';
import { qrisRouter } from './routes/qris';
import { transactionRouter } from './routes/transactions';
import { webhookRouter } from './routes/webhooks';
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // HTTP request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const msg = `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${duration}ms`;
      if (res.statusCode >= 500) {
        logger.error(`[HTTP] ${msg}`);
      } else if (res.statusCode >= 400) {
        logger.warn(`[HTTP] ${msg}`);
      } else {
        logger.info(`[HTTP] ${msg}`);
      }
    });
    next();
  });

  app.use(express.static(path.join(process.cwd(), 'public')));

  // Mount REST v1 routes
  app.use(systemRouter);
  app.use(qrisRouter);
  app.use(transactionRouter);
  app.use(webhookRouter);

  return app;
}

export const app = createApp();
