import type { APIRoute } from 'astro';
import { COOKIE_NAME, destroySession } from '../../lib/auth';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get(COOKIE_NAME)?.value;
  if (token) {
    destroySession(token);
  }
  cookies.delete(COOKIE_NAME, { path: '/' });
  return redirect('/');
};
