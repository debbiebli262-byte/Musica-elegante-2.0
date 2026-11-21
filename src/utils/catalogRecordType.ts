import type { Album } from '../types';

/** Historical work-only entries identified from the owner's 2026-11-21 export.
 * Never infer a recording from a composition date.
 * If edition evidence is added, treat it as a release unless manually classified.
 */
const confirmedWorks = new Set([
  '1k8Ww69ItKQKQ4S9F7A0', // Reger, Variations and Fugue: composition-only record
  'DC88XzKNzT3kwR6zRueN', // Mozart, The Marriage of Figaro: composition-only
  'Xpq0vUaXvVK9oWAJ7LU2', // Mozart, Requiem: composition-only
  'wolfgang_amadeus_mozart_ave_verum_corpus',
  'wolfgang_amadeus_mozart_clarinet_concerto_in_a_major',
  'wolfgang_amadeus_mozart_die_zauberflote_the_magic_flute',
  'wolfgang_amadeus_mozart_don_giovanni',
  'wolfgang_amadeus_mozart_eine_kleine_nachtmusik',
  'wolfgang_amadeus_mozart_piano_concerto_no_21',
  'wolfgang_amadeus_mozart_requiem_in_d_minor',
  'wolfgang_amadeus_mozart_symphony_no_40_in_g_minor',
  'wolfgang_amadeus_mozart_symphony_no_41_jupiter',
]);

export type CatalogRecordType = 'recording' | 'work';

export function getCatalogRecordType(album: Album): CatalogRecordType {
  if (album.recordType === 'work' || album.recordType === 'recording') return album.recordType;
  if (album.genre !== 'classical' || !confirmedWorks.has(album.id)) return 'recording';
  if (album.catalogNumber?.trim() || album.editionCatalogNumber?.trim() ||
      album.originalCatalogNumber?.trim() || album.label?.trim() ||
      (album.formats || []).length || (album.tracks || []).length ||
      (album.discs || []).some(d => (d.works || []).length)) return 'recording';
  return 'work';
}
