import { auth } from '../firebase';

/** Every protected API route requires the signed-in member's Firebase token. */
export async function privateApiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para usar la biblioteca.');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
