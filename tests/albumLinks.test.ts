import test from 'node:test';
import assert from 'node:assert/strict';
import { groupArtistAlbums, uniqueCollectionItems, linkedArtistIds } from '../src/utils/albumLinks';
import type { Album } from '../src/types';

const album = (id: string) => ({ id, title: id, artistId: 'a', genre: 'jazz' } as Album);

test('shared, sideman and principal views never repeat one album on an artist page', () => {
  const { primary, collaborations, otherShared } = groupArtistAlbums(
    [album('a')], [album('a'), album('b')], [album('a'), album('b'), album('c'), album('c')]
  );
  assert.deepEqual(primary.map(a => a.id), ['a']);
  assert.deepEqual(collaborations.map(a => a.id), ['b']);
  assert.deepEqual(otherShared.map(a => a.id), ['c']);
});

test('collection shows a single card for repeat rows of the same album and status', () => {
  const items = uniqueCollectionItems([
    { albumId: 'album1', status: 'owned' as const },
    { albumId: 'album1', status: 'owned' as const },
    { albumId: 'album1', status: 'wishlist' as const },
  ]);
  assert.equal(items.length, 2);
});

test('artist affiliation includes primary once and shared artists without duplicate IDs', () => {
  assert.deepEqual(linkedArtistIds('lead', ['lead', 'guest', 'guest']), ['lead', 'guest']);
});
