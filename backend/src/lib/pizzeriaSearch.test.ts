import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchPizzerias, clearPizzeriaCache, PizzeriaSearchError } from './pizzeriaSearch.js';

const LAT = 40.7128;
const LNG = -74.006;

const overpassOk = {
  ok: true,
  json: async () => ({
    elements: [
      { type: 'node', id: 1, lat: 40.713, lon: -74.005, tags: { name: 'Overpass Pie', phone: '+1 555', 'addr:street': 'Main St', 'addr:housenumber': '1' } },
    ],
  }),
};

const photonFeature = (id: number, name: string, coords: [number, number], extra: any = {}) => ({
  type: 'Feature',
  properties: { osm_type: 'N', osm_id: id, name, housenumber: '72', street: '5th Avenue', city: 'New York', state: 'New York', postcode: '11217', ...extra },
  geometry: { type: 'Point', coordinates: coords },
});

const photonOk = {
  ok: true,
  json: async () => ({
    features: [
      photonFeature(2, 'Far Pizza', [-74.006, 40.7128 + 0.2]), // ~22 km, outside radius
      photonFeature(3, 'Far-ish Pizza', [-74.0, 40.72]),
      photonFeature(4, 'Near Pizza', [-74.0061, 40.7129], { housenumber: undefined, street: undefined, state: undefined, postcode: undefined }),
    ],
  }),
};

const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('searchPizzerias (osm)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    delete process.env.MAP_PROVIDER;
    clearPizzeriaCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses Overpass results when Overpass succeeds', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk);
    const res = await searchPizzerias(LAT, LNG, 5000);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('Overpass Pie');
    expect(res[0].placeId).toBe('osm/node/1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('overpass');
  });

  it('falls back to Photon when Overpass times out', async () => {
    fetchMock.mockRejectedValueOnce(abortErr()).mockResolvedValueOnce(photonOk);
    const res = await searchPizzerias(LAT, LNG, 5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('photon.komoot.io');
    expect(url).toContain('osm_tag=amenity:restaurant');
    expect(url).toContain('osm_tag=amenity:fast_food');
    expect(res.map(r => r.name).sort()).toEqual(['Far-ish Pizza', 'Near Pizza']); // radius filter applied
    const near = res.find(r => r.name === 'Near Pizza')!;
    const farish = res.find(r => r.name === 'Far-ish Pizza')!;
    expect(near.placeId).toBe('osm/node/4');
    expect(near.address).toBe('New York');
    expect(farish.address).toBe('72 5th Avenue, New York, New York 11217');
    expect(near.distance).toBeLessThan(farish.distance);
    expect(near.phone).toBeUndefined();
    expect(near.orderingOptions).toEqual([]);
  });

  it('falls back to Photon on non-2xx and on zero Overpass results', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) }).mockResolvedValueOnce(photonOk);
    expect((await searchPizzerias(LAT, LNG, 5000)).length).toBe(2);

    clearPizzeriaCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) }).mockResolvedValueOnce(photonOk);
    expect((await searchPizzerias(LAT, LNG, 5000)).length).toBe(2);
  });

  it('throws when both providers fail', async () => {
    fetchMock.mockRejectedValueOnce(abortErr()).mockRejectedValueOnce(abortErr());
    await expect(searchPizzerias(LAT, LNG, 5000)).rejects.toMatchObject({ name: 'PizzeriaSearchError', status: 504 });

    clearPizzeriaCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502 }).mockResolvedValueOnce({ ok: false, status: 500 });
    const err = await searchPizzerias(LAT, LNG, 5000).catch(e => e);
    expect(err).toBeInstanceOf(PizzeriaSearchError);
    expect(err.status).toBe(502);
  });

  it('caches results', async () => {
    fetchMock.mockResolvedValueOnce(overpassOk);
    await searchPizzerias(LAT, LNG, 5000);
    await searchPizzerias(LAT, LNG, 5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
