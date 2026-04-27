import { GoogleGenAI, Type } from "@google/genai";
import { db } from "../firebase";
import { doc, setDoc } from "firebase/firestore";

const apiKey = process.env.GEMINI_API_KEY || "";

export interface AlbumData {
  title: string;
  releaseYear: string;
  imageUrl: string;
}

function normalizeAlbumId(title: string, artistId: string) {
  return (
    artistId +
    "_" +
    title
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .replace(/[^\w_]/g, "")
  );
}

export async function fetchArtistDiscography(
  artistName: string,
  artistId: string,
  genre: string
): Promise<AlbumData[]> {
  console.log("DISCOGRAPHY SERVICE RUNNING", artistName);
  console.log("API key exists:", !!apiKey);

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Escribe una lista de los 10 álbumes o grabaciones más conocidos del artista "${artistName}".
Devuelve SOLO un array JSON válido con objetos que tengan:
- title
- releaseYear
- imageKeyword`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              releaseYear: { type: Type.STRING },
              imageKeyword: { type: Type.STRING }
            },
            required: ["title", "releaseYear", "imageKeyword"]
          }
        }
      }
    });

    console.log("Gemini discography text:", response.text);

    if (!response.text) return [];

    const albums = JSON.parse(response.text);

    const albumObjects: AlbumData[] = [];

    for (const album of albums) {
      const imageUrl = `https://picsum.photos/seed/${encodeURIComponent(
        `${album.title} ${album.imageKeyword || "album"}`
      )}/800/800`;

      const albumId = normalizeAlbumId(album.title, artistId);

      const albumData = {
        title: album.title,
        releaseYear: Number(album.releaseYear),
        artistId: artistId,
        genre: genre,
        imageUrl: imageUrl
      };

      console.log("Saving album:", albumId, albumData);

      await setDoc(doc(db, "albums", albumId), albumData, { merge: true });

      albumObjects.push({
        title: album.title,
        releaseYear: album.releaseYear,
        imageUrl: imageUrl
      });
    }

    return albumObjects;

  } catch (error) {
    console.error("Error fetching discography:", error);
    return [];
  }
}
