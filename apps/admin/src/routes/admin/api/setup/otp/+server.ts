import { json } from '@sveltejs/kit';
import { gateway, GatewayError, pendingOtp } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.authenticated || !locals.sessionId) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const data = await gateway('/internal/admin/session/otp', {
      method: 'POST',
      body: JSON.stringify({ phone: body?.phone })
    });
    pendingOtp.set(locals.sessionId, {
      phone: data.phone,
      token: data.otpToken,
      deviceId: data.deviceId,
      expiresAt: Date.now() + data.expiresIn * 1000
    });
    return json({ success: true, data: { expires_in: data.expiresIn } });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({
      success: false,
      code: error.code || 'OTP_REQUEST_FAILED',
      message: error.message || 'OTP request failed'
    }, { status });
  }
};
