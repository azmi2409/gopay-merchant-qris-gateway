import { parseSessionCookie } from '$lib/server/adminAuth';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const cookieHeader = event.request.headers.get('cookie');
  const sessionId = parseSessionCookie(cookieHeader);
  event.locals.sessionId = sessionId;
  event.locals.authenticated = Boolean(sessionId);

  const response = await resolve(event);

  // Security Headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');

  return response;
};
