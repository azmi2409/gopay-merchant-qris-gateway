import { redirect } from '@sveltejs/kit';
import { gateway } from '$lib/server/adminAuth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authenticated) {
    return {
      authenticated: false,
      dashboard: null
    };
  }

  try {
    const dashboard = await gateway('/internal/admin/dashboard?days=30');
    return {
      authenticated: true,
      dashboard
    };
  } catch (err: any) {
    return {
      authenticated: true,
      dashboard: null,
      error: err.message
    };
  }
};
