import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createVerify } from 'node:crypto';

const FIREBASE_PROJECT_ID = 'archivo-musical-8e416';
const ALLOWED = new Set(['debbiebli262@gmail.com', 'javierblinder@yahoo.com.ar']);
const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedCerts: Record<string, string> = {};
let certExpiresAt = 0;

function parseJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function publicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certExpiresAt && Object.keys(cachedCerts).length) return cachedCerts;
  const response = await fetch(CERT_URL, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Firebase public key service unavailable');
  const certs = await response.json() as Record<string, string>;
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  cachedCerts = certs;
  certExpiresAt = Date.now() + Math.max(60, maxAge - 60) * 1000;
  return certs;
}

export async function requireLibraryMember(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  try {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return false;
    }
    const token = authorization.slice(7).trim();
    const pieces = token.split('.');
    if (pieces.length !== 3) throw new Error('Invalid token');
    const header = parseJwtPart(pieces[0]);
    const claims = parseJwtPart(pieces[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid algorithm');
    const cert = (await publicCerts())[header.kid];
    if (!cert) throw new Error('Unknown key');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(pieces[0] + '.' + pieces[1]);
    verifier.end();
    if (!verifier.verify(cert, Buffer.from(pieces[2], 'base64url'))) throw new Error('Invalid signature');

    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== FIREBASE_PROJECT_ID ||
        claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID ||
        typeof claims.sub !== 'string' || !claims.sub ||
        typeof claims.exp !== 'number' || claims.exp <= now ||
        typeof claims.iat !== 'number' || claims.iat > now ||
        typeof claims.auth_time !== 'number' || claims.auth_time > now ||
        claims.email_verified !== true ||
        typeof claims.email !== 'string' ||
        !ALLOWED.has(claims.email.trim().toLowerCase())) {
      throw new Error('Not an authorized member');
    }
    return true;
  } catch (error) {
    console.warn('Library API access denied:', error instanceof Error ? error.message : 'unknown');
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
}
