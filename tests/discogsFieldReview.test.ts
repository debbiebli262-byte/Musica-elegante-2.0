import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDiscogsEditPreview, pickDiscogsChanges } from '../src/utils/discogsEditReview';
import { makeReview, reviewDiscogsMatch, applyDiscogsReviewField, applyDiscogsReviewExtras } from '../src/utils/wordImportReview';

test('Discogs release label is never assumed to be original historical label', () => {
  const proposal=makeDiscogsEditPreview({
    releaseId: 41,title: 'Kantaten',label:'Archiv Galleria',
    originalLabel:'Wrong automatic original',catno:'439 369-2',year:'1993',format:'CD',
  });
  assert.equal(proposal.fields.label,'Archiv Galleria');
  assert.equal('originalLabel' in proposal.fields,false);
});

test('album editor can apply a corrected label without changing any other field', () => {
  const proposal=makeDiscogsEditPreview({
    releaseId:42,title:'Different album',label:'Wrong label',year:1993,format:'4 CD (ADD)',
    tracks:[{trackNumber:1,title:'Work',duration:'02:00'}]
  });
  const corrected={...proposal,fields:{...proposal.fields,label:'Sello de mi ejemplar'}};
  const chosen=pickDiscogsChanges(corrected,{label:true});
  assert.deepEqual(chosen.fields,{label:'Sello de mi ejemplar'});
  assert.equal(chosen.formats,undefined);
  assert.equal(chosen.tracks,undefined);
  assert.equal(chosen.artistNames,undefined);
});

test('Word import preserves its label, photo and tracklist until each Discogs proposal is chosen', () => {
  const initial=makeReview({
    title:'Bach Kantaten',label:'Archiv Galleria',originalLabel:'Archiv Produktion',
    catalogNumber:'439 369-2',barcode:'',format:'4 CD (ADD)',editionYear:'1993',
    country:'Germany',discCount:4,notes:''
  },0);
  const reviewed=reviewDiscogsMatch(initial,{
    releaseId:42,label:'Archiv Produktion',title:'Bach Kantaten',
    catno:'439 369-2',year:'1993',country:'Germany',
    imageUrl:'https://example.com/cover.jpg',discCount:5,
    discs:[{discNumber:1,works:[]}]
  });
  assert.equal(reviewed.label,'Archiv Galleria');
  assert.equal(reviewed.originalLabel,'Archiv Produktion');
  assert.equal(reviewed.discCount,4);
  assert.equal(reviewed.imageUrl,undefined);
  assert.equal(reviewed.discs,undefined);
  const labelOnly=applyDiscogsReviewField(reviewed,'label');
  assert.equal(labelOnly.label,'Archiv Produktion');
  assert.equal(labelOnly.originalLabel,'Archiv Produktion');
  assert.equal(labelOnly.discCount,4);
  assert.equal(labelOnly.imageUrl,undefined);
  const photoOnly=applyDiscogsReviewExtras(reviewed,'image');
  assert.equal(photoOnly.label,'Archiv Galleria');
  assert.equal(photoOnly.imageUrl,'https://example.com/cover.jpg');
});
