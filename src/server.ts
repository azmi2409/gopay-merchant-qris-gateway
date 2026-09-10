import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import * as sessionManager from './services/sessionManager';
import { cleanExpiredTransactions, logActivity } from './services/paymentService';
import { ensureSessionReady } from './services/startupService';
import { logger } from './utils/logger';
import { initDatabase, closeDatabase } from './utils/db';

const PORT = process.env.PORT || 3000;

let cleanupTimer: NodeJS.Timeout | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let serverInstance: ReturnType<typeof app.listen> | null = null;

// Periodic cleanup of claimed transactions (every hour)
function startMaintenanceTimers(): void {
  cleanupTimer = setInterval(async () => {
    try {
      const cleaned = await cleanExpiredTransactions();
      if (cleaned > 0) {
        logActivity('INFO', `Cleaned ${cleaned} expired claimed transactions`);
      }
    } catch (err: any) {
      logActivity('ERROR', `Cleanup transactions error: ${err.message}`);
    }
  }, 60 * 60 * 1000);

  // Periodic auto-refresh of session (every 6 hours)
  refreshTimer = setInterval(async () => {
    try {
      const session = sessionManager.loadSession();
      if (session && session.refresh_token) {
        if (sessionManager.isExpired(session)) {
          logActivity('INFO', 'Auto Refresh: Token nearing expiration, refreshing session...');
          await sessionManager.refreshSession();
        }
      }
    } catch (err: any) {
      logActivity('ERROR', `Failed auto refresh session: ${err.message}`);
    }
  }, 6 * 60 * 60 * 1000);
}

// Graceful shutdown
function shutdown(): void {
  logActivity('SYSTEM', 'Shutting down GoPay Partner Gateway gracefully...');
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  closeDatabase();
  if (serverInstance) {
    serverInstance.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function start(): Promise<void> {
  // Initialize database schema
  await initDatabase();

  // Check session, prompt to login if missing, or refresh if expired
  await ensureSessionReady();

  startMaintenanceTimers();

  serverInstance = app.listen(PORT, () => {
    logActivity('SYSTEM', `GoPay Partner Gateway running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});
