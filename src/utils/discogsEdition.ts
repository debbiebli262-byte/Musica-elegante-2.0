export type DiscogsEditionCandidate = {
  id: number;
  title: string;
  year: string;
  catno: string;
  labels: string[];
  formats: string[];
};

export function discogsPhysicalFormat(value: string): 'CD' | 'Vinilo' | null {
  const text = value.trim().toLowerCase();
  if (/(^|\W)(cd|compact disc)(\W|$)/.test(text)) return 'CD';
  if (/(vinyl|vinilo|\blp\b|12"|7")/.test(text)) return 'Vinilo';
  return null;
}

export function matchingDiscogsEditions(candidates: DiscogsEditionCandidate[], label: string, format: 'CD' | 'Vinilo' | '') {
  if (!label || !format) return [];
  return candidates.filter(candidate => candidate.labels.includes(label) &&
    candidate.formats.some(item => discogsPhysicalFormat(item) === format));
}
