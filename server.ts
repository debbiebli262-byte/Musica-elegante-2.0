import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mammoth from "mammoth";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });
console.log("Loaded GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "YES" : "NO");

const execFileAsync = promisify(execFile);
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const upload = multer({ dest: "uploads/" });

async function extractTextFromWordFile(filePath: string, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (extension === ".doc") {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "word-import-"));
    const outputDir = tempDir;

    try {
      await execFileAsync("libreoffice", [
        "--headless",
        "--convert-to",
        "docx",
        "--outdir",
        outputDir,
        filePath,
      ]);

      const convertedName = path.basename(filePath, path.extname(filePath)) + ".docx";
      const convertedPath = path.join(outputDir, convertedName);

      const result = await mammoth.extractRawText({ path: convertedPath });
      return result.value;
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  throw new Error("Only .doc and .docx files are supported");
}

async function parseWordTextWithAI(rawText: string, sourceFileName: string) {
  if (!ai) {
    throw new Error("GEMINI_API_KEY is missing in the server environment");
  }

  const prompt = `
You are extracting structured classical music library data from a Word document.

Return ONLY valid JSON.

The document may contain:
- composer biography
- sections like Arias / Quartets / Other Works
- individual works or recordings
- performers, orchestra, conductor
- recording dates
- album or box-set titles
- label, catalog number, format, edition year

Important extraction rule:
The document is often organized by WORK/RECORDING entries, not by album entries.
So first identify each recording entry, then attach album information if it appears below that entry.

Return this JSON structure:

{
  "composer": {
    "name": "",
    "birthDate": "",
    "birthPlace": "",
    "deathDate": "",
    "deathPlace": "",
    "biography": "",
    "nationality": ""
  },
  "recordings": [
    {
      "section": "",
      "workTitle": "",
      "workSubtitle": "",
      "opus": "",
      "compositionDate": "",
      "premiereDate": "",
      "performers": [],
      "soloists": [],
      "orchestra": "",
      "conductor": "",
      "choir": "",
      "recordingDate": "",
      "recordingLocation": "",
      "albumTitle": "",
      "albumSubtitle": "",
      "label": "",
      "catalogNumber": "",
      "format": "",
      "editionYear": "",
      "country": "",
      "notes": ""
    }
  ],
  "albums": [
    {
      "title": "",
      "label": "",
      "catalogNumber": "",
      "format": "",
      "editionYear": "",
      "country": "",
      "discCount": 1,
      "works": [],
      "performers": [],
      "orchestra": "",
      "conductor": "",
      "notes": ""
    }
  ],
  "warnings": []
}

Rules:
- Do not invent missing data.
- If a field is unknown, use empty string or empty array.
- A recording entry may exist even if album info is partial.
- Album titles often appear AFTER the work/performer lines.
- Catalog numbers like "09026-61580-2", "449 346-2", "CACD103" are important.
- Formats like CD, 2 CD, 6 CD, ADD, DDD should be captured when present.
- Keep the original language meaning.
- Extract as many recording entries as possible, not just one album.

Source file: ${sourceFileName}

Document text:
"""${rawText.slice(0, 120000)}"""
`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      composer: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          birthDate: { type: Type.STRING },
          birthPlace: { type: Type.STRING },
          deathDate: { type: Type.STRING },
          deathPlace: { type: Type.STRING },
          biography: { type: Type.STRING },
          nationality: { type: Type.STRING }
        }
      },
      recordings: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            section: { type: Type.STRING },
            workTitle: { type: Type.STRING },
            workSubtitle: { type: Type.STRING },
            opus: { type: Type.STRING },
            compositionDate: { type: Type.STRING },
            premiereDate: { type: Type.STRING },
            performers: { type: Type.ARRAY, items: { type: Type.STRING } },
            soloists: { type: Type.ARRAY, items: { type: Type.STRING } },
            orchestra: { type: Type.STRING },
            conductor: { type: Type.STRING },
            choir: { type: Type.STRING },
            recordingDate: { type: Type.STRING },
            recordingLocation: { type: Type.STRING },
            albumTitle: { type: Type.STRING },
            albumSubtitle: { type: Type.STRING },
            label: { type: Type.STRING },
            catalogNumber: { type: Type.STRING },
            format: { type: Type.STRING },
            editionYear: { type: Type.STRING },
            country: { type: Type.STRING },
            notes: { type: Type.STRING }
          }
        }
      },
      albums: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            label: { type: Type.STRING },
            catalogNumber: { type: Type.STRING },
            format: { type: Type.STRING },
            editionYear: { type: Type.STRING },
            country: { type: Type.STRING },
            discCount: { type: Type.NUMBER },
            works: { type: Type.ARRAY, items: { type: Type.STRING } },
            performers: { type: Type.ARRAY, items: { type: Type.STRING } },
            orchestra: { type: Type.STRING },
            conductor: { type: Type.STRING },
            notes: { type: Type.STRING }
          }
        }
      },
      warnings: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    },
    required: ["composer", "recordings", "albums", "warnings"]
  };

  const maxRetries = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`AI attempt ${attempt}`);

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });

      if (!response.text) {
        throw new Error("AI returned empty response");
      }

      let cleanedText = response.text.trim();

      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
      }

      if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```$/, "").trim();
      }

      const firstBrace = cleanedText.indexOf("{");
      const lastBrace = cleanedText.lastIndexOf("}");

      if (firstBrace === -1 || lastBrace === -1) {
        console.error("AI did not return JSON:", cleanedText);
        throw new Error("AI did not return JSON");
      }

      cleanedText = cleanedText.slice(firstBrace, lastBrace + 1);

      return JSON.parse(cleanedText);
    } catch (error) {
      lastError = error;
      console.error(`AI attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to parse Word text with AI");
}

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/artist-metadata", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({ error: "GEMINI_API_KEY is missing" });
    }

    const artistName = String(req.query.name || "").trim();

    if (!artistName) {
      return res.status(400).json({ error: "Artist name is required" });
    }

    const prompt = `Escribe una biografía del artista "${artistName}" en español.

Devuelve SOLO JSON válido con estas claves:
{
  "biography": "",
  "birthDate": "",
  "deathDate": "",
  "birthPlace": "",
  "deathPlace": "",
  "instruments": [],
  "periods": [],
  "imageKeyword": ""
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) {
      return res.status(500).json({ error: "Gemini returned empty response" });
    }

    let cleanedText = response.text.trim();

    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    }

    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```$/, "").trim();
    }

    const firstBrace = cleanedText.indexOf("{");
    const lastBrace = cleanedText.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      console.error("Gemini did not return JSON:", cleanedText);
      return res.status(500).json({ error: "Invalid AI response" });
    }

    cleanedText = cleanedText.slice(firstBrace, lastBrace + 1);

    const data = JSON.parse(cleanedText);

    return res.json({
      biography: data.biography || "",
      birthDate: data.birthDate || "",
      deathDate: data.deathDate || "",
      birthPlace: data.birthPlace || "",
      deathPlace: data.deathPlace || "",
      instruments: Array.isArray(data.instruments) ? data.instruments : [],
      periods: Array.isArray(data.periods) ? data.periods : [],
      imageUrl: await fetchWikipediaArtistImage(artistName),
    });
  } catch (error) {
    console.error("Artist metadata error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  }
});

  app.get("/api/resolve-image", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Failed to fetch site");
      }

      const html = await response.text();

      const ogImage =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];

      const twitterImage =
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1];

      const icon =
        html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1];

      let resolvedUrl = ogImage || twitterImage || icon;

      if (resolvedUrl && !resolvedUrl.startsWith("http")) {
        const baseUrl = new URL(url);
        resolvedUrl = new URL(resolvedUrl, baseUrl.origin).toString();
      }

      if (resolvedUrl) {
        return res.json({ imageUrl: resolvedUrl });
      }

      const firstImg = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
      if (firstImg) {
        const baseUrl = new URL(url);
        resolvedUrl = new URL(firstImg, baseUrl.origin).toString();
        return res.json({ imageUrl: resolvedUrl });
      }

      return res.status(404).json({ error: "No image found on this site" });
    } catch (error) {
      console.error("Error resolving image:", error);
      return res.status(500).json({ error: "Failed to resolve image from URL" });
    }
  });

  app.post("/api/import-word", upload.single("file"), async (req, res) => {
    let filePath: string | undefined;

    try {
      filePath = req.file?.path;
      const originalName = req.file?.originalname || "";

      console.log("Uploading file:", originalName);

      if (!filePath) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const extension = path.extname(originalName).toLowerCase();

      if (![".doc", ".docx"].includes(extension)) {
        return res.status(400).json({ error: "Only .doc and .docx files are supported" });
      }

      const rawText = await extractTextFromWordFile(filePath, originalName);

      console.log("Extracted text length:", rawText?.length || 0);

      if (!rawText.trim()) {
        return res.status(400).json({ error: "No readable text found in the Word file" });
      }

      const parsed = await parseWordTextWithAI(rawText, originalName);

      console.log("PARSED RESULT:");
      console.log(JSON.stringify(parsed, null, 2));

      return res.json({
        ...parsed,
        rawText,
        sourceFileName: originalName,
      });
    } catch (error) {
      console.error("Error importing Word file:", error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to process Word file",
      });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  app.get("/api/discogs-search-by-catalog", async (req, res) => {
  try {
    const rawQuery = String(req.query.catno || req.query.barcode || "").trim();
    const searchMode = req.query.barcode ? "barcode" : "catno";

    if (!rawQuery) {
      return res.status(400).json({ error: "Catalog number or barcode is required" });
    }

    const token = process.env.DISCOGS_TOKEN;
    const userAgent = process.env.DISCOGS_USER_AGENT || "MusicaElegante/1.0";

    if (!token) {
      return res.status(500).json({ error: "DISCOGS_TOKEN is missing" });
    }

    const cleanedNoSpaces = rawQuery.replace(/[-\s]/g, "");
    const spacedBarcode =
      cleanedNoSpaces.length === 12
        ? `${cleanedNoSpaces[0]} ${cleanedNoSpaces.slice(1, 6)} ${cleanedNoSpaces.slice(6, 11)} ${cleanedNoSpaces.slice(11)}`
        : "";

    // Build search attempts based on mode
    const searchAttempts: { key: string; value: string }[] = searchMode === "barcode"
      ? [
          { key: "barcode", value: rawQuery },
          { key: "barcode", value: cleanedNoSpaces },
          ...(spacedBarcode ? [{ key: "barcode", value: spacedBarcode }] : []),
          { key: "q", value: rawQuery },
        ]
      : [
          { key: "catno", value: rawQuery },
          { key: "catno", value: rawQuery.replace(/-/g, "") },
          { key: "catno", value: rawQuery.replace(/\s+/g, "") },
          { key: "q", value: rawQuery },
        ];

    // Deduplicate
    const uniqueAttempts = searchAttempts.filter((attempt, index, all) =>
      attempt.value &&
      all.findIndex((other) => other.key === attempt.key && other.value === attempt.value) === index
    );

    let found: any = null;

    for (const attempt of uniqueAttempts) {
      const searchUrl = new URL("https://api.discogs.com/database/search");
      searchUrl.searchParams.set(attempt.key, attempt.value);
      searchUrl.searchParams.set("type", "release");
      searchUrl.searchParams.set("per_page", "10");

      const response = await fetch(searchUrl.toString(), {
        headers: {
          "User-Agent": userAgent,
          "Authorization": `Discogs token=${token}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Discogs error:", text);
        continue;
      }

      const data = await response.json();
      if (data.results?.length) {
        found = data.results[0];
        break;
      }
    }

    if (!found) {
      return res.status(404).json({ error: "No Discogs release found" });
    }

    // Fetch full release data
    const releaseUrl =
      found.resource_url ||
      (found.id ? `https://api.discogs.com/releases/${found.id}` : "");

    let releaseData: any = null;
    if (releaseUrl) {
      const releaseResponse = await fetch(releaseUrl, {
        headers: {
          "User-Agent": userAgent,
          "Authorization": `Discogs token=${token}`,
        },
      });
      if (releaseResponse.ok) {
        releaseData = await releaseResponse.json();
      }
    }

    // Extract all artists from the release (for shared/compilation albums)
    const releaseArtists: string[] = [];
    if (Array.isArray(releaseData?.artists)) {
      for (const a of releaseData.artists) {
        const name = String(a.name || "").replace(/\s*\(\d+\)$/, "").trim();
        if (name && name !== "Various") releaseArtists.push(name);
      }
    }
    // Also collect artists from tracklist
    const tracklistArtists: string[] = [];
    for (const track of (releaseData?.tracklist || [])) {
      if (Array.isArray(track.artists)) {
        for (const a of track.artists) {
          const name = String(a.name || "").replace(/\s*\(\d+\)$/, "").trim();
          if (name && name !== "Various" && !tracklistArtists.includes(name)) {
            tracklistArtists.push(name);
          }
        }
      }
    }

    const allArtistNames = Array.from(new Set([...releaseArtists, ...tracklistArtists]));

    // Build tracklist with per-track artist info
    const rawTracklist = (releaseData?.tracklist || []).map((track: any) => ({
      position: track.position || "",
      title: track.title || "",
      duration: track.duration || "",
      type_: track.type_ || "",
      artists: Array.isArray(track.artists)
        ? track.artists.map((a: any) => String(a.name || "").replace(/\s*\(\d+\)$/, "").trim()).filter(Boolean)
        : [],
      extraartists: track.extraartists || [],
      sub_tracks: track.sub_tracks || [],
    }));

    // Helper functions
    function flattenTracklist(tracklist: any[]): any[] {
      const result: any[] = [];
      for (const item of tracklist) {
        result.push(item);
        if (Array.isArray(item.sub_tracks) && item.sub_tracks.length > 0) {
          for (const sub of item.sub_tracks) {
            result.push({ ...sub, position: sub.position || item.position || "" });
          }
        }
      }
      return result;
    }

    function getDiscNumber(position?: string): number {
      if (!position) return 1;
      const match = position.trim().match(/(\d+)\s*[-.]/) || position.trim().match(/CD\s*(\d+)/i);
      if (match?.[1]) { const n = parseInt(match[1], 10); return isNaN(n) ? 1 : n; }
      return 1;
    }

    function getTrackNumber(position?: string, fallback = 1): number {
      if (!position) return fallback;
      const match = position.trim().match(/(?:\d+\s*[-.])\s*(\d+)/);
      if (match?.[1]) { const n = parseInt(match[1], 10); return isNaN(n) ? fallback : n; }
      const vinyl = position.trim().match(/[A-Z]\s*(\d+)/i);
      if (vinyl?.[1]) { const n = parseInt(vinyl[1], 10); return isNaN(n) ? fallback : n; }
      return fallback;
    }

    function uniqueText(values: Array<string | undefined | null>) {
      return Array.from(new Set(values.map(v => String(v || "").replace(/\s*\(\d+\)$/, "").trim()).filter(Boolean))).join(", ");
    }

    function findRole(extraartists: any[], keywords: string[]) {
      return uniqueText(
        (extraartists || [])
          .filter(a => keywords.some(k => String(a.role || "").toLowerCase().includes(k)))
          .map(a => a.name)
      );
    }

    const albumExtraArtists = Array.isArray(releaseData?.extraartists) ? releaseData.extraartists : [];
    const trackExtraArtists = rawTracklist.flatMap((t: any) => Array.isArray(t.extraartists) ? t.extraartists : []);
    const allExtraArtists = [...albumExtraArtists, ...trackExtraArtists];

    const genres = releaseData?.genres || found.genre || [];
    const styles = releaseData?.styles || found.style || [];
    const genreList = Array.isArray(genres) ? genres : [genres].filter(Boolean);
    const styleList = Array.isArray(styles) ? styles : [styles].filter(Boolean);
    const isClassical = [...genreList, ...styleList].some(g => String(g).toLowerCase().includes("class"));

    const flatTracklist = flattenTracklist(rawTracklist);
    const playableTracks = flatTracklist.filter((t: any) => t.title && t.type_ !== "heading");

    // Build classical discs structure
    const discsMap = new Map<number, any>();
    let pendingWorkTitle = "";
    let fallbackWorkTitle = "Tracklist";
    const movCounters = new Map<string, number>();

    for (const item of flatTracklist) {
      if (item.type_ === "heading") { pendingWorkTitle = item.title?.trim() || ""; continue; }
      if (!item.title || item.type_ === "heading") continue;
      const discNum = getDiscNumber(item.position);
      if (!discsMap.has(discNum)) discsMap.set(discNum, { discNumber: discNum, works: [] });
      const disc = discsMap.get(discNum)!;
      const workTitle = pendingWorkTitle || fallbackWorkTitle;
      let work = disc.works.find((w: any) => w.title === workTitle);
      if (!work) { work = { title: workTitle, movements: [], trackArtists: [] }; disc.works.push(work); }
      const key = `${discNum}__${workTitle}`;
      const n = (movCounters.get(key) || 0) + 1;
      movCounters.set(key, n);
      work.movements.push({ trackNumber: n, title: item.title?.trim() || "", duration: item.duration?.trim() || "" });
      // Attach per-track artists to this work for highlighting
      if (Array.isArray(item.artists) && item.artists.length > 0) {
        for (const a of item.artists) {
          if (!work.trackArtists.includes(a)) work.trackArtists.push(a);
        }
      }
      fallbackWorkTitle = workTitle;
    }

    const discs = isClassical ? Array.from(discsMap.values()).sort((a: any, b: any) => a.discNumber - b.discNumber) : [];

    // Build jazz tracks
    let fallbackCounter = 1;
    const tracks = isClassical ? [] : playableTracks.map((item: any) => {
      const t = {
        trackNumber: getTrackNumber(item.position, fallbackCounter),
        discNumber: getDiscNumber(item.position),
        title: item.title?.trim() || "",
        duration: item.duration?.trim() || "",
        artists: Array.isArray(item.artists) ? item.artists : [],
      };
      fallbackCounter++;
      return t;
    });

    const labelNames = Array.isArray(releaseData?.labels)
      ? releaseData.labels.map((l: any) => l.name).filter(Boolean).join(", ")
      : Array.isArray(found.label) ? found.label.join(", ") : "";

    const mainCatno = releaseData?.labels?.[0]?.catno || found.catno || "";

    // Guess disc count
    let discCount = 1;
    const fmts = releaseData?.formats || [];
    for (const fmt of fmts) {
      const qty = parseInt(String(fmt.qty || ""), 10);
      if (!isNaN(qty) && qty > 1) { discCount = qty; break; }
    }

    return res.json({
      title: releaseData?.title || found.title || "",
      artist: releaseArtists.join(", "),
      allArtistNames,
      year: releaseData?.year || found.year || "",
      country: releaseData?.country || found.country || "",
      format: Array.isArray(found.format) ? found.format.join(", ") : "",
      label: labelNames,
      catno: mainCatno,
      thumb: found.thumb || "",
      coverImage: releaseData?.images?.[0]?.uri || found.cover_image || "",
      discogsUrl: found.uri ? `https://www.discogs.com${found.uri}` : "",
      genres: genreList,
      styles: styleList,
      isClassical,
      discCount,
      orchestra: findRole(allExtraArtists, ["orchestra"]),
      conductor: findRole(allExtraArtists, ["conductor", "directed by", "director"]),
      producer: findRole(allExtraArtists, ["producer", "produced by"]),
      engineer: findRole(allExtraArtists, ["engineer", "recorded by", "recording engineer"]),
      masteringEngineer: findRole(allExtraArtists, ["mastered by", "mastering"]),
      originalLabel: labelNames,
      originalCatalogNumber: mainCatno,
      originalYear: releaseData?.year || found.year || "",
      rawTracklist,
      tracks,
      discs,
    });
  } catch (error) {
    console.error("Discogs catalog search error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected Discogs error",
    });
  }
});

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
