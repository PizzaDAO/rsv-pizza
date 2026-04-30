const UNSPLASH_BASE = 'https://api.unsplash.com';

export interface UnsplashPhoto {
  id: string;
  urls: { regular: string; small: string };
  user: { name: string; links: { html: string } };
  links: { html: string };
}

// Module-level cache keyed by search query
const cache = new Map<string, UnsplashPhoto[]>();

export async function searchSkylinePhotos(city: string): Promise<UnsplashPhoto[]> {
  const key = import.meta.env.VITE_UNSPLASH_ACCESS_KEY;
  if (!key) return [];

  const query = `${city} skyline`;
  if (cache.has(query)) return cache.get(query)!;

  try {
    const res = await fetch(
      `${UNSPLASH_BASE}/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=6`,
      { headers: { Authorization: `Client-ID ${key}` } }
    );
    if (!res.ok) throw new Error(`Unsplash ${res.status}`);
    const data = await res.json();
    const photos: UnsplashPhoto[] = data.results || [];
    cache.set(query, photos);
    return photos;
  } catch (err) {
    console.error('Unsplash search failed:', err);
    return [];
  }
}
