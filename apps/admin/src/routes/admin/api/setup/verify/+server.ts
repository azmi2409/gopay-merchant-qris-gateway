import { json } from '@sveltejs/kit';
import { gateway, GatewayError, pendingOtp } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authenticated || !locals.sessionId) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }

  const pending = pendingOtp.get(locals.sessionId);
  if (!pending || pending.expiresAt < Date.now()) {
    return json({ success: false, message: 'Request a new OTP first' }, { status: 400 });
  }

  try {
    const body = await request.json();
    await gateway('/internal/admin/session/verify', {
      method: 'POST',
      body: JSON.stringify({
        phone: pending.phone,
        otp_token: pending.token,
        device_id: pending.deviceId,
        otp: body?.otp
      })
    });
    pendingOtp.delete(locals.sessionId);
    return json({ success: true });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({
      success: false,
      code: error.code || 'OTP_VERIFICATION_FAILED',
      message: error.message || 'OTP verification failed'
    }, { status });
  }
};
