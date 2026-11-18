import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// blackolive-70521: the series events endpoint (brand /events + SeriesLandingPage) carries labels.
const mockPrisma = vi.hoisted(() => ({
  eventSeries: { findUnique: vi.fn() },
  party: { findMany: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
import seriesRoutes from './series.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use('/api/series', seriesRoutes);
app.use(errorHandler);

const ROW = {
  id: 'p1', name: 'Pizza Night', customUrl: 'pn', inviteCode: 'abc', city: 'Austin', country: 'US',
  region: null, date: new Date('2027-01-01T00:00:00Z'), latitude: 1, longitude: 2, eventImageUrl: null,
  underbossStatus: 'approved',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 's1', siteUrl: null, isActive: true });
});

describe('GET /api/series/:slug/events labels', () => {
  it('selects and returns labels', async () => {
    mockPrisma.party.findMany.mockResolvedValue([{ ...ROW, labels: ['dj', 'free'] }]);
    const res = await request(app).get('/api/series/gpp2026/events');
    expect(res.status).toBe(200);
    expect(res.body.events[0].labels).toEqual(['dj', 'free']);
    expect(mockPrisma.party.findMany.mock.calls[0][0].select.labels).toBe(true);
  });

  it('defaults to [] when the row has none', async () => {
    mockPrisma.party.findMany.mockResolvedValue([ROW]);
    const res = await request(app).get('/api/series/gpp2026/events');
    expect(res.body.events[0].labels).toEqual([]);
  });
});
