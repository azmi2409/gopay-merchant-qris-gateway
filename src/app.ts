import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import { systemRouter } from './routes/system';
import { qrisRouter } from './routes/qris';
import { transactionRouter } from './routes/transactions';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Mount routes
  app.use(systemRouter);
  app.use(qrisRouter);
  app.use(transactionRouter);

  return app;
}

export const app = createApp();
