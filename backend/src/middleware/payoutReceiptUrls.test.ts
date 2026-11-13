import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  collectPrivateReceiptPaths,
  replacePrivateReceiptPaths,
  unsignReceiptUrls,
  mountPayoutReceiptUrlMiddleware,
  ReceiptAccessDeps,
} from './payoutReceiptUrls.js';
import {
  isPrivateReceiptPath,
  partyIdFromPrivateReceiptPath,
  privatePathFromSignedUrl,
  buildReceiptUploadPath,
} from '../services/payoutReceiptStorage.service.js';

const PARTY = '0b6f3c2e-1d2a-4c5b-9e8f-7a6b5c4d3e2f';
const PDF = `payouts/${PARTY}/tmp-1/receipt/1700000000000-abc.pdf`;
const JPG = `payouts/${PARTY}/tmp-1/receipt/1700000000001-def.jpg`;
const LEGACY = `https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/event-images/payouts/${PARTY}/x/receipt/1.jpg`;
const signed = (p: string) =>
  `https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/sign/payout-receipts/${p}?token=abc.def`;

describe('payout receipt path helpers', () => {
  it('recognises bare private paths only', () => {
    expect(isPrivateReceiptPath(PDF)).toBe(true);
    expect(isPrivateReceiptPath(LEGACY)).toBe(false);
    expect(isPrivateReceiptPath('pizza-order://abc')).toBe(false);
    expect(isPrivateReceiptPath('payouts/not-a-uuid/x.jpg')).toBe(false);
    expect(isPrivateReceiptPath(`payouts/${PARTY}/../${PARTY}/x.jpg`)).toBe(false);
    expect(isPrivateReceiptPath(`payouts/${PARTY}/x.jpg?token=1`)).toBe(false);
    expect(partyIdFromPrivateReceiptPath(PDF)).toBe(PARTY);
  });

  it('extracts the path from our signed URLs only', () => {
    expect(privatePathFromSignedUrl(signed(PDF))).toBe(PDF);
    expect(privatePathFromSignedUrl(LEGACY)).toBeNull();
    expect(privatePathFromSignedUrl(`https://evil.example.com/storage/v1/object/sign/payout-receipts/${PDF}?token=x`)).toBeNull();
    expect(privatePathFromSignedUrl('not a url')).toBeNull();
  });

  it('builds server-chosen upload paths under the party folder', () => {
    const p = buildReceiptUploadPath(PARTY, '../../etc', 'PDF');
    expect(isPrivateReceiptPath(p)).toBe(true);
    expect(p.startsWith(`payouts/${PARTY}/etc/receipt/`)).toBe(true);
    expect(p.endsWith('.pdf')).toBe(true);
    expect(buildReceiptUploadPath(PARTY, 'g', 'exe').endsWith('.jpg')).toBe(true);
  });
});

describe('response signing', () => {
  it('collects paths only under receipt keys, plus PDF thumb siblings for `url`', () => {
    const body = {
      name: JPG, // not a receipt key: never signed
      notes: [PDF],
      payout: { externalProofUrl: JPG, documents: [{ url: PDF }, { url: LEGACY }] },
    };
    const paths = collectPrivateReceiptPaths(body);
    expect([...paths].sort()).toEqual([JPG, PDF, `${PDF}.thumb.png`].sort());
  });

  it('replaces paths copy-on-write and adds thumbUrl', () => {
    const doc = { id: 'd1', url: PDF };
    const untouched = { id: 'd2', url: LEGACY };
    const body = { documents: [doc, untouched], externalProofUrl: JPG, name: JPG };
    const map = new Map([
      [PDF, signed(PDF)],
      [`${PDF}.thumb.png`, signed(`${PDF}.thumb.png`)],
      [JPG, signed(JPG)],
    ]);
    const out = replacePrivateReceiptPaths(body, map) as any;
    expect(out.documents[0]).toEqual({ id: 'd1', url: signed(PDF), thumbUrl: signed(`${PDF}.thumb.png`) });
    expect(out.documents[1]).toBe(untouched);
    expect(out.externalProofUrl).toBe(signed(JPG));
    expect(out.name).toBe(JPG);
    // original not mutated
    expect(body.documents[0].url).toBe(PDF);
    expect((body.documents[0] as any).thumbUrl).toBeUndefined();
  });

  it('missing thumbnail → thumbUrl null; unauthorized path left as-is', () => {
    expect(replacePrivateReceiptPaths({ url: PDF }, new Map([[PDF, signed(PDF)]]))).toEqual({ url: signed(PDF), thumbUrl: null });
    expect(replacePrivateReceiptPaths({ url: PDF }, new Map())).toEqual({ url: PDF });
  });

  it('returns the same reference when nothing matches', () => {
    const body = { a: [1, 'x', { b: LEGACY }], d: new Date(0) };
    expect(replacePrivateReceiptPaths(body, new Map())).toBe(body);
  });
});

