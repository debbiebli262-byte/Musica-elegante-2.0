/** Keep distinct record labels in their original order, removing repeated names. */
export function normalizeRecordLabels(value: unknown): string {
  if (typeof value !== 'string') return '';
  const names = value.split(/\s*[,;]\s*/).map(name => name.trim()).filter(Boolean);
  const seen = new Set<string>();
  return names.filter(name => {
    const key = name.normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}
