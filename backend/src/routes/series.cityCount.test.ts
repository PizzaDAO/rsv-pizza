import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  eventSeries: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
import seriesRoutes from './series.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use('/api/series', seriesRoutes);
app.use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 's1', siteUrl: 'https://x.example.com', isActive: true });
  mockPrisma.$queryRaw.mockResolvedValue([{ n: 2n }]);
});

describe('GET /api/series/:slug/cities/:city/count', () => {
  it('returns only a count, via a parameterized lower() match (wildcards are literal)', async () => {
    const res = await request(app).get('/api/series/doge/cities/%25/count');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ city: '%', count: 2 });
    const [strings, ...vals] = mockPrisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toContain('lower(city) = lower(');
    expect(strings.join('?')).not.toMatch(/ILIKE/i);
    expect(vals).toContain('%'); // bound as a value, never interpolated into SQL
  });

  it('404 for an unbranded/inactive series', async () => {
    mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 's1', siteUrl: null, isActive: true });
    expect((await request(app).get('/api/series/gpp2026/cities/Austin/count')).status).toBe(404);
  });
});
