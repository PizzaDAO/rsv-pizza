import { describe, it, expect, vi } from 'vitest';

const syncUpdate = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../config/database.js', () => ({ prisma: { pizzaLineSync: { update: syncUpdate } } }));
vi.mock('../lib/openai.js', () => ({ getOpenAI: () => { throw new Error('OpenAI must not be called in tests'); } }));
vi.mock('../lib/privateConfig.js', () => ({ getLlmModels: async () => ({ assistant: 'x', visionPrimary: 'y' }) }));
vi.mock('./ocr.service.js', () => ({ imageUrlToBase64DataUrl: async () => '' }));

import {
  applyLlmLine,
  parseTextPassResponse,
  parseVisionResponse,
  sizeFromModel,
  buildTextPassUser,
  recordPassError,
  MAX_PASS_ATTEMPTS,
  PASS_ERROR_BACKOFF_MS,
  type LlmLine,
} from './pizzaIndexLlm.service.js';
import type { DocContext, ExistingLine } from './pizzaLineSync.service.js';
import type { SizePreset } from './pizzaSize.service.js';

const presets: SizePreset[] = [
  { id: 'g-large', scope: 'global', merchantKey: null, country: null, sizeLabel: 'large', shape: 'round', diameterCm: 35, lengthCm: null, widthCm: null, sliceFraction: null },
];
const doc: DocContext = { documentId: 'd', partyId: 'p', country: 'Kenya', merchant: 'Pizza Inn', currency: 'KES', fxRate: 0.0077, discounts: [] };

const llm = (p: Partial<LlmLine>): LlmLine => ({
  i: 0, isPizza: true, sizeLabel: null, shape: null, diameterCm: null, lengthCm: null, widthCm: null,
  sliceFraction: null, isBundle: false, style: null, confidence: 0.9, reasoning: '', ...p,
});

function prevLine(p: Partial<ExistingLine> = {}): ExistingLine {
  return {
    id: 'row', lineIndex: 0, lineFingerprint: 'fp', sourceCategory: 'pizza', merchant: 'Pizza Inn', qty: 1,
    unitPriceList: 800, sizeLabel: null, shape: null, diameterCm: null, lengthCm: null, widthCm: null,
    sliceFraction: null, areaCm2: null, style: null, sizeSource: null, sizeConfidence: null, presetId: null,
    verifiedAt: null, verifiedBy: null, excluded: false, excludedReason: null, isBundle: false,
    outlierFlag: false, notes: null, ...p,
  };
}

describe('parseTextPassResponse', () => {
  it('parses tolerant JSON and drops unknown / duplicate indexes', () => {
    const out = parseTextPassResponse(JSON.stringify({
      lines: [
        { i: 0, isPizza: true, sizeLabel: 'Large', diameterCm: '33', confidence: 0.8, reasoning: 'x'.repeat(200) },
        { i: 0, isPizza: false },
        { i: 9, isPizza: true },
        { i: 1, isPizza: false, shape: 'weird' },
      ],
    }), new Set([0, 1]));
    expect(out).toHaveLength(2);
    expect(out[0].sizeLabel).toBe('large');
    expect(out[0].diameterCm).toBe(33);
    expect(out[0].reasoning).toHaveLength(80);
    expect(out[1].isPizza).toBe(false);
    expect(out[1].shape).toBeNull();
  });
  it('survives garbage', () => {
    expect(parseTextPassResponse('not json', new Set([0]))).toEqual([]);
    expect(parseTextPassResponse(null, new Set([0]))).toEqual([]);
    expect(parseTextPassResponse('{"lines": 5}', new Set([0]))).toEqual([]);
  });
});

describe('sizeFromModel', () => {
  it('caps LLM confidence at 0.7 and enforces bounds', () => {
    const r = sizeFromModel({ ...llm({ diameterCm: 33, confidence: 0.99 }) }, 0.7, presets, { merchantKey: null, country: null });
    expect(r?.sizeConfidence).toBe(0.7);
    expect(r?.sizeSource).toBe('llm');
    expect(sizeFromModel(llm({ diameterCm: 3 }), 0.7, presets, { merchantKey: null, country: null })).toBeNull();
  });
  it('falls back to a size-word preset when no dimensions', () => {
    const r = sizeFromModel(llm({ sizeLabel: 'large' }), 0.7, presets, { merchantKey: null, country: null });
    expect(r?.sizeSource).toBe('llm'); // LLM-supplied label: provenance is llm, preset link kept
    expect(r?.presetId).toBe('g-large');
    expect(r?.diameterCm).toBe(35);
    expect(r?.sizeConfidence).toBe(0.5); // min(preset 0.5, cap 0.7, model 0.9)
  });
});

