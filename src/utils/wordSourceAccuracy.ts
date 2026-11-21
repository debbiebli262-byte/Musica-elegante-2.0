/** Preserve wording from source documents rather than a rephrased AI biography. */
export function extractSourceBiography(rawText: string): string {
  const match = rawText.match(/(?:^|\n)\s*Biography\s*:\s*([\s\S]*?)(?=\n\s*(?:RECORDING|COMPOSER|ALBUM)\s*(?:\n|$)|$)/i);
  if (!match) return '';
  return match[1]
    .trim()
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** A format such as "4 CD (ADD)" describes four physical discs. */
export function discCountFromDocumentFormat(format: string): number | null {
  const match = String(format || '').trim().match(/^(\d+)\s*(?:x\s*)?(?:CDs?\b|compact discs?\b|vinyl\b|vinilo\b|LPs?\b|DVDs?\b)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count > 0 && count <= 100 ? count : null;
}

/** Avoid silently treating a multiple-disc package as just one disc. */
export function resolveWordDiscCount(format: string, aiCount: unknown): number {
  return discCountFromDocumentFormat(format) || (Number.isSafeInteger(aiCount) && Number(aiCount) > 0 ? Number(aiCount) : 1);
}

/** Accept DD/MM/YYYY when explicitly written, but never guess incomplete dates. */
export function normalizeWrittenFullDate(value: string): string {
  const clean = String(value || '').trim();
  const match = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return clean;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() + 1 !== month || date.getUTCFullYear() !== year) return clean;
  return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}
