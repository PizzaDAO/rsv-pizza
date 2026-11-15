import { describe, it, expect } from 'vitest';
import { BRAND } from '../../config/brand';
import { flyerEventUrl } from './flyerQr';
import { POSTER_CONFIG } from './configs/posterConfig';
import { ROLLUP_CONFIG } from './configs/rollupConfig';
import { AVAX_POSTER_CONFIG } from './configs/avaxPosterConfig';
import { AVAX_ROLLUP_CONFIG } from './configs/avaxRollupConfig';
import { DOGE_POSTER_CONFIG } from './configs/dogePosterConfig';
import { DOGE_ROLLUP_CONFIG } from './configs/dogeRollupConfig';
import { TEAM1_POSTER_CONFIG } from './configs/team1PosterConfig';
import { TEAM1_ROLLUP_CONFIG } from './configs/team1RollupConfig';
import { SWC_POSTER_CONFIG } from './configs/swcPosterConfig';
import { SWC_ROLLUP_CONFIG } from './configs/swcRollupConfig';

describe('flyerEventUrl', () => {
  it('prefers the custom URL slug on the brand domain', () => {
    expect(flyerEventUrl({ customUrl: 'paris', inviteCode: 'abc123' })).toBe(`${BRAND.url}/paris`);
  });
  it('falls back to the invite code', () => {
    expect(flyerEventUrl({ customUrl: null, inviteCode: 'abc123' })).toBe(`${BRAND.url}/abc123`);
  });
  it('returns null with no slug', () => {
    expect(flyerEventUrl({})).toBeNull();
  });
});

describe('flyer QR configs', () => {
  const configs = [POSTER_CONFIG, ROLLUP_CONFIG, AVAX_POSTER_CONFIG, AVAX_ROLLUP_CONFIG, DOGE_POSTER_CONFIG, DOGE_ROLLUP_CONFIG, TEAM1_POSTER_CONFIG, TEAM1_ROLLUP_CONFIG, SWC_POSTER_CONFIG, SWC_ROLLUP_CONFIG];

  it.each(configs.map((c) => [c.id, c] as const))('%s has an in-bounds, print-sized QR', (_id, c) => {
    const q = c.qr!;
    expect(q).toBeDefined();
    expect(q.x).toBeGreaterThanOrEqual(0);
    expect(q.y).toBeGreaterThanOrEqual(0);
    expect(q.x + q.size).toBeLessThanOrEqual(c.canvasWidth);
    expect(q.y + q.size).toBeLessThanOrEqual(c.canvasHeight);
    // Assume ~1080 canvas px across the printed width (poster 18in = 60px/in; rollup is wider, so larger in print).
    expect(q.size).toBeGreaterThanOrEqual(180);
  });

  it('doge QR stays clear of every doge-speak slot', () => {
    for (const c of [DOGE_POSTER_CONFIG, DOGE_ROLLUP_CONFIG]) {
      const q = c.qr!;
      for (const s of c.dogeSpeak!.slots) {
        const overlapX = s.x < q.x + q.size && s.x + s.maxWidth > q.x;
        const overlapY = s.y < q.y + q.size && s.y + s.fontSize * 1.4 > q.y;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('QR does not overlap the sponsor box', () => {
    for (const c of configs) {
      const q = c.qr!;
      const b = c.sponsorBox;
      const overlap = q.x < b.defaultX + b.width && q.x + q.size > b.defaultX && q.y < b.defaultY + b.height && q.y + q.size > b.defaultY;
      expect(overlap).toBe(false);
    }
  });
});
