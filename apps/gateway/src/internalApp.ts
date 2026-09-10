import express, { Express } from 'express';
import { adminRouter } from './routes/admin';

export function createInternalApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(adminRouter);
  return app;
}