// ---- Mounted behaviour (routers, callers, party scoping) ----
const OTHER_PARTY = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const OTHER = `payouts/${OTHER_PARTY}/tmp-9/receipt/1700000000009-zzz.jpg`;

function makeApp(opts: { admin?: string[]; access?: Record<string, string[]> } = {}) {
  const deps: ReceiptAccessDeps = {
    isPaymentAdmin: async (email) => !!email && (opts.admin ?? []).includes(email),
    canAccessPartyReceipts: async (caller, partyId) =>
      !!caller.userEmail && (opts.access?.[caller.userEmail] ?? []).includes(partyId),
    signReceiptPaths: async (paths) => new Map([...paths].map((p) => [p, signed(p)])),
  };
  const app = express();
  app.use(express.json());
  // Stand-in for requireAuth.
  app.use((req, _res, next) => {
    const email = req.header('x-test-email');
    if (email) Object.assign(req, { userId: `u-${email}`, userEmail: email });
    next();
  });
  mountPayoutReceiptUrlMiddleware(app, deps);
  const echo = (req: express.Request, res: express.Response) => res.json({ body: req.body, query: req.query });
  app.get('/api/heic/convert', echo);
  app.patch('/api/users/me', echo);
  app.post('/api/admin/payouts/echo', echo);
  app.post('/api/parties/:partyId/payouts/echo', echo);
  app.post('/api/shipping/echo', echo);
  return app;
}

describe('mounted middleware', () => {
  it('does NOT un-sign the query on /api/heic/convert (HEIC lightbox needs the signed URL)', async () => {
    const res = await request(makeApp()).get('/api/heic/convert').query({ url: signed(PDF) });
    expect(res.body.query.url).toBe(signed(PDF));
  });

  it('un-signs round-tripped URLs on receipt routers', async () => {
    const res = await request(makeApp())
      .post(`/api/parties/${PARTY}/payouts/echo`)
      .send({ receiptPhotos: [{ url: signed(JPG) }] });
    // unauthenticated → echoed bare path is not re-signed
    expect(res.body.body.receiptPhotos[0].url).toBe(JPG);
  });

  it('is not a signing oracle on other routers (user name echo)', async () => {
    const res = await request(makeApp({ admin: ['a@x'] }))
      .patch('/api/users/me')
      .set('x-test-email', 'a@x')
      .send({ name: JPG, url: JPG });
    expect(res.body.body.name).toBe(JPG);
    expect(res.body.body.url).toBe(JPG);
  });

  it('signs only receipt keys, never e.g. a name, even for admins', async () => {
    const res = await request(makeApp({ admin: ['a@x'] }))
      .post('/api/admin/payouts/echo')
      .set('x-test-email', 'a@x')
      .send({ name: JPG, url: JPG });
    expect(res.body.body.name).toBe(JPG);
    expect(res.body.body.url).toBe(signed(JPG));
  });

  it('party router: only signs paths of the route party, for a caller with access', async () => {
    const app = makeApp({ access: { 'h@x': [PARTY] } });
    const ok = await request(app)
      .post(`/api/parties/${PARTY}/payouts/echo`)
      .set('x-test-email', 'h@x')
      .send({ mine: { url: JPG }, theirs: { url: OTHER } });
    expect(ok.body.body.mine.url).toBe(signed(JPG));
    expect(ok.body.body.theirs.url).toBe(OTHER); // cross-party: not signed

    // Same caller on another party's route: no access → nothing signed.
    const cross = await request(app)
      .post(`/api/parties/${OTHER_PARTY}/payouts/echo`)
      .set('x-test-email', 'h@x')
      .send({ url: OTHER });
    expect(cross.body.body.url).toBe(OTHER);
  });

  it('staff router: non-admin only gets parties they can access', async () => {
    const res = await request(makeApp({ access: { 'ub@x': [PARTY] } }))
      .post('/api/shipping/echo')
      .set('x-test-email', 'ub@x')
      .send({ docs: [{ url: JPG }, { url: OTHER }] });
    expect(res.body.body.docs[0].url).toBe(signed(JPG));
    expect(res.body.body.docs[1].url).toBe(OTHER);
  });

  it('unauthenticated callers get nothing signed', async () => {
    const res = await request(makeApp({ admin: ['a@x'] }))
      .post('/api/admin/payouts/echo')
      .send({ url: JPG });
    expect(res.body.body.url).toBe(JPG);
  });
});

describe('request un-signing', () => {
  it('turns our signed URLs back into bare paths', () => {
    const body = { receiptPhotos: [{ url: signed(PDF) }], imageUrl: signed(JPG), other: LEGACY };
    const out = unsignReceiptUrls(body) as any;
    expect(out.receiptPhotos[0].url).toBe(PDF);
    expect(out.imageUrl).toBe(JPG);
    expect(out.other).toBe(LEGACY);
    expect(body.imageUrl).toBe(signed(JPG));
  });
});
