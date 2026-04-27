import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

async function fetchWikipediaArtistImage(artistName: string): Promise<string> {
  const searchQueries = [
    artistName,
    `${artistName} musician`,
    `${artistName} composer`,
    `${artistName} jazz`,
  ];

  for (const searchQuery of searchQueries) {
    try {
      const searchUrl =
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(searchQuery)}`;

      const searchResponse = await fetch(searchUrl, {
        headers: {
          "User-Agent": "MusicaElegante/1.0 artist image lookup",
        },
      });

      if (!searchResponse.ok) continue;

      const searchData = await searchResponse.json();
      const results = searchData?.query?.search;

      if (!Array.isArray(results)) continue;

      for (const result of results) {
        const title = result?.title;
        if (!title) continue;

        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const summaryResponse = await fetch(summaryUrl, {
          headers: {
            "User-Agent": "MusicaElegante/1.0 artist image lookup",
          },
        });

        if (!summaryResponse.ok) continue;

        const summaryData = await summaryResponse.json();
        const imageUrl = summaryData?.originalimage?.source || summaryData?.thumbnail?.source || "";

        if (imageUrl) return imageUrl;
      }
    } catch (error) {
      console.warn("Wikipedia artist image lookup failed:", error);
    }
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const artistName = String(req.query.name || "").trim();

  if (!artistName) {
    return res.status(400).json({ error: "Missing artist name" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Escribe una biografía del artista "${artistName}" en español.

IMPORTANTE:
- Divide la biografía en secciones claras con títulos
- Usa 3 a 5 secciones como máximo
- Cada sección debe tener un título corto y contenido claro

Devuelve SOLO JSON válido con esta estructura:

{
  "biography": "",
  "biographySections": [
    {
      "title": "",
      "content": ""
    }
  ],
  "birthDate": "",
  "deathDate": "",
  "birthPlace": "",
  "deathPlace": "",
  "instruments": [],
  "periods": [],
  "imageKeyword": ""
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text;

    if (!text) {
      return res.status(500).json({ error: "Empty response from Gemini" });
    }

    let cleanedText = text.trim();

    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    }

    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```$/, "").trim();
    }

    const firstBrace = cleanedText.indexOf("{");
    const lastBrace = cleanedText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      console.error("Invalid AI response:", cleanedText);
      return res.status(500).json({ error: "Invalid AI response" });
    }

    cleanedText = cleanedText.slice(firstBrace, lastBrace + 1);

    const data = JSON.parse(cleanedText);

    return res.status(200).json({
      biography: data.biography || "",
      biographySections: Array.isArray(data.biographySections)
        ? data.biographySections
        : [],
      birthDate: data.birthDate || "",
      deathDate: data.deathDate || "",
      birthPlace: data.birthPlace || "",
      deathPlace: data.deathPlace || "",
      instruments: Array.isArray(data.instruments) ? data.instruments : [],
      periods: Array.isArray(data.periods) ? data.periods : [],
      imageUrl: await fetchWikipediaArtistImage(artistName),
    });
  } catch (error: any) {
    console.error("Gemini artist metadata error:", error);

    return res.status(500).json({
      error: "Gemini error",
      message: error?.message || String(error),
    });
  }
}