import { json } from '@sveltejs/kit';
import { gateway, GatewayError } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.authenticated) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const id = params.id;
    await gateway(`/internal/admin/webhooks/${encodeURIComponent(String(id))}`, {
      method: 'DELETE'
    });
    return json({ success: true });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({ success: false, message: error.message }, { status });
  }
};
