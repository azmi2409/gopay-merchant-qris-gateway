import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  return json({
    success: true,
    data: {
      authenticated: locals.authenticated
    }
  });
};
