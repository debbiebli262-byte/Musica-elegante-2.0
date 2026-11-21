import { requireLibraryMember } from '../src/server/libraryAuth.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireLibraryMember(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { artistName } = req.body ?? {};
  if (typeof artistName !== 'string' || !artistName.trim() || artistName.length > 200) {
    return res.status(400).json({ error: 'Invalid artist name' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Discography generation is not configured' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Escribe una lista de hasta 10 álbumes o grabaciones conocidos del artista "${artistName.trim()}". No inventes títulos ni fechas. Devuelve objetos con title, releaseYear e imageKeyword.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              releaseYear: { type: Type.STRING },
              imageKeyword: { type: Type.STRING }
            },
            required: ['title', 'releaseYear', 'imageKeyword']
          }
        }
      }
    });

    const parsed: unknown = JSON.parse(response.text || '[]');
    if (!Array.isArray(parsed)) throw new Error('Unexpected AI response format');

    const seen = new Set<string>();
    const albums = parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const data = item as Record<string, unknown>;
      if (typeof data.title !== 'string' || !data.title.trim()) return [];
      const title = data.title.trim().slice(0, 200);
      const key = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const releaseYear = typeof data.releaseYear === 'string' ? data.releaseYear.trim() : '';
      const imageKeyword = typeof data.imageKeyword === 'string' ? data.imageKeyword : 'album';
      return [{
        title,
        releaseYear,
        imageUrl: `https://picsum.photos/seed/${encodeURIComponent(`${title} ${imageKeyword}`)}/800/800`
      }];
    }).slice(0, 10);

    return res.status(200).json({ albums });
  } catch (error) {
    console.error('Discography generation failed:', error);
    return res.status(502).json({ error: 'No se pudo generar la discografía.' });
  }
}
