import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeArtistRepairs, isRepairStillApplicable } from '../src/utils/artistRepairs';
import type { Album, Artist } from '../src/types';

const artists: Artist[] = [
  { id: 'wolfgang_amadeus_mozart', name: 'Wolfgang Amadeus Mozart', genre: 'classical' },
  { id: 'lee_morgan', name: 'Lee Morgan', genre: 'jazz' },
  { id: 'bela_bartok', name: 'Béla Bartók', genre: 'classical' },
  { id: 'malcolm_arnold', name: 'Malcolm Arnold', genre: 'classical' },
];
const album = (overrides: Partial<Album>): Album => ({
  id: 'wolfgang_amadeus_mozart_don_giovanni',
  title: 'Don Giovanni',
  genre: 'classical',
  artistId: 'wolfgang_amadeus_mozart',
  ...overrides
});

test('only missing display names are proposed for already linked artists', () => {
  const item = album({ releaseYear: '1787', discs: [] });
  const repairs = proposeArtistRepairs([item], artists);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].changes, { artistName: 'Wolfgang Amadeus Mozart' });
  assert.equal(isRepairStillApplicable(item, repairs[0]), true);
  assert.deepEqual(item.discs, []);
  assert.equal(proposeArtistRepairs([{ ...item, artistName: 'Mozart' }], artists).length, 0);
});

test('only the verified historic broken release is remapped', () => {
  const item = album({
    id: 'RtY3nDFCpGHAyerhg34H', title: 'City Lights',
    catalogNumber: 'BST 81575', genre: 'jazz',
    artistId: 'edward_lee_morgan', artistName: 'Edward Lee Morgan'
  });
  const proposals = proposeArtistRepairs([item], artists);
  assert.deepEqual(proposals[0].changes, { artistId: 'lee_morgan' });
  assert.equal(isRepairStillApplicable(item, proposals[0]), true);
  assert.equal(proposeArtistRepairs([{ ...item, catalogNumber: 'OTHER' }], artists).length, 0);
  assert.equal(isRepairStillApplicable({ ...item, artistId: 'other' }, proposals[0]), false);
});

test('classical repair retains ensemble, conductor, and legitimate linked contributors', () => {
  const item = album({
    id: 'bela_bartok_philharmonia_orchestra_neeme_jarvi_suites_from_the_wooden_prince_the_miraculous_mandarin_1992_chan_9133',
    title: 'Suites From The Wooden Prince & The Miraculous Mandarin',
    catalogNumber: 'CHAN 9133', artistId: 'bela_bartok_philharmonia_orchestra_neeme_jarvi',
    artistName: 'Béla Bartók, Philharmonia Orchestra, Neeme Järvi',
    conductor: 'Neeme Järvi', orchestra: 'Philharmonia Orchestra',
    allArtistIds: ['bela_bartok_philharmonia_orchestra_neeme_jarvi', 'bela_bartok', 'philharmonia_orchestra', 'neeme_jarvi']
  });
  const repairs = proposeArtistRepairs([item], artists);
  assert.equal(repairs.length, 1);
  assert.deepEqual(repairs[0].changes, {
    artistId: 'bela_bartok',
    allArtistIds: ['bela_bartok', 'philharmonia_orchestra', 'neeme_jarvi']
  });
  assert.equal(isRepairStillApplicable({ ...item, allArtistIds: ['different'] }, repairs[0]), false);
  assert.equal(item.conductor, 'Neeme Järvi');
});
