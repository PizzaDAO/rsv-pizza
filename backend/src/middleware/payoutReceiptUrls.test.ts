import { describe, it, expect } from 'vitest';
import {
  collectPrivateReceiptPaths,
  replacePrivateReceiptPaths,
  unsignReceiptUrls,
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
  it('collects paths and PDF thumb siblings for `url` keys', () => {
    const body = { payout: { externalProofUrl: JPG, documents: [{ url: PDF }, { url: LEGACY }] } };
    const paths = collectPrivateReceiptPaths(body);
    expect([...paths].sort()).toEqual([JPG, PDF, `${PDF}.thumb.png`].sort());
  });

  it('replaces paths copy-on-write and adds thumbUrl', () => {
    const doc = { id: 'd1', url: PDF };
    const untouched = { id: 'd2', url: LEGACY };
    const body = { documents: [doc, untouched], proof: JPG };
    const map = new Map([
      [PDF, signed(PDF)],
      [`${PDF}.thumb.png`, signed(`${PDF}.thumb.png`)],
      [JPG, signed(JPG)],
    ]);
    const out = replacePrivateReceiptPaths(body, map) as any;
    expect(out.documents[0]).toEqual({ id: 'd1', url: signed(PDF), thumbUrl: signed(`${PDF}.thumb.png`) });
    expect(out.documents[1]).toBe(untouched);
    expect(out.proof).toBe(signed(JPG));
    // original not mutated
    expect(body.documents[0].url).toBe(PDF);
    expect((body.documents[0] as any).thumbUrl).toBeUndefined();
  });

  it('missing thumbnail → thumbUrl null; unsigned path left as-is', () => {
    const out = replacePrivateReceiptPaths({ url: PDF }, new Map()) as any;
    expect(out).toEqual({ url: PDF, thumbUrl: null });
  });

  it('returns the same reference when nothing matches', () => {
    const body = { a: [1, 'x', { b: LEGACY }], d: new Date(0) };
    expect(replacePrivateReceiptPaths(body, new Map())).toBe(body);
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
