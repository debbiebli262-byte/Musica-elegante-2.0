import test from 'node:test';
import assert from 'node:assert/strict';
import { discogsPhysicalFormat, matchingDiscogsEditions } from '../src/utils/discogsEdition';

const editions = [
  { id: 101, title: 'Hard Bop', year: '1957', catno: 'CL 1040', labels: ['Columbia'], formats: ['Vinyl', 'LP'] },
  { id: 102, title: 'Hard Bop', year: '1990', catno: 'CL 1040', labels: ['Columbia'], formats: ['CD'] },
  { id: 103, title: 'Hard Bop', year: '2005', catno: 'CL 1040', labels: ['Legacy'], formats: ['CD'] },
];

test('discogs edition matching keeps separate vinyl and CD releases', () => {
  assert.deepEqual(matchingDiscogsEditions(editions, 'Columbia', 'Vinilo').map(item => item.id), [101]);
  assert.deepEqual(matchingDiscogsEditions(editions, 'Columbia', 'CD').map(item => item.id), [102]);
  assert.deepEqual(matchingDiscogsEditions(editions, 'Legacy', 'CD').map(item => item.id), [103]);
  assert.deepEqual(matchingDiscogsEditions(editions, '', 'CD'), []);
});

test('Discogs format recognizer does not treat every format as a CD', () => {
  assert.equal(discogsPhysicalFormat('CD'), 'CD');
  assert.equal(discogsPhysicalFormat('Compact Disc'), 'CD');
  assert.equal(discogsPhysicalFormat('Vinyl'), 'Vinilo');
  assert.equal(discogsPhysicalFormat('LP'), 'Vinilo');
  assert.equal(discogsPhysicalFormat('Cassette'), null);
});
