import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    next();
  },
}));
const decodeState = vi.hoisted(() => ({ width: 100, height: 100, decode: vi.fn() }));
vi.mock('heic-decode', () => {
  const all = vi.fn(async () => {
    const list: any = [{
      width: decodeState.width,
      height: decodeState.height,
      decode: async () => {
        decodeState.decode();
        return { width: 2, height: 2, data: new Uint8ClampedArray(16) };
      },
    }];
    list.dispose = () => {};
    return list;
  });
  return { default: Object.assign(vi.fn(), { all }) };
});
vi.mock('sharp', () => ({
  default: () => {
    const chain: any = { rotate: () => chain, resize: () => chain, jpeg: () => chain, toBuffer: async () => Buffer.from('out-jpeg') };
    return chain;
  },
}));

import heicRoutes, { looksLikeHeic, HEIC_UPLOAD_MAX_BYTES } from './heic.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use('/api/heic', heicRoutes);
app.use(errorHandler);

const heicBytes = () => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(16)]);

describe('looksLikeHeic', () => {
  it('accepts ftyp heic/mif1 and rejects others', () => {
    expect(looksLikeHeic(heicBytes())).toBe(true);
    expect(looksLikeHeic(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1')]))).toBe(true);
    expect(looksLikeHeic(Buffer.from('\xff\xd8\xff\xe0 not heic at all', 'latin1'))).toBe(false);
    expect(looksLikeHeic(Buffer.from('ftyp'))).toBe(false);
  });
});

describe('POST /api/heic/to-jpeg', () => {
  it('rejects unauthenticated callers', async () => {
    const res = await request(app).post('/api/heic/to-jpeg').set('Content-Type', 'application/octet-stream').send(heicBytes());
    expect(res.status).toBe(401);
  });

  it('rejects non-HEIC bytes', async () => {
    const res = await request(app)
      .post('/api/heic/to-jpeg')
      .set('x-user-id', 'u1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('GIF89a-not-a-heic-file-at-all'));
    expect(res.status).toBe(415);
  });

  it('rejects an empty body', async () => {
    const res = await request(app).post('/api/heic/to-jpeg').set('x-user-id', 'u1').set('Content-Type', 'application/octet-stream').send();
    expect(res.status).toBe(400);
  });

  it('rejects bodies over the cap', async () => {
    const res = await request(app)
      .post('/api/heic/to-jpeg')
      .set('x-user-id', 'u1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(HEIC_UPLOAD_MAX_BYTES + 1024));
    expect(res.status).toBe(413);
  });

  it('rejects declared dimensions over 100MP before decoding', async () => {
    decodeState.width = 20000;
    decodeState.height = 20000;
    decodeState.decode.mockClear();
    const res = await request(app)
      .post('/api/heic/to-jpeg')
      .set('x-user-id', 'u1')
      .set('Content-Type', 'application/octet-stream')
      .send(heicBytes());
    decodeState.width = 100;
    decodeState.height = 100;
    expect(res.status).toBe(413);
    expect(decodeState.decode).not.toHaveBeenCalled();
  });

  it('converts a valid HEIC to JPEG', async () => {
    const res = await request(app)
      .post('/api/heic/to-jpeg')
      .set('x-user-id', 'u1')
      .set('Content-Type', 'application/octet-stream')
      .send(heicBytes());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
  });
});
