export interface AlbumData {
  title: string;
  releaseYear: string;
  imageUrl: string;
}

/** Generates suggestions on the server; the caller is responsible for saving them once. */
export async function fetchArtistDiscography(
  artistName: string,
  _artistId: string,
  _genre: string
): Promise<AlbumData[]> {
  const response = await fetch('/api/discography', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artistName })
  });

  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String(data.error)
      : 'No se pudo generar la discografía.';
    throw new Error(message);
  }

  if (!data || typeof data !== 'object' || !('albums' in data) || !Array.isArray(data.albums)) {
    throw new Error('Respuesta inválida del servidor.');
  }

  return data.albums.filter((album): album is AlbumData =>
    Boolean(album && typeof album.title === 'string' && typeof album.releaseYear === 'string' && typeof album.imageUrl === 'string')
  );
}
