import assert from 'node:assert/strict';
import test from 'node:test';
import { proposeVerifiedTracklists, isVerifiedTracklistStillApplicable } from '../src/utils/verifiedTracklists';
import type { Album } from '../src/types';

const edition: Album = {
  id: 'samuel_barber_marriner_lollipops_442_406_2',
  title: 'Marriner* - Lollipops',
  artistId: 'samuel_barber',
  artistName: 'Samuel Barber',
  genre: 'classical',
  catalogNumber: '442 406-2',
  label: 'Philips',
  conductor: 'Sir Neville Marriner',
  formats: ['CD'],
};

test('verified edition produces a 12-track proposal with exact catalog metadata', () => {
  const original = JSON.stringify(edition);
  const proposals = proposeVerifiedTracklists([edition]);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].disc.works.length, 12);
  assert.equal(proposals[0].disc.works[9].composer, 'Samuel Barber');
  assert.equal(isVerifiedTracklistStillApplicable(edition, proposals[0]), true);
  assert.equal(JSON.stringify(edition), original);
});

test('rejects a different edition or existing performance data', () => {
  const [proposal] = proposeVerifiedTracklists([edition]);
  assert.equal(proposeVerifiedTracklists([{ ...edition, catalogNumber: 'OTHER' }]).length, 0);
  assert.equal(isVerifiedTracklistStillApplicable({ ...edition, tracks: [{ trackNumber: 1, title: 'Existing', duration: '' }] }, proposal), false);
  assert.equal(isVerifiedTracklistStillApplicable({ ...edition, discs: [{ discNumber: 1, works: [{ title: 'Existing', movements: [] }] }] }, proposal), false);
});
