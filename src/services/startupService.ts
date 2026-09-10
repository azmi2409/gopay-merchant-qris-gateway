import readline from 'readline';
import * as sessionManager from './sessionManager';
import { runLoginFlow } from '../login';
import { logger } from '../utils/logger';

/**
 * Validates session availability on application startup.
 *
 * 1. If missing and running interactively in terminal (TTY), prompts the user
 *    to log in and runs the OTP flow inline.
 * 2. If present but expired (or nearing expiration), automatically refreshes
 *    the token before the server starts handling traffic.
 */
export async function ensureSessionReady(): Promise<boolean> {
  logger.info('[Startup] Checking GoPay session status...');
  let session = await sessionManager.loadSessionAsync();

  // Case 1: No session exists
  if (!session || !session.access_token) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          '\n[!] GoPay session not found. Would you like to log in with your GoBiz account now? (Y/n): ',
          resolve
        );
      });

      if (answer.trim().toLowerCase() === 'y' || answer.trim() === '') {
        const success = await runLoginFlow(rl);
        return success;
      } else {
        logger.info('[Startup] Login skipped. Server will continue running (transaction endpoints will require a session).');
        rl.close();
        return false;
      }
    } else {
      logger.warn(
        '[Startup] WARNING: GoPay session is not available in non-interactive environment. Run `pnpm login` in terminal.'
      );
      return false;
    }
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
          '[Startup] Failed to auto-refresh token. You may need to run `pnpm login` if the session has expired on GoBiz server.'
        );
        return false;
      }
    } else {
      logger.warn('[Startup] Session expired and has no refresh_token. Please run `pnpm login`.');
      return false;
    }
  }

  logger.info('[Startup] GoPay session ACTIVE and valid.');
  return true;
}
