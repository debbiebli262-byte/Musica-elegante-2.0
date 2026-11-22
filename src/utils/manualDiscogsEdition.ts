export interface ManualDiscogsEditionInput {
  title: string;
  artist: string;
  label: string;
  format: 'CD' | 'Vinilo' | '';
  catalogNumber: string;
  barcode: string;
  year: string;
  country: string;
  originalLabel: string;
  discCount: number;
}

/** A manually identified physical copy is not a Discogs release. */
export function buildManualEdition(input: ManualDiscogsEditionInput) {
  const title = input.title.trim();
  const artist = input.artist.trim();
  const label = input.label.trim();
  if (!title || !artist || !label || !input.format) {
    throw new Error('Completa el título, artista, sello y formato.');
  }
  return {
    title, artist, label,
    formats: [input.format] as ('CD' | 'Vinilo')[],
    catalogNumber: input.catalogNumber.trim(),
    barcode: input.barcode.trim(),
    releaseYear: input.year.trim(),
    country: input.country.trim(),
    originalLabel: input.originalLabel.trim(),
    discCount: Number.isSafeInteger(input.discCount) ? Math.min(100, Math.max(1, input.discCount)) : 1,
    importSource: { fileName: '', method: 'manual-edition' },
  };
}

/** Use label and physical format to distinguish unlisted copies sharing a title. */
export function manualEditionIdentity(edition: ReturnType<typeof buildManualEdition>) {
  return [
    edition.catalogNumber || edition.barcode || 'sin-catalogo',
    edition.label, edition.formats[0], edition.country
  ].join('-');
}
