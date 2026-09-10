import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.authenticated) {
    throw error(401, 'Admin login required');
  }

  const id = params.id;
  if (!/^[a-z0-9]{8}$/.test(id)) {
    throw error(400, 'Invalid QRIS ID');
  }

  try {
    const response = await fetch(
      `${process.env.GATEWAY_INTERNAL_URL || 'http://127.0.0.1:3001'}/internal/admin/qris/${id}/image`,
      {
        headers: { 'x-admin-api-key': process.env.ADMIN_API_KEY || '' },
        signal: AbortSignal.timeout(15000)
      }
    );
    if (!response.ok) throw new Error('QR image unavailable');
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err: any) {
    throw error(502, err.message || 'QR image unavailable');
  }
};
