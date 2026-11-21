/** Validate only fields required to save; legacy albums may have no artistName. */
export function validateAlbumSave(title: string, artistName: string, editingExistingAlbum: boolean): string | null {
  if (!title.trim()) return 'Introduce un título antes de guardar.';
  if (!editingExistingAlbum && !artistName.trim()) return 'Introduce el nombre del artista antes de guardar un álbum nuevo.';
  return null;
}

/** Never replace a missing legacy artist credit with an empty string during unrelated edits. */
export function artistNameUpdate(artistName: string, editingExistingAlbum: boolean): { artistName?: string } {
  const cleanName = artistName.trim();
  return cleanName || !editingExistingAlbum ? { artistName: cleanName } : {};
}
