/** Labels of physical editions. Historical original labels are never mixed into this list. */
export const FEATURED_EDITOR_SELLOS = ['Acoustic Sounds Series', 'Acoustic Sounds'] as const;

export function editorSelloOptions(
  catalogLabels: Array<string | undefined | null>,
  discogsLabels: Array<string | undefined | null> = [],
  extraLabels: Array<string | undefined | null> = []
): string[] {
  const values = [...FEATURED_EDITOR_SELLOS, ...catalogLabels, ...discogsLabels, ...extraLabels];
  const byNormalizedName = new Map<string,string>();
  for (const value of values) {
    if (!value || typeof value !== 'string') continue;
    // Catalog label values can be comma/semicolon-separated; split stored combinations.
    for (const label of value.split(/\s*[,;]\s*/)) {
      const clean = label.normalize('NFKC').replace(/\s+/g, ' ').trim();
      const key = clean.toLocaleLowerCase();
      if (clean && !byNormalizedName.has(key)) byNormalizedName.set(key, clean);
    }
  }
  return Array.from(byNormalizedName.values()).sort((a,b) => a.localeCompare(b, 'es', {sensitivity:'base'}));
}
