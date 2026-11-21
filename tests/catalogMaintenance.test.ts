import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCatalog, serializeCatalogBackup } from '../src/utils/catalogMaintenance';
import { normalizeRecordLabels } from '../src/utils/recordLabels';
import type { Artist, Album } from '../src/types';

const artist: Artist = { id: 'a1', name: 'Art Blakey', genre: 'jazz' };
const base: Album = {
  id: 'one', title: "Moanin'", artistId: 'a1', artistName: 'Art Blakey',
  genre: 'jazz', catalogNumber: 'BLP 4003', releaseYear: '1959', label: 'Blue Note', formats: ['Vinilo'],
};

test('deduplicates a repeated label without removing different labels', () => {
  assert.equal(normalizeRecordLabels('Blue Note, UMe, Blue Note, UMe, blue note'), 'Blue Note, UMe');
});

test('identifies identical edition metadata as needing manual review, without deleting or altering it', () => {
  const albumOne = structuredClone(base);
  const albumTwo = { ...structuredClone(base), id: 'two' };
  const original = JSON.stringify([albumOne, albumTwo]);
  const issues = inspectCatalog([albumOne, albumTwo], [artist]);
  assert.equal(issues.filter(issue => issue.kind === 'possible-duplicate').length, 2);
  assert.equal(JSON.stringify([albumOne, albumTwo]), original);
});

test('different catalog numbers, formats and years are distinct editions', () => {
  const albums: Album[] = [
    base,
    { ...base, id: 'two', catalogNumber: 'BLP 4004' },
    { ...base, id: 'three', releaseYear: '1960' },
    { ...base, id: 'four', formats: ['CD'] },
  ];
  assert.equal(inspectCatalog(albums, [artist]).filter(issue => issue.kind === 'possible-duplicate').length, 0);
});

test('checks classical works without confusing documented movements with missing content', () => {
  const empty: Album = { ...base, id: 'classical1', title: 'Sonata', genre: 'classical', catalogNumber: '123', discs: [] };
  const complete: Album = { ...empty, id: 'classical2', discs: [{ discNumber: 1, works: [
    { title: 'Sonata No. 1', movements: [{ trackNumber: 1, title: 'Allegro', duration: '4:00' }] }
  ] }] };
  assert.equal(inspectCatalog([empty, complete], [artist]).filter(i => i.kind === 'missing-classical-content').length, 1);
});

test('exports versioned JSON with catalog content intact', () => {
  const payload = {
    format: 'musica-elegante-backup' as const, version: 1 as const,
    exportedAt: '2026-11-21T00:00:00.000Z', description: 'Test',
    artists: [artist], albums: [base], collection: [], import_jobs: []
  };
  assert.deepEqual(JSON.parse(serializeCatalogBackup(payload)), payload);
});
