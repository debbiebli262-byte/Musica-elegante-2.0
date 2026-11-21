import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlbumSave, artistNameUpdate } from '../src/utils/albumSaveValidation';

test('existing albums without an artistName can save unrelated edits', () => {
  assert.equal(validateAlbumSave('Existing catalog title', '', true), null);
  assert.deepEqual(artistNameUpdate('', true), {});
});

test('new albums still require artist name and title', () => {
  assert.match(validateAlbumSave('Album title', '', false) || '', /artista/);
  assert.match(validateAlbumSave('   ', 'Artist', true) || '', /título/);
  assert.equal(validateAlbumSave('Album title', 'Artist', false), null);
});

test('edited artist credits are saved, preserving intentional changes', () => {
  assert.deepEqual(artistNameUpdate('  Miles Davis  ', true), { artistName: 'Miles Davis' });
});
