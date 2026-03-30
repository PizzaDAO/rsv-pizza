import '@testing-library/jest-dom';

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_GOOGLE_MAPS_API_KEY: 'test-api-key',
    VITE_API_URL: 'http://localhost:3001',
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  },
  writable: true,
});
