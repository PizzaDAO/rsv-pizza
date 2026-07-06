import '@testing-library/jest-dom';

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
    // napoletana-58547: force the Google branch in tests so the osm-branch
    // components (which lazy-load maplibre-gl / call out to Photon) aren't
    // exercised in jsdom. Set to 'osm' to test the keyless path explicitly.
    VITE_MAP_PROVIDER: 'google',
    VITE_API_URL: 'http://localhost:3001',
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  },
  writable: true,
});
