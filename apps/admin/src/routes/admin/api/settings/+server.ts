import { json } from '@sveltejs/kit';
import { gateway, GatewayError } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.authenticated) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const data = await gateway('/internal/admin/settings');
    return json({ success: true, data });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 502;
    return json({ success: false, message: error.message }, { status });
  }
};

export const PUT: RequestHandler = async ({ request, locals }) => {
  if (!locals.authenticated) {
    return json({ success: false, message: 'Admin login required' }, { status: 401 });
  }
  try {
    const body = await request.json();
    await gateway('/internal/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    return json({ success: true });
  } catch (error: any) {
    const status = error instanceof GatewayError ? error.status : 400;
    return json({ success: false, message: error.message }, { status });
  }
};
