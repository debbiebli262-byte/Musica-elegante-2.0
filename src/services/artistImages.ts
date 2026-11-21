import { useEffect, useState } from 'react';

const cache = new Map<string, Promise<string>>();

export function findArtistPortrait(name: string): Promise<string> {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) return Promise.resolve('');
  const existing = cache.get(normalizedName);
  if (existing) return existing;

  const pending = fetch('/api/artist-image?name=' + encodeURIComponent(name.trim()))
    .then(async response => {
      if (!response.ok) throw new Error('Artist image lookup failed');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('imageUrl' in data) ||
          typeof data.imageUrl !== 'string') return '';
      return data.imageUrl;
    })
    .catch(() => '');
  cache.set(normalizedName, pending);
  return pending;
}

export function useArtistPortrait(name: string, savedImageUrl?: string) {
  const [fallbackImage, setFallbackImage] = useState('');
  useEffect(() => {
    if (savedImageUrl?.trim() || !name.trim()) {
      setFallbackImage('');
      return;
    }
    let active = true;
    findArtistPortrait(name).then(url => {
      if (active) setFallbackImage(url);
    });
    return () => { active = false; };
  }, [name, savedImageUrl]);
  return savedImageUrl?.trim() || fallbackImage;
}
