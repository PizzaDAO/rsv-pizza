import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));
vi.mock('../lib/openai.js', () => ({ getOpenAI: () => { throw new Error('OpenAI must not be called in tests'); } }));

import {
  PHOTO_CONFIDENCE_CAP,
  parsePhotoPassResponse,
  pickPhotos,
  readPhotoEstimate,
  toPhotoEstimate,
} from './pizzaPhotoPass.service.js';

describe('parsePhotoPassResponse', () => {
  const idx = new Set([0, 1, 2]);

  it('keeps plausible round and rect estimates and caps confidence', () => {
    const out = parsePhotoPassResponse(JSON.stringify({
      lines: [
        { i: 0, photo: 1, shape: 'round', diameterCm: 33.33, confidence: 0.9, note: 'next to a dinner plate' },
        { i: 1, photo: 0, shape: 'rect', lengthCm: 60, widthCm: 40, confidence: 0.4, note: 'sheet pan' },
      ],
    }), idx, 2);
    expect(out).toEqual([
      { i: 0, photo: 1, shape: 'round', diameterCm: 33.3, lengthCm: null, widthCm: null, confidence: PHOTO_CONFIDENCE_CAP, note: 'next to a dinner plate' },
      { i: 1, photo: 0, shape: 'rect', diameterCm: null, lengthCm: 60, widthCm: 40, confidence: 0.4, note: 'sheet pan' },
    ]);
  });

  it('drops null, implausible, unknown-index and duplicate entries', () => {
    const out = parsePhotoPassResponse(JSON.stringify({
      lines: [
        { i: 0, shape: 'round', diameterCm: null, confidence: 0.5 },
        { i: 1, shape: 'round', diameterCm: 400, confidence: 0.5 },
        { i: 9, shape: 'round', diameterCm: 30, confidence: 0.5 },
        { i: 2, shape: 'round', diameterCm: 30, confidence: 0.5, photo: 7 },
        { i: 2, shape: 'round', diameterCm: 45, confidence: 0.5 },
        { i: 1, shape: 'rect', lengthCm: 50, widthCm: null },
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