describe('applyLlmLine', () => {
  it('never touches verified rows', () => {
    const r = applyLlmLine(llm({ diameterCm: 33 }), undefined, prevLine({ verifiedAt: new Date() }), doc, presets);
    expect(r.kind).toBe('none');
  });
  it('fills an unresolved row', () => {
    const r = applyLlmLine(llm({ diameterCm: 33 }), undefined, prevLine(), doc, presets);
    expect(r.kind).toBe('update');
    if (r.kind === 'update') expect(r.data.diameterCm).toBe(33);
  });
  it('does not override a higher-confidence parsed size', () => {
    const r = applyLlmLine(llm({ diameterCm: 33 }), undefined,
      prevLine({ sizeSource: 'parsed', sizeConfidence: 0.95, diameterCm: 30.5, areaCm2: 730.6 }), doc, presets);
    expect(r.kind).toBe('none');
  });
  it('sets is_bundle and excludes lines the model says are not pizza', () => {
    const b = applyLlmLine(llm({ isBundle: true }), undefined, prevLine({ sizeSource: 'parsed', sizeConfidence: 0.95 }), doc, presets);
    expect(b.kind === 'update' && b.data.isBundle).toBe(true);
    const n = applyLlmLine(llm({ isPizza: false }), undefined, prevLine(), doc, presets);
    expect(n.kind === 'update' && n.data.excludedReason).toBe('not_pizza');
  });
  it('promotes a pizza hiding in category "other" into a new row', () => {
    const item = { name: '5 X Regina Margherita con bufala', qty: 5, unitPrice: 12000, subtotal: 60000, category: 'other' };
    const r = applyLlmLine(llm({ i: 3, diameterCm: 32, confidence: 0.6 }), item, null, doc, presets);
    expect(r.kind).toBe('insert');
    if (r.kind === 'insert') {
      expect(r.write.lineIndex).toBe(3);
      expect(r.write.sourceCategory).toBe('other');
      expect(r.write.diameterCm).toBe(32);
      expect(r.write.sizeSource).toBe('llm');
      expect(r.write.sizeConfidence).toBe(0.6);
      expect(r.write.verifiedAt).toBeNull();
    }
  });
  it('ignores non-pizza lines that have no row', () => {
    expect(applyLlmLine(llm({ isPizza: false }), { name: 'Coke', category: 'other' }, null, doc, presets).kind).toBe('none');
  });
});

describe('vision parsing', () => {
  it('parses merchant, discounts (as positive amounts) and lines', () => {
    const v = parseVisionResponse(JSON.stringify({
      merchant: ' Pizza Inn ',
      discounts: [{ label: 'Promo', amount: -50 }, { label: 'bad', amount: 'x' }],
      lines: [{ i: 0, sizeLabel: 'large', diameterCm: 33, confidence: 0.9 }, { i: 7, diameterCm: 30 }],
    }), new Set([0]));
    expect(v.merchant).toBe('Pizza Inn');
    expect(v.discounts).toEqual([{ label: 'Promo', amount: 50 }]);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0].diameterCm).toBe(33);
  });
});

describe('prompt', () => {
  it('serializes receipt context', () => {
    const u = JSON.parse(buildTextPassUser({ merchant: 'M', country: 'Kenya', city: 'Nairobi', currency: 'KES', lines: [{ i: 0, name: 'x', qty: 1, unitPrice: 2, category: 'pizza' }] }));
    expect(u.lines[0].i).toBe(0);
    expect(u.country).toBe('Kenya');
  });
});

describe('pass back-off bookkeeping', () => {
  it('records a failed attempt and error time per pass', async () => {
    syncUpdate.mockClear();
    await recordPassError('doc1', 'llm');
    await recordPassError('doc2', 'vision');
    const [a, b] = syncUpdate.mock.calls.map((c: any) => c[0]);
    expect(a.where.documentId).toBe('doc1');
    expect(a.data.llmAttempts).toEqual({ increment: 1 });
    expect(a.data.llmLastErrorAt).toBeInstanceOf(Date);
    expect(b.data.visionAttempts).toEqual({ increment: 1 });
    expect(b.data.visionLastErrorAt).toBeInstanceOf(Date);
  });
  it('swallows bookkeeping failures', async () => {
    syncUpdate.mockRejectedValueOnce(new Error('db down'));
    await expect(recordPassError('doc3', 'llm')).resolves.toBeUndefined();
  });
  it('limits are 3 attempts / 1 hour', () => {
    expect(MAX_PASS_ATTEMPTS).toBe(3);
    expect(PASS_ERROR_BACKOFF_MS).toBe(3600000);
  });
});
