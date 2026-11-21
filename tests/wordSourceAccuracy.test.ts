import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSourceBiography, discCountFromDocumentFormat, resolveWordDiscCount, normalizeWrittenFullDate } from '../src/utils/wordSourceAccuracy';
import { wordAlbumCandidates } from '../src/utils/wordImportAlbums';

const sample = [
  'COMPOSER', 'Name: Example Composer', 'Birth Date: 21/3/1685',
  'Biography: Primera frase de la biografía.',
  'Segunda frase que continúa en la línea siguiente.',
  '', 'RECORDING', 'Work Title: Cantata 1', 'Album Title: Cantatas Vol. 1',
  'Catalog Number: 439 369-2', 'Label: Archiv Galleria', 'Format: 4 CD (ADD)',
].join('\n');

test('keeps source Word biography without summarizing and stops before recordings', () => {
  assert.equal(extractSourceBiography(sample),
    'Primera frase de la biografía. Segunda frase que continúa en la línea siguiente.');
});

test('reads 4 CD (ADD) as four discs even when AI defaults to one', () => {
  assert.equal(discCountFromDocumentFormat('4 CD (ADD)'), 4);
  assert.equal(resolveWordDiscCount('4 CD (ADD)', 1), 4);
  assert.equal(resolveWordDiscCount('CD', 1), 1);
  assert.equal(resolveWordDiscCount('2 LP', 1), 2);
});

test('normalizes explicit dd/mm/yyyy dates without guessing incomplete dates', () => {
  assert.equal(normalizeWrittenFullDate('21/3/1685'), '1685-03-21');
  assert.equal(normalizeWrittenFullDate('28/7/1750'), '1750-07-28');
  assert.equal(normalizeWrittenFullDate('1790'), '1790');
});

test('five recordings on a 4 CD set create one box-set album', () => {
  const recordings = [61, 132, 63, 121, 64].map(bwv => ({
    workTitle: 'BWV ' + bwv,
    albumTitle: 'BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN',
    catalogNumber: '439 369-2',
    label: 'Archiv Galleria',
    format: '4 CD (ADD)',
    editionYear: '1993'
  }));
  const albums = wordAlbumCandidates([], recordings);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].discCount, 4);
  assert.equal(albums[0].catalogNumber, '439 369-2');
});
