import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('../config/database.js', () => ({ prisma: {} }));

import { processBrandImage, sniffBrandImage, isAllowedAssetUrl, isTmpPathFor, SLOT_SPECS } from './brandAssets.js';
import { sanitizeFlyerArt } from './flyerArt.js';

const S = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const base = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } });

describe('processBrandImage', () => {
  it('logo: fits inside 1024x512, never enlarges', async () => {
    const big = await processBrandImage(await base(3000, 1000).png().toBuffer(), 'logo');
    expect([big.width, big.height]).toEqual([1024, 341]);
    const small = await processBrandImage(await base(100, 50).png().toBuffer(), 'logo');
    expect([small.width, small.height]).toEqual([100, 50]);
  });

  it('favicon/og/flyers are exactly the slot size (cover)', async () => {
    const src = await base(1500, 900).jpeg().toBuffer();
    for (const slot of ['favicon', 'og', 'flyerPoster', 'flyerRollup'] as const) {
      const r = await processBrandImage(src, slot);
      expect([r.width, r.height]).toEqual([SLOT_SPECS[slot].width, SLOT_SPECS[slot].height]);
    }
    expect((await processBrandImage(src, 'og')).data.length).toBeLessThanOrEqual(1024 * 1024);
  });

  it('strips EXIF metadata', async () => {
    const withExif = await base(200, 200).jpeg().withExif({ IFD0: { Copyright: 'secret-author' } }).toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processBrandImage(withExif, 'logo');
    expect((await sharp(out.data).metadata()).exif).toBeUndefined();
    expect(out.data.includes(Buffer.from('secret-author'))).toBe(false);
  });

  it('refuses SVG, GIF, AVIF, junk and empty input', async () => {
    const bad = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
      Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;;;;;;;;'),
      Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif'), Buffer.alloc(20)]),
      Buffer.from('not an image at all, just text'),
      Buffer.alloc(0),
    ];
    for (const b of bad) await expect(processBrandImage(b, 'logo')).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });

  it('refuses animated WebP', async () => {
    // Hand-assembled 2-frame animated WebP (VP8X + ANIM + 2x ANMF around a lossless VP8L frame).
    const frame = (await base(20, 20).webp({ lossless: true }).toBuffer()).subarray(12);
    const le = (n: number, bytes: number) => Buffer.from(Array.from({ length: bytes }, (_, i) => (n >> (8 * i)) & 0xff));
    const chunk = (tag: string, body: Buffer) => Buffer.concat([Buffer.from(tag, 'latin1'), le(body.length, 4), body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const anmf = chunk('ANMF', Buffer.concat([le(0, 3), le(0, 3), le(19, 3), le(19, 3), le(100, 3), Buffer.alloc(1), frame]));
    const payload = Buffer.concat([
      Buffer.from('WEBP', 'latin1'),
      chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), le(19, 3), le(19, 3)])),
      chunk('ANIM', Buffer.concat([Buffer.alloc(4), le(0, 2)])),
      anmf, anmf,
    ]);
    const animated = Buffer.concat([Buffer.from('RIFF', 'latin1'), le(payload.length, 4), payload]);
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(processBrandImage(animated, 'logo')).rejects.toMatchObject({ code: 'BAD_FILE_TYPE' });
  });

  it('refuses truncated PNGs and over-limit dimensions', async () => {
    const good = await base(50, 50).png().toBuffer();
    await expect(processBrandImage(good.subarray(0, 40), 'logo')).rejects.toMatchObject({ code: 'BAD_FILE_TYPE' });
    const huge = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(processBrandImage(huge, 'logo')).rejects.toMatchObject({ code: 'BAD_FILE_TYPE' }); // 49 MP > 40 MP limit
  });
});

describe('sniff and paths', () => {
  it('only png/jpeg/webp', async () => {
    expect(sniffBrandImage(await base(5, 5).png().toBuffer())).toBe('image/png');
    expect(sniffBrandImage(await base(5, 5).jpeg().toBuffer())).toBe('image/jpeg');
    expect(sniffBrandImage(await base(5, 5).webp().toBuffer())).toBe('image/webp');
    expect(sniffBrandImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
  it('tmp path must be this series', () => {
    const u = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
    expect(isTmpPathFor(`${S}/tmp/${u}.png`, S)).toBe(true);
    expect(isTmpPathFor(`${O}/tmp/${u}.png`, S)).toBe(false);
    expect(isTmpPathFor(`${S}/tmp/../${O}/tmp/${u}.png`, S)).toBe(false);
    expect(isTmpPathFor(`${S}/tmp/${u}.svg`, S)).toBe(false);
  });
});

describe('asset URL + flyer_art validation', () => {
  it('only this series /cdn path; legacy /brands only for super-admins; no remote urls', () => {
    expect(isAllowedAssetUrl(`/cdn/brand-assets/${S}/logo/x.png`, S, false)).toBe(true);
    expect(isAllowedAssetUrl(`/cdn/brand-assets/${O}/logo/x.png`, S, true)).toBe(false);
    expect(isAllowedAssetUrl('https://example.org/x.png', S, true)).toBe(false);
    expect(isAllowedAssetUrl('//example.org/x.png', S, true)).toBe(false);
    expect(isAllowedAssetUrl(`/cdn/brand-assets/${S}/../${O}/x.png`, S, false)).toBe(false);
    expect(isAllowedAssetUrl('/brands/acme/logo.png', S, false)).toBe(false);
    expect(isAllowedAssetUrl('/brands/acme/logo.png', S, true)).toBe(true);
  });

  it('sanitizeFlyerArt keeps the known shape and drops everything else', () => {
    expect(sanitizeFlyerArt(null)).toBeNull();
    expect(sanitizeFlyerArt([1])).toBeNull();
    expect(sanitizeFlyerArt({ poster: 'javascript:alert(1)', rollup: 'data:text/html,x' })).toBeNull();
    expect(sanitizeFlyerArt({ poster: '//evil.example.org/x.png' })).toBeNull();
    expect(sanitizeFlyerArt({ poster: '/cdn/brand-assets/a/b.png', evil: '<script>', bespokeKey: 'doge' })).toEqual({ poster: '/cdn/brand-assets/a/b.png', bespokeKey: 'doge' });
    expect(sanitizeFlyerArt({ bespokeKey: 'Bad Key!' })).toBeNull();
    expect(sanitizeFlyerArt({ poster: 'https://example.org/' + 'a'.repeat(3000) })).toBeNull();
  });
});
