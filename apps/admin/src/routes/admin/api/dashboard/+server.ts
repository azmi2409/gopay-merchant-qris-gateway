import { json } from '@sveltejs/kit';
import { gateway, GatewayError } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.authenticated) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const days = Number(url.searchParams.get('days')) || 30;
    const data = await gateway(`/internal/admin/dashboard?days=${days}`);
    return json({ success: true, data });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({ success: false, message: error.message }, { status });
  }
};
