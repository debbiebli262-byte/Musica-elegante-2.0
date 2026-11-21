import { requireLibraryMember } from '../src/server/libraryAuth';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type WikiPage = {
  title?: string;
  description?: string;
  thumbnail?: { source?: string };
  missing?: boolean;
};
const normalize = (value: string) => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').toLowerCase().trim();

const musicalTerms = /musician|composer|pianist|violinist|conductor|singer|jazz|vocalist|trumpeter|saxophonist|cellist|guitarist|drummer|bassist|organist|music|cantante|compositor|pianista|violinista|director de orquesta|músico|musico|contralto|soprano|tenor|baritone|harpsichord/i;
const qualifiers = /\((?:musician|composer|pianist|singer|conductor|jazz|violinist|trumpeter|saxophonist|artist|music)\)/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireLibraryMember(req, res))) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name || name.length > 160) return res.status(400).json({ error: 'Invalid artist name' });

  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', name);
    url.searchParams.set('gsrlimit', '8');
    url.searchParams.set('prop', 'pageimages|description');
    url.searchParams.set('piprop', 'thumbnail');
    url.searchParams.set('pithumbsize', '700');
    url.searchParams.set('format', 'json');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MusicaElegante/2.0 (artist portrait lookup)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Wikipedia lookup unavailable');
    const data = await response.json() as { query?: { pages?: Record<string, WikiPage> } };
    const pages = Object.values(data.query?.pages || {});
    const requested = normalize(name);
    const selected = pages.find(page => {
      const title = page.title?.trim() || '';
      const stripped = title.replace(/\s*\([^)]*\)\s*$/, '');
      const exactName = normalize(stripped) === requested;
      const qualified = title === stripped || qualifiers.test(title);
      const relevant = musicalTerms.test(page.description || '');
      const picture = page.thumbnail?.source || '';
      return !page.missing && exactName && qualified && relevant &&
        picture.startsWith('https://upload.wikimedia.org/');
    });
    if (!selected) return res.status(200).json({ imageUrl: '', source: '' });
    return res.status(200).json({
      imageUrl: selected.thumbnail!.source,
      source: 'Wikipedia / Wikimedia Commons',
      pageTitle: selected.title,
    });
  } catch (error) {
    console.warn('Artist image lookup failed:', error);
    return res.status(502).json({ error: 'Image lookup temporarily unavailable' });
  }
}
