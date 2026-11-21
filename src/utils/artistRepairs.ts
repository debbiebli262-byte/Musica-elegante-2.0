import type { Album, Artist } from '../types';

/** Only propose narrow metadata repairs. Never infer performances or delete albums. */
export type ArtistRepair = {
  albumId: string;
  title: string;
  kind: 'fill-artist-name' | 'restore-artist-link';
  expectedArtistId: string;
  expectedArtistName: string;
  changes: { artistName?: string; artistId?: string; allArtistIds?: string[] };
  explanation: string;
};

const specificLinks = [
  {
    albumId: 'RtY3nDFCpGHAyerhg34H',
    title: 'City Lights',
    catalogNumber: 'BST 81575',
    oldId: 'edward_lee_morgan',
    newId: 'lee_morgan',
    expectedName: 'Lee Morgan',
  },
  {
    albumId: 'bela_bartok_philharmonia_orchestra_neeme_jarvi_suites_from_the_wooden_prince_the_miraculous_mandarin_1992_chan_9133',
    title: 'Suites From The Wooden Prince & The Miraculous Mandarin',
    catalogNumber: 'CHAN 9133',
    oldId: 'bela_bartok_philharmonia_orchestra_neeme_jarvi',
    newId: 'bela_bartok',
    expectedName: 'Béla Bartók',
  },
  {
    albumId: 'malcolm_arnold_bryden_thomson_philharmonia_orchestra_dances_scottish_irish_cornish_english_sarabande_polka_from_solitaire_1990_chan_8867',
    title: 'Arnold Dances',
    catalogNumber: 'CHAN 8867',
    oldId: 'malcolm_arnold_bryden_thomson_philharmonia_orchestra',
    newId: 'malcolm_arnold',
    expectedName: 'Malcolm Arnold',
  },
] as const;

export function proposeArtistRepairs(albums: Album[], artists: Artist[]): ArtistRepair[] {
  const byId = new Map(artists.map(artist => [artist.id, artist]));
  const proposals: ArtistRepair[] = [];
  for (const album of albums) {
    const linked = byId.get(album.artistId);
    if (linked && !album.artistName?.trim() && linked.name?.trim()) {
      proposals.push({
        albumId: album.id,
        title: album.title,
        kind: 'fill-artist-name',
        expectedArtistId: album.artistId,
        expectedArtistName: album.artistName || '',
        changes: { artistName: linked.name },
        explanation: 'Completar el nombre usando el artista ya vinculado, sin cambiar otras columnas.',
      });
      continue;
    }
    if (linked) continue;
    const match = specificLinks.find(item =>
      item.albumId === album.id &&
      item.oldId === album.artistId &&
      item.title.toLowerCase() === album.title.trim().toLowerCase() &&
      item.catalogNumber === album.catalogNumber
    );
    if (!match || byId.get(match.newId)?.name !== match.expectedName) continue;

    const changes: ArtistRepair['changes'] = { artistId: match.newId };
    // Keep all valid performer references, remove only the obsolete composite identity.
    if (Array.isArray(album.allArtistIds) && album.allArtistIds.includes(match.oldId)) {
      changes.allArtistIds = Array.from(new Set([
        match.newId,
        ...album.allArtistIds.filter(id => id !== match.oldId),
      ]));
    }
    proposals.push({
      albumId: album.id,
      title: album.title,
      kind: 'restore-artist-link',
      expectedArtistId: album.artistId,
      expectedArtistName: album.artistName || '',
      changes,
      explanation: 'Corregir la referencia al artista existente, conservando el nombre mostrado, el director, la orquesta y los datos de edición.',
    });
  }
  return proposals;
}

/** Guard against stale previews or overwritten edits before writing Firestore. */
export function isRepairStillApplicable(album: Album, repair: ArtistRepair): boolean {
  if (album.id !== repair.albumId ||
      album.artistId !== repair.expectedArtistId ||
      (album.artistName || '') !== repair.expectedArtistName) return false;
  if (repair.kind === 'fill-artist-name') {
    return !album.artistName?.trim() && Boolean(repair.changes.artistName?.trim());
  }
  if (!repair.changes.artistId || repair.changes.artistId === album.artistId) return false;
  if (repair.changes.allArtistIds) {
    const expected = Array.from(new Set([
      repair.changes.artistId,
      ...(album.allArtistIds || []).filter(id => id !== repair.expectedArtistId),
    ]));
    if (JSON.stringify(expected) !== JSON.stringify(repair.changes.allArtistIds)) return false;
  }
  return true;
}
