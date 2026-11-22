import type { Disc, Track } from '../types.js';
import type { DiscogsEditionCandidate } from './discogsEdition.js';

export const DISCOGS_EDIT_FIELDS = [
  {key:'title', label:'Título'},
  {key:'releaseYear',label:'Año de edición'},
  {key:'country',label:'País'},
  {key:'label',label:'Sello editor de tu ejemplar'},
  {key:'catalogNumber',label:'Número de catálogo de tu ejemplar'},
  {key:'editionDate',label:'Fecha de esta edición'},
  {key:'editionCatalogNumber',label:'Nº de catálogo de esta edición'},
  {key:'releaseDate',label:'Fecha de publicación'},
  {key:'imageUrl',label:'Portada'},
  {key:'orchestra',label:'Orquesta'},
  {key:'conductor',label:'Director'},
  {key:'producer',label:'Productor'},
  {key:'engineer',label:'Ingeniero'},
  {key:'masteringEngineer',label:'Ingeniero de mastering'},
] as const;
export type DiscogsEditKey = typeof DISCOGS_EDIT_FIELDS[number]['key'];
export type DiscogsEditableFields = Record<DiscogsEditKey,string>;
export type DiscogsEditPreview = {
  releaseId:number;
  candidates:DiscogsEditionCandidate[];
  fields:DiscogsEditableFields;
  discCount:number;
  formats:Array<'CD'|'Vinilo'|'DVD'|'Bluray'>;
  tracks:Track[];
  discs:Disc[];
  artistNames:string[];
  discogsUrl:string;
};
const text = (value:unknown)=>String(value??'').trim();
/** Discogs release metadata is about a selected edition, NOT the historic first label. */
export function makeDiscogsEditPreview(
  data:Record<string,any>,
  candidates:DiscogsEditionCandidate[]=[]
):DiscogsEditPreview {
  const labelNames=Array.isArray(data.label)?data.label.map(text):text(data.label).split(',').map(text);
  const formats=Array.isArray(data.format)?data.format:text(data.format).split(',');
  const physical=Array.from(new Set(formats.map(item=>{
    const value=text(item).toLowerCase();
    if(/(?:^|\W)(?:vinyl|vinilo|lp)(?:\W|$)/.test(value))return 'Vinilo';
    if(/(?:^|\W)cd(?:\W|$)/.test(value))return 'CD';
    if(value.includes('dvd'))return 'DVD';
    if(value.includes('bluray')||value.includes('blu-ray'))return 'Bluray';
    return null;
  }).filter(Boolean))) as DiscogsEditPreview['formats'];
  const currentLabel=labelNames.filter(Boolean)[0]||'';
  return {
    releaseId:Number(data.releaseId)||0,candidates,
    fields:{
      title:text(data.title),releaseYear:text(data.year),country:text(data.country),
      label:currentLabel,catalogNumber:text(data.catno),
      editionDate:text(data.year),editionCatalogNumber:text(data.catno),
      releaseDate:text(data.releaseDate),imageUrl:text(data.coverImage||data.thumb),
      orchestra:text(data.orchestra),conductor:text(data.conductor),
      producer:text(data.producer),engineer:text(data.engineer),
      masteringEngineer:text(data.masteringEngineer)
    },discCount:Number(data.discCount)>0?Number(data.discCount):1,formats:physical,
    tracks:Array.isArray(data.tracks)?data.tracks:[],
    discs:Array.isArray(data.discs)?data.discs:[],
    artistNames:Array.isArray(data.allArtistNames)?data.allArtistNames.map(text).filter(Boolean):[],
    discogsUrl:text(data.discogsUrl)
  };
}
export function pickDiscogsChanges(
  preview:DiscogsEditPreview,
  choices:Partial<Record<DiscogsEditKey|'formats'|'discCount'|'tracklist'|'artists',boolean>>
) {
  const fields=Object.fromEntries(
    DISCOGS_EDIT_FIELDS.filter(field=>choices[field.key])
      .map(field=>[field.key,preview.fields[field.key]])
  ) as Partial<DiscogsEditableFields>;
  return {
    fields,
    formats:choices.formats?preview.formats:undefined,
    discCount:choices.discCount?preview.discCount:undefined,
    tracks:choices.tracklist?preview.tracks:undefined,
    discs:choices.tracklist?preview.discs:undefined,
    artistNames:choices.artists?preview.artistNames:undefined,
  };
}
