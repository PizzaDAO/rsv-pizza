import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  generateW9PDF,
  generateW8BENPDF,
  generateW8BENEPDF,
} from './taxFormPdf.service.js';
import { sanitizeForFont, embedSafeStandard, embedUnicodeFonts } from '../lib/pdfFonts.js';

const NAMES = [
  'Kristina Weiserová',
  'Křižíkova 12, Praha',
  'Олексій Андрієнко',
  'Łódź',
  'İstanbul Şişli',
  'Nguyễn',
  '王小明',
  '🍕',
  'Σωκράτης',
];

async function expectPdf(buf: Buffer) {
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const doc = await PDFDocument.load(buf);
  expect(doc.getPageCount()).toBeGreaterThan(0);
}

describe('tax form PDFs with non-Latin text', () => {
  for (const name of NAMES) {
    it(`W-9 / W-8BEN / W-8BEN-E render "${name}"`, async () => {
      const w9 = {
        name, businessName: name, taxClassification: 'individual', address: name,
        city: name, state: name, zipCode: '11000', accountNumbers: name, ssn: '123456789',
        signature: name, date: '2026-11-21', exemptPayeeCode: 'x', fatcaCode: 'x',
      };
      await expectPdf(await generateW9PDF(w9 as any, 'ref-1'));

      const w8 = {
        name, citizenship: name, permanentAddress: name, permanentCity: name,
        permanentStateProvince: name, permanentPostalCode: name, permanentCountry: name,
        mailingAddress: name, mailingCity: name, mailingCountry: name, foreignTin: name,
        referenceNumbers: name, dateOfBirth: '1990-01-01', treatyCountry: name,
        articleParagraph: name, withholdingRate: '0', incomeType: name, treatyExplanation: name,
        signature: name, date: '2026-11-21',
      };
      await expectPdf(await generateW8BENPDF(w8 as any, 'ref-2'));

      const w8e = {
        ...w8, entityName: name, countryOfIncorporation: name, disregardedEntityName: name,
        entityType: 'corporation', chapter4Status: 'active_nffe', giin: name, signerCapacity: name,
      };
      await expectPdf(await generateW8BENEPDF(w8e as any, 'ref-3'));
    });
  }
});

describe('embedUnicodeFonts', () => {
  it('uses Noto Sans and keeps Latin Ext / Cyrillic / Greek / Vietnamese glyphs', async () => {
    const doc = await PDFDocument.create();
    const { font } = await embedUnicodeFonts(doc);
    const set = new Set(font.getCharacterSet());
    for (const ch of 'řłŞİ\u1EC5Жїςé') expect(set.has(ch.codePointAt(0)!)).toBe(true);
    expect(set.has(0x738b)).toBe(false); // CJK degrades to '?', never throws
  });
});

describe('sanitizeForFont', () => {
  const ascii = (ch: string) => ch.codePointAt(0)! < 128;
  it('transliterates diacritics and replaces unknown chars with ?', () => {
    expect(sanitizeForFont('Weiserová Łódź', ascii)).toBe('Weiserova ?odz');
    expect(sanitizeForFont('王🍕a', ascii)).toBe('??a');
  });
  it('sanitized Helvetica never throws', async () => {
    const doc = await PDFDocument.create();
    const f = await embedSafeStandard(doc, StandardFonts.Helvetica);
    const page = doc.addPage();
    expect(() => page.drawText('Křižíkova 王 🍕', { font: f, size: 10 })).not.toThrow();
    expect(f.widthOfTextAtSize('ř', 10)).toBeGreaterThan(0);
  });
});
