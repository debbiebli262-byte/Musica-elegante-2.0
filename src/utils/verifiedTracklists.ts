import type { Album, Disc } from '../types';

/** Exact edition identified via MusicBrainz release + barcode (not a fuzzy search).
 * https://musicbrainz.org/release/3628d894-5d39-4c11-98fc-ac64ad096aea
 * Do not alter album-level artist credits: this is a multi-composer compilation.
 */
const lollipopsTracks = [
  ['"Popular Song" from "Façade": Suite no. 2', 'William Walton', '2:35'],
  ['Aria (Cantilena) from "Bachianas brasileiras" no. 5', 'Heitor Villa-Lobos', '6:12'],
  ['Ritual Fire Dance from "El amor brujo"', 'Manuel de Falla', '3:40'],
  ['Gymnopédie no. 1', 'Erik Satie', '4:48'],
  ['On Hearing the First Cuckoo in Spring', 'Frederick Delius', '6:05'],
  ['Vocalise for Orchestra, Op. 34 no. 14', 'Sergei Rachmaninoff', '6:09'],
  ['Fantasia on Greensleeves', 'Ralph Vaughan Williams', '4:48'],
  ['Bailero from "Chants d’Auvergne"', 'Joseph Canteloube', '5:46'],
  ['Polka from "Façade": Suite no. 1', 'William Walton', '1:23'],
  ['Adagio for Strings', 'Samuel Barber', '7:30'],
  ['"Playful Pizzicato" from "Simple Symphony"', 'Benjamin Britten', '3:15'],
  ['Gymnopédie no. 3', 'Erik Satie', '3:16'],
] as const;

export type VerifiedTracklistProposal = {
  albumId: string;
  title: string;
  catalogNumber: string;
  source: string;
  disc: Disc;
};

const proposals: VerifiedTracklistProposal[] = [
  {
    albumId: 'samuel_barber_marriner_lollipops_442_406_2',
    title: 'Marriner* - Lollipops',
    catalogNumber: '442 406-2',
    source: 'https://musicbrainz.org/release/3628d894-5d39-4c11-98fc-ac64ad096aea',
    disc: {
      discNumber: 1,
      works: lollipopsTracks.map(([title, composer, duration], index) => ({
        title,
        composer,
        movements: [{ trackNumber: index + 1, title, duration }]
      }))
    }
  }
];

export function proposeVerifiedTracklists(albums: Album[]): VerifiedTracklistProposal[] {
  return proposals.filter(item => {
    const album = albums.find(a => a.id === item.albumId);
    return Boolean(album &&
      album.title.trim().toLocaleLowerCase() === item.title.toLocaleLowerCase() &&
      album.catalogNumber?.trim() === item.catalogNumber &&
      album.genre === 'classical' &&
      !(album.tracks || []).length &&
      !(album.discs || []).some(d => (d.works || []).length > 0));
  });
}

export function isVerifiedTracklistStillApplicable(
  album: Album,
  proposal: VerifiedTracklistProposal
): boolean {
  return album.id === proposal.albumId &&
    album.title.trim().toLocaleLowerCase() === proposal.title.toLocaleLowerCase() &&
    album.catalogNumber?.trim() === proposal.catalogNumber &&
    album.genre === 'classical' &&
    !(album.tracks || []).length &&
    !(album.discs || []).some(d => (d.works || []).length > 0);
}
