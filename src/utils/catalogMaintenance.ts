import type { Album, Artist, CollectionItem } from '../types';
import { normalizeRecordLabels } from './recordLabels';
import { getCatalogRecordType } from './catalogRecordType';

const key = (value: unknown) => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export type CatalogIssue = {
  kind: 'possible-duplicate' | 'missing-artist' | 'missing-title' | 'missing-reference' | 'repeated-label' | 'missing-classical-content';
  albumId: string;
  title: string;
  detail: string;
};

export function inspectCatalog(albums: Album[], artists: Artist[]): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const artistIds = new Set(artists.map(artist => artist.id));
  const byEdition = new Map<string, Album[]>();
  for (const album of albums) {
    const title = album.title || '(Sin título)';
    if (!album.title?.trim()) issues.push({ kind: 'missing-title', albumId: album.id, title, detail: 'Falta el título' });
    if (!album.artistId || !artistIds.has(album.artistId)) {
      issues.push({ kind: 'missing-reference', albumId: album.id, title, detail: 'El artista asociado no existe en el catálogo' });
    }
    if (!album.artistName?.trim()) issues.push({ kind: 'missing-artist', albumId: album.id, title, detail: 'Falta el nombre del artista' });
    for (const field of ['label', 'originalLabel'] as const) {
      const value = album[field];
      if (value && normalizeRecordLabels(value) !== value) {
        issues.push({ kind: 'repeated-label', albumId: album.id, title, detail: field === 'label' ? 'Sello repetido' : 'Sello original repetido' });
      }
    }
    if (album.genre === 'classical' && getCatalogRecordType(album) === 'recording' && !(album.discs || []).some(disc =>
      (disc.works || []).some(work => (work.movements || []).length > 0)) && !(album.tracks || []).length) {
      issues.push({ kind: 'missing-classical-content', albumId: album.id, title, detail: 'No hay obras, movimientos ni pistas documentadas' });
    }

    // Separate distinct editions; only flag records with the SAME known identifiers.
    // Identical titles alone never imply that two releases are duplicates.
    const releaseKey = [
      key(album.artistId), key(album.title), key(album.catalogNumber || album.editionCatalogNumber),
      key(album.releaseYear), key(album.label), key((album.formats || []).join('|'))
    ].join('::');
    if (album.artistId && album.title?.trim() && (album.catalogNumber || album.editionCatalogNumber)) {
      const group = byEdition.get(releaseKey) || [];
      group.push(album);
      byEdition.set(releaseKey, group);
    }
  }
  for (const group of byEdition.values()) {
    if (group.length < 2) continue;
    for (const album of group) {
      issues.push({
        kind: 'possible-duplicate', albumId: album.id, title: album.title,
        detail: `Posible edición duplicada (${group.length} registros). Revisar manualmente; no eliminar automáticamente.`
      });
    }
  }
  return issues;
}

export type CatalogExport = {
  format: 'musica-elegante-backup';
  version: 1;
  exportedAt: string;
  description: string;
  artists: Artist[];
  albums: Album[];
  collection: CollectionItem[];
  import_jobs: Record<string, unknown>[];
};

export function serializeCatalogBackup(data: CatalogExport): string {
  return JSON.stringify(data, null, 2);
}
