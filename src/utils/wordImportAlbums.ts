export interface WordAlbumCandidate {
  title: string;
  label: string;
  catalogNumber: string;
  barcode: string;
  format: string;
  editionYear: string;
  country: string;
  discCount: number;
  notes: string;
}
export interface WordRecordingReference {
  albumTitle?: string;
  workTitle?: string;
  label?: string;
  catalogNumber?: string;
  barcode?: string;
  format?: string;
  editionYear?: string;
  country?: string;
  notes?: string;
}
const norm = (v: unknown) => String(v || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const normalizedEditionKey = (item: Pick<WordAlbumCandidate, 'title' | 'catalogNumber' | 'barcode' | 'label' | 'format'>) =>
  [norm(item.catalogNumber || item.barcode || item.title), norm(item.label), norm(item.format)].join('|');
export function wordAlbumCandidates(albums: Partial<WordAlbumCandidate>[], recordings: WordRecordingReference[]): WordAlbumCandidate[] {
  const result = new Map<string, WordAlbumCandidate>();
  const add = (source: Partial<WordAlbumCandidate>) => {
    const title = String(source.title || '').trim();
    const catalogNumber = String(source.catalogNumber || '').trim();
    const barcode = String(source.barcode || '').trim();
    if (!title && !catalogNumber && !barcode) return;
    const candidate: WordAlbumCandidate = {
      title, label: String(source.label || ''), catalogNumber, barcode,
      format: String(source.format || ''), editionYear: String(source.editionYear || ''),
      country: String(source.country || ''), discCount: Number(source.discCount) || 1,
      notes: String(source.notes || ''),
    };
    const key = normalizedEditionKey(candidate);
    const previous = result.get(key);
    if (!previous) result.set(key, candidate);
    else result.set(key, Object.fromEntries(Object.entries(previous).map(([k, v]) =>
      [k, v || candidate[k as keyof WordAlbumCandidate]])) as unknown as WordAlbumCandidate);
  };
  albums.forEach(add);
  recordings.forEach(rec => {
    // A composition title alone is not proof that an album/edition exists.
    if (!rec.albumTitle && !rec.catalogNumber && !rec.barcode) return;
    add({title: rec.albumTitle || '', label: rec.label || '', catalogNumber: rec.catalogNumber || '',
      barcode: rec.barcode || '', format: rec.format || '', editionYear: rec.editionYear || '',
      country: rec.country || '', notes: rec.notes || ''});
  });
  return [...result.values()];
}
export function sameWordEdition(album: WordAlbumCandidate, rec: WordRecordingReference) {
  if (rec.catalogNumber && album.catalogNumber) return norm(rec.catalogNumber) === norm(album.catalogNumber);
  if (rec.barcode && album.barcode) return norm(rec.barcode) === norm(album.barcode);
  return Boolean(rec.albumTitle && album.title && norm(rec.albumTitle) === norm(album.title));
}
export function mayReplaceBiography(existing: string | undefined, proposed: string, confirmed: boolean) {
  return Boolean(proposed.trim()) && (!existing?.trim() || confirmed);
}
