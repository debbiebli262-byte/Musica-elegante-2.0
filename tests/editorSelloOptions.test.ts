import test from 'node:test';
import assert from 'node:assert/strict';
import { editorSelloOptions } from '../src/utils/editorSelloOptions';

test('Acoustic Sounds Series is explicitly selectable even if missing in the catalog', () => {
  const choices=editorSelloOptions([]);
  assert.ok(choices.includes('Acoustic Sounds Series'));
  assert.ok(choices.includes('Acoustic Sounds'));
});

test('existing editor labels and Discogs labels appear in one alphabetized, deduplicated list', () => {
  const choices=editorSelloOptions(
    ['Columbia', 'Acoustic Sounds Series', 'RCA; Decca', '  columbia '],
    ['Blue Note','RCA'],['Independent Records']
  );
  assert.equal(choices.filter(item=>item.toLowerCase()==='columbia').length,1);
  assert.ok(choices.includes('Blue Note'));
  assert.ok(choices.includes('Independent Records'));
  assert.ok(choices.includes('Decca'));
  assert.ok(choices.includes('Acoustic Sounds Series'));
  assert.deepEqual(choices,[...choices].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})));
});

test('the editor label picker does not import historical original-label values implicitly',()=>{
  const choices=editorSelloOptions(['Acoustic Sounds Series'],[],[]);
  assert.equal(choices.includes('EmArcy'),false);
});
