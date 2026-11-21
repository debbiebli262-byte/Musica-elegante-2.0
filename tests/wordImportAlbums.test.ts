import test from 'node:test';
import assert from 'node:assert/strict';
import {wordAlbumCandidates, sameWordEdition, mayReplaceBiography} from '../src/utils/wordImportAlbums';

test('extracts several cataloged editions without duplicate cards per recording', () => {
  const results = wordAlbumCandidates(
    [{title:'Album A', label:'Decca', catalogNumber:'123', format:'CD'},
     {title:'Album B', label:'RCA', barcode:'987', format:'Vinilo'}],
    [{albumTitle:'Album A', catalogNumber:'123', label:'Decca', format:'CD', workTitle:'First'},
     {albumTitle:'Album A', catalogNumber:'123', label:'Decca', format:'CD', workTitle:'Second'}]
  );
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.title), ['Album A', 'Album B']);
});

test('keeps CD and vinyl editions distinct even when the catalog number matches', () => {
  const results = wordAlbumCandidates([
    {title:'Hard Bop', label:'Columbia', catalogNumber:'CL1040', format:'CD'},
    {title:'Hard Bop', label:'Columbia', catalogNumber:'CL1040', format:'Vinilo'},
  ], []);
  assert.equal(results.length, 2);
});

test('never treats an isolated classical work as a confirmed album', () => {
  assert.deepEqual(wordAlbumCandidates([], [{workTitle:'Symphony No. 1'}]), []);
});

test('associates recording entries with matching editions', () => {
  const album = wordAlbumCandidates([{title:'The Album',catalogNumber:'A1'}], [])[0];
  assert.equal(sameWordEdition(album, {albumTitle:'The Album', catalogNumber:'A1'}), true);
  assert.equal(sameWordEdition(album, {albumTitle:'The Album', catalogNumber:'B1'}), false);
});

test('existing biography is protected until replacement is confirmed', () => {
  assert.equal(mayReplaceBiography('Existing biography', 'New biography', false), false);
  assert.equal(mayReplaceBiography('Existing biography', 'New biography', true), true);
  assert.equal(mayReplaceBiography('', 'New biography', false), true);
  assert.equal(mayReplaceBiography('Existing biography', '', true), false);
});

test('incomplete recording credits enrich a catalog match instead of making another album', () => {
  const result = wordAlbumCandidates(
    [{title:'Record A',catalogNumber:'1001',format:'CD'}],
    [{albumTitle:'Record A',catalogNumber:'1001',label:'Decca',workTitle:'Quartet'}]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].label, 'Decca');
});

test('recordings from another label or format are not attached to this release', () => {
  const album = wordAlbumCandidates([{title:'Record A', catalogNumber:'1001',label:'Decca',format:'CD'}],[])[0];
  assert.equal(sameWordEdition(album,{albumTitle:'Record A',catalogNumber:'1001',label:'RCA',format:'CD'}),false);
  assert.equal(sameWordEdition(album,{albumTitle:'Record A',catalogNumber:'1001',label:'Decca',format:'Vinilo'}),false);
});
