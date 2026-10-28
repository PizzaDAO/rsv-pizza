import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));
vi.mock('../lib/openai.js', () => ({ getOpenAI: () => { throw new Error('OpenAI must not be called in tests'); } }));

import {
  PHOTO_CONFIDENCE_CAP,
  parsePhotoPassResponse,
  pickPhotos,
  priceIsPlausible,
  readPhotoEstimate,
  toPhotoEstimate,
} from './pizzaPhotoPass.service.js';

describe('parsePhotoPassResponse', () => {
  const idx = new Set([0, 1, 2]);

  it('computes sizes from ratio x reference and caps confidence', () => {
    const out = parsePhotoPassResponse(JSON.stringify({
      lines: [
        { i: 0, photo: 1, ref: 'dinner_plate', shape: 'round', ratio: 1.3, confidence: 0.9, note: 'plate beside pie' },
        { i: 1, photo: 0, ref: 'phone_length', shape: 'rect', lengthRatio: 4, widthRatio: 2.5, confidence: 0.4, note: 'phone on tray' },
      ],
    }), idx, 2);
    expect(out).toEqual([
      { i: 0, photo: 1, shape: 'round', diameterCm: 33.8, lengthCm: null, widthCm: null, confidence: PHOTO_CONFIDENCE_CAP, note: 'plate beside pie [dinner plate]' },
      { i: 1, photo: 0, shape: 'rect', diameterCm: null, lengthCm: 60, widthCm: 37.5, confidence: 0.4, note: 'phone on tray [phone length]' },
    ]);
  });

  it('rejects pizza boxes / unknown references and model-supplied diameters', () => {
    const out = parsePhotoPassResponse(JSON.stringify({
      lines: [
        { i: 0, ref: 'pizza_box', shape: 'round', ratio: 1, confidence: 0.5 },
        { i: 1, ref: null, shape: 'round', diameterCm: 30, confidence: 0.5 },
      ],
    }), idx, 1);
    expect(out).toEqual([]);
  });

  it('drops implausible, unknown-index and duplicate entries', () => {
    const out = parsePhotoPassResponse(JSON.stringify({
      lines: [
        { i: 0, ref: 'dinner_plate', shape: 'round', ratio: null },
        { i: 1, ref: 'dinner_plate', shape: 'round', ratio: 10 },
        { i: 9, ref: 'dinner_plate', shape: 'round', ratio: 1.2 },
        { i: 2, ref: 'side_plate', shape: 'round', ratio: 1.5, photo: 7 },
        { i: 2, ref: 'side_plate', shape: 'round', ratio: 2 },
        { i: 1, ref: 'phone_length', shape: 'rect', lengthRatio: 3, widthRatio: null },
      ],
    }), idx, 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ i: 2, diameterCm: 30, photo: null });
  });

  it('returns [] for junk', () => {
    expect(parsePhotoPassResponse('not json', idx, 1)).toEqual([]);
    expect(parsePhotoPassResponse(null, idx, 1)).toEqual([]);
  });
});

describe('priceIsPlausible', () => {
  const line = (diameterCm: number) => ({ i: 0, photo: 0, shape: 'round' as const, diameterCm, lengthCm: null, widthCm: null, confidence: 0.5, note: '' });
  it('accepts a normal price for the size', () => {
    expect(priceIsPlausible(line(30), 10)).toBe(true); // ~$0.014/cm2
  });
  it('rejects a giant pizza matched to a cheap line', () => {
    expect(priceIsPlausible(line(100), 10)).toBe(false); // ~$0.0013/cm2
  });
  it('rejects a missing price', () => {
    expect(priceIsPlausible(line(30), 0)).toBe(false);
  });
});

describe('pickPhotos', () => {
  it('puts payout photos first, dedupes, and caps the count', () => {
    expect(pickPhotos(['a', 'b'], ['b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('photo estimate round-trip', () => {
  it('stores the measured photo url and reads it back', () => {
    const est = toPhotoEstimate(
      { i: 0, photo: 1, shape: 'round', diameterCm: 35, lengthCm: null, widthCm: null, confidence: 0.5, note: 'box' },
      ['u0', 'u1'], 'gpt-4o', new Date('2026-10-28T00:00:00Z'),
    );
    expect(est.photoUrl).toBe('u1');
    expect(readPhotoEstimate(JSON.parse(JSON.stringify(est)))).toEqual(est);
  });

  it('rejects malformed stored values', () => {
    expect(readPhotoEstimate(null)).toBeNull();
    expect(readPhotoEstimate({ shape: 'round', diameterCm: null })).toBeNull();
    expect(readPhotoEstimate({ shape: 'oval', diameterCm: 30 })).toBeNull();
  });
});
