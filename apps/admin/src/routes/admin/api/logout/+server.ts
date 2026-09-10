import { json } from '@sveltejs/kit';
import { COOKIE_NAME } from '$lib/server/adminAuth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  cookies.delete(COOKIE_NAME, { path: '/' });
  return json({ success: true });
};
