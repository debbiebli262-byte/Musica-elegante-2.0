import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { buffer, fileName } = await parseFormData(req);

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

    const prompt = `Analiza el siguiente texto extraído de un archivo Word de música clásica y extrae la información estructurada.

Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin backticks, sin explicaciones) con esta estructura exacta:

{
  "composer": {
    "name": "nombre del compositor",
    "birthDate": "fecha en formato YYYY-MM-DD o texto libre si no hay formato claro",
    "birthPlace": "lugar de nacimiento",
    "deathDate": "fecha en formato YYYY-MM-DD o texto libre",
    "deathPlace": "lugar de fallecimiento",
    "nationality": "nacionalidad",
    "biography": "biografía completa"
  },
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

TEXTO A ANALIZAR:
${rawText.slice(0, 15000)}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
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

    parsed.sourceFileName = fileName;
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error("import-word error:", error);
    return res.status(500).json({
      error: error?.message || "Error interno del servidor al procesar el archivo.",
    });
  }
}
