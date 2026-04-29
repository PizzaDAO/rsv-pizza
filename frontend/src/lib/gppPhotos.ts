const GPP_PHOTOS_URL = 'https://app.gpp.day/api/photos.json';
const GPP_BASE_URL = 'https://app.gpp.day';

interface GppCity {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  countryCode: string;
  years: {
    year: number;
    photos: { src: string }[];
  }[];
}

interface GppManifest {
  cities: GppCity[];
}

// Module-level cache — fetch once, reuse across all components
let manifestCache: GppManifest | null = null;
let manifestPromise: Promise<GppManifest | null> | null = null;

async function fetchManifest(): Promise<GppManifest | null> {
  if (manifestCache) return manifestCache;
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch(GPP_PHOTOS_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch photos manifest: ${res.status}`);
      return res.json() as Promise<GppManifest>;
    })
    .then((data) => {
      manifestCache = data;
      return data;
    })
    .catch((err) => {
      console.error('Error fetching GPP photos manifest:', err);
      manifestPromise = null;
      return null;
    });

  return manifestPromise;
}

export interface GppPhoto {
  src: string;
  url: string;
  year: number;
}

/**
 * Get GPP manifest photos for a city, matched by customUrl or city name.
 * Returns photos sorted most-recent-year first.
 */
export async function getGppPhotosForCity(cityNameOrUrl: string): Promise<GppPhoto[]> {
  const manifest = await fetchManifest();
  if (!manifest) return [];

  const normalized = cityNameOrUrl.toLowerCase().replace(/\s+/g, '');
  const city = manifest.cities.find(
    (c) => c.name.toLowerCase().replace(/\s+/g, '') === normalized
  );

  if (!city || city.years.length === 0) return [];

  const sortedYears = [...city.years].sort((a, b) => b.year - a.year);
  const photos: GppPhoto[] = [];
  for (const yearData of sortedYears) {
    for (const photo of yearData.photos) {
      photos.push({
        src: photo.src,
        url: `${GPP_BASE_URL}${photo.src}`,
        year: yearData.year,
      });
    }
  }
  return photos;
}
