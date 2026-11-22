import type { WordAlbumCandidate, WordRecordingReference } from './wordImportAlbums.js';
import type { Disc, Work } from '../types.js';
import { discogsPhysicalFormat } from './discogsEdition.js';
export type Origin = 'Word' | 'Discogs' | 'Manual';
export type ReviewField = 'title'|'label'|'catalogNumber'|'barcode'|'format'|'editionYear'|'country';
export interface ReviewConflict { field: ReviewField; word: string; discogs: string; resolved: boolean }
export interface DiscogsReviewData {
  releaseId: number; title?: string; label?: string; catno?: string; year?: string; country?: string;
  discCount?: number; imageUrl?: string; discs?: Disc[];
}
export interface ReviewedEdition extends WordAlbumCandidate {
  originalLabel?: string;
  sourceKey: string;
  discogsReleaseId?: number;
  discogsUrl?: string;
  imageUrl?: string;
  discs?: Disc[];
  conflicts: ReviewConflict[];
  origin: Partial<Record<ReviewField, Origin>>;
  include: boolean;
}
export const editionKey = (album: WordAlbumCandidate, position: number) =>
  [album.catalogNumber || album.barcode || album.title, album.label, album.format, position].join('::').toLowerCase();
export function normalizePhysicalFormat(format: string): 'CD'|'Vinilo'|null {
  const text=String(format||'').trim();
  if (discogsPhysicalFormat(text)) return discogsPhysicalFormat(text);
  if (/(\d+\s*)?(?:CDs?)(?:\s|\(|$)/i.test(text)) return 'CD';
  if (/(\d+\s*)?(?:LPs?)(?:\s|\(|$)/i.test(text)) return 'Vinilo';
  return null;
}
const similar=(a: string,b: string)=>a.trim().replace(/[\s-]/g,'').toLowerCase()===b.trim().replace(/[\s-]/g,'').toLowerCase();
export function reviewDiscogsMatch(edition: ReviewedEdition, found: DiscogsReviewData): ReviewedEdition {
  const fields: Record<string,string> = {
    title:found.title||'', label:found.label||'', catalogNumber:found.catno||'',
    editionYear:found.year||'', country:found.country||''
  };
  const next={...edition,conflicts:[] as ReviewConflict[],origin:{...edition.origin},
    discogsReleaseId:found.releaseId,imageUrl:found.imageUrl||edition.imageUrl,
    discs:found.discs||edition.discs};
  for (const [field,value] of Object.entries(fields) as [ReviewField,string][]) {
    const current=String(next[field]||'');
    if (current && value && !similar(current,value)) {
      next.conflicts.push({field,word:current,discogs:value,resolved:false});
    } else if (!current && value) {
      (next as unknown as Record<string,unknown>)[field]=value;
      next.origin[field]='Discogs';
    }
  }
  return next;
}
export function resolveReviewConflict(edition: ReviewedEdition, field: ReviewField, prefer: 'Word'|'Discogs'): ReviewedEdition {
  const conflict=edition.conflicts.find(c=>c.field===field);
  if (!conflict) return edition;
  const next={...edition,conflicts:edition.conflicts.map(c=>c.field===field?{...c,resolved:true}:c),
    origin:{...edition.origin,[field]:prefer}};
  (next as unknown as Record<string,unknown>)[field]=prefer==='Discogs'?conflict.discogs:conflict.word;
  return next;
}
export function editReviewField(edition: ReviewedEdition,field:ReviewField,value:string): ReviewedEdition {
  return {...edition,[field]:value,origin:{...edition.origin,[field]:'Manual' as const},
    conflicts:edition.conflicts.map(c=>c.field===field?{...c,resolved:true}:c)};
}
export function makeReview(edition:WordAlbumCandidate,position:number):ReviewedEdition {
  return {...edition,sourceKey:editionKey(edition,position),conflicts:[],include:true,
    origin:Object.fromEntries((['title','label','catalogNumber','barcode','format','editionYear','country'] as ReviewField[])
      .filter(field=>Boolean(edition[field])).map(field=>[field,'Word'])) as ReviewedEdition['origin']};
}
export const pendingReviewConflicts=(editions:ReviewedEdition[])=>editions
  .filter(e=>e.include).flatMap(e=>e.conflicts.filter(c=>!c.resolved));
export function splitReviewedWorks(edition:ReviewedEdition, recordings:(WordRecordingReference & {
  workTitle?:string;workSubtitle?:string;compositionDate?:string;orchestra?:string;conductor?:string;
  soloists?:string[]; opus?:string;premiereDate?:string;notes?:string; discNumber?:number;
})[]):{assigned:Disc[];unassigned:Work[]} {
  const assigned=new Map<number,Work[]>();
  const unassigned:Work[]=[];
  for(const [index,rec] of recordings.entries()){
    const work:Work={
      title:rec.workTitle||edition.title,
      compositionDate:rec.compositionDate||'',orchestra:rec.orchestra||'',conductor:rec.conductor||'',
      soloists:(rec.soloists||[]).map(name=>({name,instrument:''})),
      movements:[{trackNumber:index+1,title:rec.workSubtitle||rec.workTitle||edition.title,duration:'',
        notes:[rec.opus,rec.premiereDate,rec.notes].filter(Boolean).join(' · ')}]
    };
    const disc=Number(rec.discNumber);
    if(!Number.isInteger(disc)||disc<=0||disc>edition.discCount){unassigned.push(work);continue;}
    if(!assigned.has(disc))assigned.set(disc,[]);
    assigned.get(disc)!.push(work);
  }
  return {assigned:[...assigned.entries()].sort(([a],[b])=>a-b).map(([discNumber,works])=>({discNumber,works})),unassigned};
}
export function fileBackupFilename(fileName:string){return 'backup-'+fileName.replace(/[^a-zA-Z0-9._-]+/g,'_')+'-'+new Date().toISOString().slice(0,10)+'.json';}
