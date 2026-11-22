import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualEdition, manualEditionIdentity } from '../src/utils/manualDiscogsEdition';

const example={
  title:'Study In Brown',artist:'Clifford Brown And Max Roach',
  label:'Acoustic Sounds Series',format:'Vinilo' as const,
  catalogNumber:'B0032412-01',barcode:'602508399482',
  year:'2021',country:'US',originalLabel:'EmArcy',discCount:1
};

test('unlisted owned vinyl may be created even when the Discogs results only list another edition',()=>{
  const edition=buildManualEdition(example);
  assert.equal(edition.label,'Acoustic Sounds Series');
  assert.equal(edition.originalLabel,'EmArcy');
  assert.deepEqual(edition.formats,['Vinilo']);
  assert.equal(edition.importSource.method,'manual-edition');
  assert.equal('discogsReleaseId' in edition,false);
});

test('original label stays blank when it is unknown',()=>{
  const edition=buildManualEdition({...example,originalLabel:''});
  assert.equal(edition.originalLabel,'');
  assert.equal(edition.label,'Acoustic Sounds Series');
});

test('manual CD and vinyl editions do not collide',()=>{
  const vinyl=buildManualEdition(example);
  const cd=buildManualEdition({...example,format:'CD' as const});
  assert.notEqual(manualEditionIdentity(vinyl),manualEditionIdentity(cd));
});

test('a manual edition requires title, artist, physical label and format',()=>{
  assert.throws(()=>buildManualEdition({...example,label:'   '}),/Completa/);
  assert.throws(()=>buildManualEdition({...example,format:''}),/Completa/);
  assert.throws(()=>buildManualEdition({...example,title:''}),/Completa/);
});

test('manual metadata is trimmed and disc count is bounded',()=>{
  const edition=buildManualEdition({...example,label:' Acoustic Sounds Series ',discCount:1000});
  assert.equal(edition.label,'Acoustic Sounds Series');
  assert.equal(edition.discCount,100);
});
