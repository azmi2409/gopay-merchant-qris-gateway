import readline from 'readline';
import * as sessionManager from './sessionManager';
import { runLoginFlow } from '../login';

/**
 * Validates session availability on application startup.
 *
 * 1. If missing and running interactively in terminal (TTY), prompts the user
 *    to log in and runs the OTP flow inline.
 * 2. If present but expired (or nearing expiration), automatically refreshes
 *    the token before the server starts handling traffic.
 */
export async function ensureSessionReady(): Promise<boolean> {
  console.log('[Startup] Memeriksa status sesi GoPay...');
  let session = sessionManager.loadSession();

  // Case 1: No session exists
  if (!session || !session.access_token) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          '\n[!] Sesi GoPay belum ditemukan. Apakah Anda ingin login akun GoBiz sekarang? (Y/n): ',
          resolve
        );
      });

      if (answer.trim().toLowerCase() === 'y' || answer.trim() === '') {
        const success = await runLoginFlow(rl);
        return success;
      } else {
        console.log('[Startup] Login dilewati. Server akan tetap berjalan (endpoint transaksi akan membutuhkan sesi).');
        rl.close();
        return false;
      }
    } else {
      console.warn(
        '[Startup] PERINGATAN: Sesi GoPay belum tersedia di environment non-interaktif. Jalankan `pnpm login` di terminal.'
      );
      return false;
    }
  }

  // Case 2: Session exists - check for expiration
  if (sessionManager.isExpired(session)) {
    if (session.refresh_token) {
      console.log('[Startup] Sesi GoPay mendekati kedaluwarsa. Melakukan auto-refresh token...');
      const refreshed = await sessionManager.refreshSession();
      if (refreshed) {
        console.log('[Startup] Auto-refresh sesi pada startup BERHASIL! Token baru aktif.');
        return true;
      } else {
        console.warn(
          '[Startup] Gagal memperbarui token secara otomatis. Anda mungkin perlu menjalankan `pnpm login` jika sesi telah habis masa berlakunya di server GoBiz.'
        );
        return false;
      }
    } else {
      console.warn('[Startup] Sesi kedaluwarsa dan tidak memiliki refresh_token. Silakan jalankan `pnpm login`.');
      return false;
    }
  }

  console.log('[Startup] Sesi GoPay AKTIF dan valid.');
  return true;
}
