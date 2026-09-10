import dotenv from 'dotenv';
dotenv.config();

import { app } from './app';
import * as sessionManager from './services/sessionManager';
import { cleanExpiredTransactions, logActivity } from './services/paymentService';

const PORT = process.env.PORT || 3000;

// Periodic cleanup of claimed transactions (every hour)
const cleanupTimer = setInterval(() => {
  const cleaned = cleanExpiredTransactions();
  if (cleaned > 0) {
    logActivity('INFO', `Cleaned ${cleaned} expired claimed transactions`);
  }
}, 60 * 60 * 1000);

// Periodic auto-refresh of session (every 6 hours)
async function autoRefreshSessionPeriodically(): Promise<void> {
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
}

const refreshTimer = setInterval(autoRefreshSessionPeriodically, 6 * 60 * 60 * 1000);

const server = app.listen(PORT, () => {
  logActivity('SYSTEM', `GoPay Partner Gateway running on port ${PORT}`);
});

// Graceful shutdown
function shutdown(): void {
  logActivity('SYSTEM', 'Shutting down GoPay Partner Gateway gracefully...');
  clearInterval(cleanupTimer);
  clearInterval(refreshTimer);
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
