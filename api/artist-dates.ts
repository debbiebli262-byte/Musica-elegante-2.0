import { requireLibraryMember } from '../src/server/libraryAuth';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type DateCandidate = { birthDate?: string; deathDate?: string; source: string; pageTitle: string };
type WikiPage = {
  title?: string;
  description?: string;
  pageprops?: { wikibase_item?: string };
  missing?: boolean;
};
type Claim = {
  mainsnak?: { datavalue?: { value?: { time?: string; precision?: number; calendarmodel?: string; id?: string } } };
  rank?: string;
};
type WikidataEntity = {
  claims?: Record<string, Claim[]>;
  labels?: Record<string, { value?: string }>;
};

const normalize = (text: string) => text.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ')
  .toLowerCase().trim();

const musicTerms = /musician|composer|singer|pianist|conductor|saxophonist|trumpeter|drummer|guitarist|violinist|bassist|cellist|organist|harpsichordist|vocalist|jazz|opera|music|director de orquesta|compositor|cantante|músico|musico/i;
const disambiguation = /\s*\([^)]*\)\s*$/;
const gregorian = 'http://www.wikidata.org/entity/Q1985727'; // Gregorian calendar

function exactDay(claims: Claim[] | undefined): string | undefined {
  const sorted = [...(claims || [])].sort((a, b) => (a.rank === 'preferred' ? -1 : 0) - (b.rank === 'preferred' ? -1 : 0));
  for (const claim of sorted) {
    const value = claim.mainsnak?.datavalue?.value;
    if (!value?.time || value.precision !== 11 || value.calendarmodel !== gregorian) continue;
    const match = value.time.match(/^\+(\d{4})-(\d\d)-(\d\d)T/);
    if (!match) continue;
    const candidate = match[1] + '-' + match[2] + '-' + match[3];
    const date = new Date(candidate + 'T12:00:00Z');
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === candidate) return candidate;
  }
  return undefined;
}

async function resolveArtist(name: string): Promise<DateCandidate | null> {
  const wikipedia = new URL('https://en.wikipedia.org/w/api.php');
  wikipedia.searchParams.set('action', 'query');
  wikipedia.searchParams.set('titles', name);
  wikipedia.searchParams.set('redirects', '1');
  wikipedia.searchParams.set('prop', 'pageprops|description');
  wikipedia.searchParams.set('format', 'json');
  wikipedia.searchParams.set('formatversion', '2');
  const response = await fetch(wikipedia, {
    headers: { 'User-Agent': 'MusicaElegante/2.0 (private musician date verification)' },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error('Wikipedia service unavailable');
  const wiki = await response.json() as { query?: { pages?: WikiPage[] } };
  const pages = wiki.query?.pages || [];
  const match = pages.find(page => {
    const title = page.title || '';
    return !page.missing && normalize(title.replace(disambiguation, '')) === normalize(name)
      && musicTerms.test(page.description || '') && /^Q\d+$/.test(page.pageprops?.wikibase_item || '');
  });
  if (!match) return null;
  const id = match.pageprops!.wikibase_item!;
  const wdResponse = await fetch('https://www.wikidata.org/wiki/Special:EntityData/' + id + '.json', {
    headers: { 'User-Agent': 'MusicaElegante/2.0 (private musician date verification)' },
    signal: AbortSignal.timeout(7000)
  });
  if (!wdResponse.ok) throw new Error('Wikidata service unavailable');
  const data = await wdResponse.json() as { entities?: Record<string, WikidataEntity> };
  const entity = data.entities?.[id];
  if (!entity) return null;
  // Wikidata P31 Q5: human. Never assign dates to ensembles, orchestras or bands.
  const isHuman = (entity.claims?.P31 || []).some(c => c.mainsnak?.datavalue?.value?.id === 'Q5');
  if (!isHuman) return null;
  const birthDate = exactDay(entity.claims?.P569);
  const deathDate = exactDay(entity.claims?.P570);
  if (!birthDate && !deathDate) return null;
  return {
    ...(birthDate ? { birthDate } : {}),
    ...(deathDate ? { deathDate } : {}),
    source: 'https://www.wikidata.org/wiki/' + id,
    pageTitle: match.title || ''
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireLibraryMember(req, res))) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name || name.length > 120) return res.status(400).json({ error: 'Invalid artist name' });
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const result = await resolveArtist(name);
    return res.status(200).json(result || { source: '', pageTitle: '' });
  } catch (error) {
    console.warn('Date lookup failed:', error);
    return res.status(502).json({ error: 'Date lookup temporarily unavailable' });
  }
}
