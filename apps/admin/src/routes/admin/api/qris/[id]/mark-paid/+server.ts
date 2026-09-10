import { json } from '@sveltejs/kit';
import { gateway, GatewayError } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.authenticated) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const id = params.id;
    const data = await gateway(`/internal/admin/qris/${encodeURIComponent(String(id))}/mark-paid`, {
      method: 'POST'
    });
    return json({ success: true, data });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({ success: false, message: error.message }, { status });
  }
};
