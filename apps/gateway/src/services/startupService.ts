import * as sessionManager from './sessionManager';
import { logger } from '../utils/logger';

/**
 * Validates session availability on application startup.
 *
 * 1. If missing, leaves the server available for browser-based admin setup.
 * 2. If present but expired (or nearing expiration), automatically refreshes
 *    the token before the server starts handling traffic.
 */
export async function ensureSessionReady(): Promise<boolean> {
  logger.info('[Startup] Checking GoPay session status...');
  let session = await sessionManager.loadSessionAsync();

  // Case 1: No session exists
  if (!session || !session.access_token) {
    logger.warn('[Startup] GoPay session is unavailable. Complete setup in the admin panel.');
    return false;
  }

  // Case 2: Session exists - check for expiration
  if (sessionManager.isExpired(session)) {
    if (session.refresh_token) {
      logger.info('[Startup] GoPay session nearing expiration. Performing token auto-refresh...');
      const refreshed = await sessionManager.refreshSession();
      if (refreshed) {
        logger.info('[Startup] Startup session auto-refresh SUCCEEDED! New token active.');
        return true;
      } else {
        logger.warn(
          '[Startup] Failed to auto-refresh token. Reconnect GoBiz in the admin panel.'
        );
        return false;
      }
    } else {
      logger.warn('[Startup] Session expired and has no refresh_token. Reconnect in the admin panel.');
      return false;
    }
  }

  logger.info('[Startup] GoPay session ACTIVE and valid.');
  return true;
}
