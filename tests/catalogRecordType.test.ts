import assert from 'node:assert/strict';
import test from 'node:test';
import { getCatalogRecordType } from '../src/utils/catalogRecordType';
import { inspectCatalog } from '../src/utils/catalogMaintenance';
import type { Album, Artist } from '../src/types';

const mozart: Artist = { id: 'wolfgang_amadeus_mozart', name: 'Wolfgang Amadeus Mozart', genre: 'classical' };
const composition: Album = {
  id: 'wolfgang_amadeus_mozart_don_giovanni', artistId: mozart.id,
  artistName: mozart.name, title: 'Don Giovanni', genre: 'classical', releaseYear: '1787'
};

test('verified old work entries are not mistakenly treated as albums missing tracks', () => {
  assert.equal(getCatalogRecordType(composition), 'work');
  assert.equal(inspectCatalog([composition], [mozart]).length, 0);
});

test('explicit record type overrides the legacy classification, without changing data', () => {
  assert.equal(getCatalogRecordType({ ...composition, recordType: 'recording' }), 'recording');
  assert.equal(getCatalogRecordType({ ...composition, recordType: 'work', catalogNumber: 'ABC' }), 'work');
  assert.equal(inspectCatalog([{ ...composition, recordType: 'recording' }], [mozart]).filter(i => i.kind === 'missing-classical-content').length, 1);
});

test('an album edition with a catalog number is a recording, even if it shares a work title', () => {
  const release = { ...composition, catalogNumber: 'EMI 1000' };
  assert.equal(getCatalogRecordType(release), 'recording');
  assert.equal(inspectCatalog([release], [mozart]).filter(i => i.kind === 'missing-classical-content').length, 1);
});

test('unreviewed classical titles do not silently become works', () => {
  const album = { ...composition, id: 'other-entry', title: 'Requiem' };
  assert.equal(getCatalogRecordType(album), 'recording');
  assert.equal(inspectCatalog([album], [mozart]).filter(i => i.kind === 'missing-classical-content').length, 1);
});
