import { requireLibraryMember } from '../src/server/libraryAuth.js';
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import { extractSourceBiography, normalizeWrittenFullDate } from '../src/utils/wordSourceAccuracy.js';

// Dynamically import mammoth only when needed (it's a heavy CommonJS module)
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function parseFormData(
  req: VercelRequest
): Promise<{ buffer: Buffer; fileName: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        return reject(new Error("No boundary found in multipart form data"));
      }

      const boundary = boundaryMatch[1];
      const bodyStr = body.toString("binary");

      // Find the file part
      const filePartRegex =
        /Content-Disposition: form-data; name="file"; filename="([^"]+)"\r\nContent-Type: [^\r\n]+\r\n\r\n/;
      const match = filePartRegex.exec(bodyStr);
      if (!match) {
        return reject(new Error("No file found in form data"));
      }

      const fileName = match[1];
      const fileStart = match.index + match[0].length;
      const boundaryDelimiter = `\r\n--${boundary}`;
      const fileEnd = bodyStr.indexOf(boundaryDelimiter, fileStart);
      if (fileEnd === -1) {
        return reject(new Error("Could not find end of file in form data"));
      }

      const fileBuffer = Buffer.from(
        bodyStr.slice(fileStart, fileEnd),
        "binary"
      );
      resolve({ buffer: fileBuffer, fileName });
    });
    req.on("error", reject);
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (!(await requireLibraryMember(req, res))) return;
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { buffer, fileName } = await parseFormData(req);
    if (!fileName.toLowerCase().endsWith('.docx')) {
      return res.status(400).json({ error: 'Sube un archivo .docx válido.' });
    }
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'El archivo supera el límite de 8 MB.' });
    }

    // Extract text from docx
    let rawText: string;
    try {
      rawText = await extractTextFromDocx(buffer);
    } catch (err) {
      return res
        .status(400)
        .json({ error: "No se pudo leer el archivo Word. Asegúrate de que sea un archivo .docx válido." });
    }

    if (!rawText || rawText.trim().length < 10) {
      return res.status(400).json({ error: "El archivo está vacío o no contiene texto legible." });
    }

    // Parse with Gemini AI
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY no configurada en el servidor." });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Analiza el siguiente texto extraído de un archivo Word sobre un artista de música clásica o jazz y su discografía. Extrae todos los datos documentados, sin añadir información inventada.

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin backticks, sin explicaciones) con esta estructura exacta:

{
  "composer": {
    "name": "nombre del artista o compositor",
    "birthDate": "fecha en formato YYYY-MM-DD o texto libre si no hay formato claro",
    "birthPlace": "lugar de nacimiento",
    "deathDate": "fecha en formato YYYY-MM-DD o texto libre",
    "deathPlace": "lugar de fallecimiento",
    "nationality": "nacionalidad",
    "biography": "transcripción fiel y completa de la biografía del documento"
  },
  "albums": [
    {
      "title": "título exacto del álbum si aparece",
      "label": "sello de esta edición",
      "catalogNumber": "número de catálogo de esta edición",
      "barcode": "código de barras si está presente",
      "format": "CD, Vinilo, etc., solo si figura",
      "editionYear": "año de esta edición",
      "country": "país si figura",
      "discCount": 1,
      "notes": ""
    }
  ],
  "recordings": [
    {
      "section": "sección o categoría",
      "workTitle": "título de la obra",
      "workSubtitle": "subtítulo",
      "opus": "número de opus",
      "compositionDate": "fecha de composición",
      "premiereDate": "fecha de estreno",
      "soloists": ["nombre solista 1", "nombre solista 2"],
      "performers": ["intérprete 1", "intérprete 2"],
      "orchestra": "nombre de la orquesta",
      "conductor": "nombre del director",
      "choir": "nombre del coro",
      "recordingDate": "fecha de grabación",
      "recordingLocation": "lugar de grabación",
      "albumTitle": "título del álbum",
      "albumSubtitle": "subtítulo del álbum",
      "label": "sello discográfico",
      "catalogNumber": "número de catálogo",
      "barcode": "código de barras",
      "format": "formato (CD, Vinilo, etc.)",
      "editionYear": "año de edición",
      "country": "país",
      "notes": "notas adicionales"
    }
  ],
  "warnings": ["advertencia 1 si hay información ambigua"]
}

Si algún campo no existe en el texto, déjalo como cadena vacía "" o array vacío [].
No inventes información que no esté en el texto.
Identifica TODOS los álbumes y sus catálogos/códigos de barras, incluso si hay más de uno.
Conserva la biografía íntegra de la persona en composer.biography: no la resumas, reescribas ni sustituyas por una biografía generada.
Separa los lanzamientos por número de catálogo, código de barras, sello y formato.
No conviertas obras o pistas en álbumes si el documento no indica una edición discográfica.
No atribuyas información de un álbum a otro.
Si hay datos inciertos, añádelos a warnings. Nunca inventes números de catálogo, fechas ni biografías.

TEXTO A ANALIZAR:
${rawText.slice(0, 80000)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });

    const responseText = response.text || "";

    // Clean up response (remove markdown fences if present)
    const cleaned = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        return res.status(500).json({
          error: "La IA no devolvió un JSON válido. Intenta reformatear el documento.",
          rawText: responseText.slice(0, 500),
        });
      }
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.composer || !Array.isArray(parsed.recordings)) {
      return res.status(502).json({ error: 'La IA devolvió una estructura incompleta. No se guardó ningún dato.' });
    }
    // For structured Word files, take the biography directly from the source.
    // AI is still used for record/edition extraction, but never paraphrases existing biography text.
    const exactBiography = extractSourceBiography(rawText);
    if (exactBiography) parsed.composer.biography = exactBiography;
    for (const field of ['birthDate', 'deathDate'] as const) {
      const value = parsed.composer[field];
      if (typeof value === 'string') parsed.composer[field] = normalizeWrittenFullDate(value);
    }
    parsed.albums = Array.isArray(parsed.albums) ? parsed.albums : [];
    parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
    if (rawText.length > 80000) parsed.warnings.push('El documento excede 80.000 caracteres: revisa que todos los álbumes hayan sido extraídos.');
    parsed.sourceFileName = fileName;
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error("import-word error:", error);
    return res.status(500).json({
      error: error?.message || "Error interno del servidor al procesar el archivo.",
    });
  }
}
