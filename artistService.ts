export async function fetchArtistMetadata(artistName: string) {
  try {
    const response = await fetch(
      `/api/artist-metadata?name=${encodeURIComponent(artistName)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "No se pudo obtener metadata del artista.");
    }

    return {
      biography: data.biography || "",
      biographySections: Array.isArray(data.biographySections) ? data.biographySections : [],
      birthDate: data.birthDate || "",
      deathDate: data.deathDate || "",
      birthPlace: data.birthPlace || "",
      deathPlace: data.deathPlace || "",
      instruments: Array.isArray(data.instruments) ? data.instruments : [],
      periods: Array.isArray(data.periods) ? data.periods : [],
      imageUrl: data.imageUrl || "",
    };
  } catch (error) {
    console.error("Error fetching artist metadata:", error);
    return null;
  }
}