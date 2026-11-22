import { extractSourceBiography, normalizeWrittenFullDate } from './wordSourceAccuracy.js';
import { wordAlbumCandidates } from './wordImportAlbums.js';
const FIELDS:Record<string,string>={
  'Name':'name','Birth Date':'birthDate','Birth Place':'birthPlace','Death Date':'deathDate',
  'Death Place':'deathPlace','Nationality':'nationality','Biography':'biography',
  'Section':'section','Work Title':'workTitle','Work Subtitle':'workSubtitle',
  'Opus':'opus','Composition Date':'compositionDate','Premiere Date':'premiereDate',
  'Soloists':'soloists','Performers':'performers','Orchestra':'orchestra','Conductor':'conductor',
  'Choir':'choir','Recording Date':'recordingDate','Recording Location':'recordingLocation',
  'Album Title':'albumTitle','Album Subtitle':'albumSubtitle','Label':'label',
  'Catalog Number':'catalogNumber','Barcode':'barcode','Format':'format',
  'Edition Year':'editionYear','Country':'country','Notes':'notes','Disc Number':'discNumber'
};
const LIST_FIELDS=new Set(['soloists','performers']);
export interface StructuredWordResult {
  composer:Record<string,unknown>;
  albums:Array<Record<string,unknown>>;
  recordings:Array<Record<string,unknown>>;
  warnings:string[];
  sourceType:'structured-word';
  sourceFileName?:string;
}
/** Parses the explicit COMPOSER / RECORDING format before trying AI.
 * A continuation line is attached to the preceding field, even across DOCX page breaks. */
export function parseStructuredWord(text:string):StructuredWordResult|null {
  const lines=text.replace(/\r/g,'').split('\n');
  let section:'composer'|'recording'|''='';
  let current:Record<string,unknown>={};
  let lastField='';
  const composer:Record<string,unknown>={};
  const recordings:Array<Record<string,unknown>>=[];
  const flush=()=>{
    if(section==='recording' && (current.workTitle || current.albumTitle || current.catalogNumber)) recordings.push({...current});
    if(section==='composer') Object.assign(composer,current);
    current={};lastField='';
  };
  for(const raw of lines){
    const line=raw.trim();
    if(/^COMPOSER$/i.test(line)){flush();section='composer';continue;}
    if(/^RECORDING$/i.test(line)){flush();section='recording';continue;}
    if(!line){continue;}
    if(!section)continue;
    const match=line.match(/^([^:]{1,36}):\s*(.*)$/);
    const key=match&&FIELDS[match[1].trim()];
    if(key){
      const value=(match![2]||'').trim();
      current[key]=value;
      lastField=key;
    }else if(lastField && typeof current[lastField]==='string'){
      current[lastField]=String(current[lastField])+' '+line;
    }
  }
  flush();
  if(!composer.name || !recordings.length) return null;
  for(const rec of recordings){
    for(const field of LIST_FIELDS)rec[field]=String(rec[field]||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(rec.discNumber)rec.discNumber=Number(rec.discNumber)||undefined;
  }
  if(composer.birthDate) composer.birthDate=normalizeWrittenFullDate(String(composer.birthDate));
  if(composer.deathDate) composer.deathDate=normalizeWrittenFullDate(String(composer.deathDate));
  composer.biography=extractSourceBiography(text)||composer.biography||'';
  const albums=wordAlbumCandidates([],recordings as any);
  return {composer,recordings,albums,warnings:[],sourceType:'structured-word'};
}

/** Only split on safe line boundaries. Oversized blocks are split, never discarded. */
export function splitWordForAI(text:string,maxChars=11000):string[]{
  const chunks:string[]=[];let buffer='';
  for(const line of text.split('\n')){
    const pieces=line.length>maxChars?line.match(new RegExp('.{1,'+maxChars+'}','gs'))||[]:[line];
    for(const piece of pieces){
      if(buffer && buffer.length+piece.length+1>maxChars){chunks.push(buffer);buffer='';}
      buffer+=(buffer?'\n':'')+piece;
    }
  }
  if(buffer)chunks.push(buffer);
  return chunks;
}
