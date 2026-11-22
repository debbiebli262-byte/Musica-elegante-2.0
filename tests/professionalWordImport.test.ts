import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStructuredWord,splitWordForAI} from '../src/utils/structuredWord';
import {makeReview,reviewDiscogsMatch,resolveReviewConflict,editReviewField,
  pendingReviewConflicts,normalizePhysicalFormat,splitReviewedWorks} from '../src/utils/wordImportReview';
import {sameWordEdition} from '../src/utils/wordImportAlbums';

const sample=['COMPOSER','Name: Johann Sebastian Bach','Birth Date: 21/3/1685',
'Biography: Músico alemán con una extensa biografía.','La segunda línea debe quedar íntegra.',
'RECORDING','Work Title: Nun komm, der Heiden Heiland','Opus: BWV 61',
'Album Title: BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN','Label: Archiv Galleria',
'Catalog Number: 439 369-2','Format: 4 CD (ADD)','Edition Year: 1993',
'RECORDING','Work Title: Bereitet die Wege, bereitet','Opus: BWV 132',
'Album Title: BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN','Label: Archiv Galleria',
'Catalog Number: 439 369-2','Format: 4 CD (ADD)','Edition Year: 1993',
'RECORDING','Work Title: Christen, aetzet diesen Tag','Opus: BWV 63',
'Album Title: BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN','Label: Archiv Galleria',
'Catalog Number: 439 369-2','Format: 4 CD (ADD)','Edition Year: 1993',
'RECORDING','Work Title: Christum wir sollen loben schon','Opus: BWV 121',
'Album Title: BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN','Label: Archiv Galleria',
'Catalog Number: 439 369-2','Format: 4 CD (ADD)','Edition Year: 1993',
'RECORDING','Work Title: Sehet, welch eine Liebe hat uns der Vater erzeiget','Opus: BWV 64',
'Album Title: BACH: KANTATEN VOL. 1 ADVENT UND WEIHNACHTEN','Label: Archiv Galleria',
'Catalog Number: 439 369-2','Format: 4 CD (ADD)','Edition Year: 1993'].join('\n');

test('Bach-style Word contains five works but one four-CD edition, exact biography',()=>{
  const parsed=parseStructuredWord(sample);
  assert.ok(parsed);
  assert.equal(parsed.composer.name,'Johann Sebastian Bach');
  assert.equal(parsed.composer.birthDate,'1685-03-21');
  assert.equal(parsed.composer.biography,'Músico alemán con una extensa biografía. La segunda línea debe quedar íntegra.');
  assert.equal(parsed.recordings.length,5);
  assert.equal(parsed.albums.length,1);
  assert.equal(parsed.albums[0].discCount,4);
  assert.equal(parsed.albums[0].catalogNumber,'439 369-2');
  assert.equal(parsed.sourceType,'structured-word');
});

test('unstructured Word text never loses characters when split into AI chunks',()=>{
  const content='one '.repeat(6000)+'\n'+'two '.repeat(6000);
  const sections=splitWordForAI(content,900);
  assert.ok(sections.length>2);
  assert.equal(sections.join('\n').replace(/\n/g,''),content.replace(/\n/g,''));
  assert.ok(sections.every(item=>item.length<=900));
});

test('a CD box set is comparable to CD but never to vinyl',()=>{
  assert.equal(normalizePhysicalFormat('4 CD (ADD)'),'CD');
  assert.equal(normalizePhysicalFormat('Vinyl'),'Vinilo');
  assert.equal(normalizePhysicalFormat('2 LP'),'Vinilo');
});

test('conflicting Word and Discogs labels must be explicitly resolved',()=>{
  const album=makeReview({title:'Bach',label:'Archiv Galleria',catalogNumber:'439 369-2',
    barcode:'',format:'4 CD (ADD)',editionYear:'1993',country:'Germany',discCount:4,notes:''},0);
  const compared=reviewDiscogsMatch(album,{releaseId:123,label:'Archiv Produktion',
    catno:'439 369-2',title:'Bach',year:'1993',country:'Germany'});
  assert.equal(pendingReviewConflicts([compared]).length,1);
  const solved=resolveReviewConflict(compared,'label','Word');
  assert.equal(solved.label,'Archiv Galleria');
  assert.equal(pendingReviewConflicts([solved]).length,0);
  assert.equal(editReviewField(compared,'label','Archiv Galleria').origin.label,'Manual');
});

test('works with no verified disc position remain unassigned on a multi-disc release',()=>{
  const album=makeReview({title:'Bach',label:'Archiv',catalogNumber:'439 369-2',
    barcode:'',format:'4 CD (ADD)',editionYear:'1993',country:'Germany',discCount:4,notes:''},0);
  const result=splitReviewedWorks(album,[{workTitle:'BWV 61'}, {workTitle:'BWV 132',discNumber:3}]);
  assert.equal(result.unassigned.length,1);
  assert.deepEqual(result.assigned.map(d=>d.discNumber),[3]);
});

test('recordings are not merged into an album from another label or CD/Vinyl format',()=>{
  const album=makeReview({title:'Sample',label:'Decca',catalogNumber:'123',barcode:'',
    format:'CD',editionYear:'1980',country:'',discCount:1,notes:''},0);
  assert.equal(sameWordEdition(album,{albumTitle:'Sample',catalogNumber:'123',label:'Other',format:'CD'}),false);
  assert.equal(sameWordEdition(album,{albumTitle:'Sample',catalogNumber:'123',label:'Decca',format:'Vinilo'}),false);
});
