import type { Album, CollectionItem } from '../types';

/** Each Firestore album document is one catalog entry; affiliations are references, not copies. */
export function uniqueAlbumsById<T extends { id: string }>(albums: T[]): T[] {
  return Array.from(new Map(albums.map(album => [album.id, album])).values());
}

/** An album appears in only one group on a given artist's profile. */
export function groupArtistAlbums(main: Album[], sideman: Album[], shared: Album[]) {
  const primary = uniqueAlbumsById(main);
  const seen = new Set(primary.map(album => album.id));
  const collaborations = uniqueAlbumsById(sideman).filter(album => {
    if (seen.has(album.id)) return false;
    seen.add(album.id);
    return true;
  });
  const otherShared = uniqueAlbumsById(shared).filter(album => {
    if (seen.has(album.id)) return false;
    seen.add(album.id);
    return true;
  });
  return { primary, collaborations, otherShared };
}

/** Collapse repeated membership rows for the same album and collection status. */
export function uniqueCollectionItems<T extends { albumId: string; status: CollectionItem['status'] }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.status + ':' + item.albumId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Primary artist remains attached; other artist references are unique. */
export function linkedArtistIds(primaryId: string, otherIds: string[]): string[] {
  return Array.from(new Set([primaryId, ...otherIds].filter(Boolean)));
}
