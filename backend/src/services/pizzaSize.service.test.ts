import { describe, it, expect } from 'vitest';
import {
  parseSize,
  resolveSize,
  parseAndResolve,
  computeAreaCm2,
  lookupPreset,
  looksLikeBundle,
  normalizeMerchantKey,
  detectChainKey,
  resolveFromReportedDims,
  priceForDiameter,
  type SizePreset,
} from './pizzaSize.service.js';

let seq = 0;
function preset(p: Partial<SizePreset> & Pick<SizePreset, 'scope' | 'sizeLabel' | 'shape'>): SizePreset {
  return {
    id: `p${++seq}`, merchantKey: null, country: null, diameterCm: null, lengthCm: null,
    widthCm: null, sliceFraction: null, ...p,
  };
}

const GLOBALS: SizePreset[] = [
  preset({ scope: 'global', sizeLabel: 'personal', shape: 'round', diameterCm: 20 }),
  preset({ scope: 'global', sizeLabel: 'small', shape: 'round', diameterCm: 25 }),
  preset({ scope: 'global', sizeLabel: 'medium', shape: 'round', diameterCm: 30 }),
  preset({ scope: 'global', sizeLabel: 'regular', shape: 'round', diameterCm: 30 }),
  preset({ scope: 'global', sizeLabel: 'large', shape: 'round', diameterCm: 35 }),
  preset({ scope: 'global', sizeLabel: 'xl', shape: 'round', diameterCm: 40 }),
  preset({ scope: 'global', sizeLabel: 'family', shape: 'round', diameterCm: 40 }),
  preset({ scope: 'global', sizeLabel: 'mega', shape: 'round', diameterCm: 40 }),
  preset({ scope: 'global', sizeLabel: 'slice', shape: 'slice', diameterCm: 45, sliceFraction: 0.125 }),
];

describe('parseSize: real receipt strings (plan section 2)', () => {
  const cases: Array<[string, { label?: string | null; shape?: string | null; d?: number | null; explicit?: boolean }]> = [
    ['14" Shroom View', { label: '36cm', shape: 'round', d: 35.6, explicit: true }],
    ["Pesto & Basil Veg Pizza (Large Serves 4, 33 cm)", { label: 'large', shape: 'round', d: 33, explicit: true }],
    ['3 Cheese Pizza (12 Inch)', { label: '31cm', shape: 'round', d: 30.5, explicit: true }],
    ['Queen Margherita (10" Inch)', { label: '25cm', shape: 'round', d: 25.4, explicit: true }],
    ['Farm Fresh (Medium [Serve 2])', { label: 'medium', shape: null, d: null, explicit: false }],
    ['Personal Chicken Tikka Supreme', { label: 'personal', shape: null, explicit: false }],
    ['Signature Pizza 11" - Margherita', { label: '28cm', shape: 'round', d: 27.9, explicit: true }],
    ['X Large New York', { label: 'xl', shape: null, explicit: false }],
    ['16" Italian', { label: '41cm', shape: 'round', d: 40.6, explicit: true }],
    ['Family Supreme', { label: 'family', shape: null }],
    ['S&R Supreme New York', { label: null, shape: null }],
    ['Chic BBQ LG Promo', { label: 'large', shape: null }],
    ['Double Medium Pizza', { label: 'medium', shape: null }],
    ['Pizza Large', { label: 'large', shape: null }],
    ['Large Pan Pizza - Deluxe Cheese', { label: 'large', shape: null }],
    ['Omnivore LG', { label: 'large', shape: null }],
    ['5 Pepperoni LG', { label: 'large', shape: null }],
    ['MEGA JAMON (E)', { label: 'mega', shape: null }],
    ['P. Muzzarella', { label: null, shape: null }],
    ['P. Fugazzeta', { label: null, shape: null }],
    ['1/1 Calabresa com Mussarela', { label: null, shape: null }],
    ['PIZZA SICILIENNE', { label: null, shape: null }],
    ['6x 7. Cacciatore', { label: null, shape: null }],
    ['Պիցցա', { label: null, shape: null }],
    ['Pizzas', { label: null, shape: null }],
    ['Pizza Party', { label: null, shape: null }],
    ['Pizzas varias', { label: null, shape: null }],
  ];
  it.each(cases)('%s', (name, exp) => {
    const p = parseSize(name);
    if ('label' in exp) expect(p.label).toBe(exp.label);
    if ('shape' in exp) expect(p.shape).toBe(exp.shape);
    if ('d' in exp) expect(p.diameterCm).toBe(exp.d);
    if ('explicit' in exp) expect(p.explicit).toBe(exp.explicit);
  });
});

describe('parseSize: dimensions', () => {
  it('parses cm and inches variants', () => {
    expect(parseSize('Margherita 33 cm').diameterCm).toBe(33);
    expect(parseSize('Margherita 33cm').diameterCm).toBe(33);
    expect(parseSize('Pepperoni 12-inch').diameterCm).toBe(30.5);
    expect(parseSize('Pepperoni 12”').diameterCm).toBe(30.5);
    expect(parseSize("Pepperoni 12''").diameterCm).toBe(30.5);
    expect(parseSize('Pizza 16 pulgadas').diameterCm).toBe(40.6);
    expect(parseSize('Pizza 33,5 cm').diameterCm).toBe(33.5);
  });
  it('prefers a printed word as the label but keeps the explicit diameter', () => {
    const p = parseSize('Large (12 Inch)');
    expect(p.label).toBe('large');
    expect(p.diameterCm).toBe(30.5);
  });
  it('drops out-of-bounds round diameters and falls through', () => {
    expect(parseSize('Pizza 6 cm').explicit).toBe(false);
    expect(parseSize('Pizza 90 cm').explicit).toBe(false);
    expect(parseSize('Pizza 3"').explicit).toBe(false);
    // falls through to the size word
    const p = parseSize('Large Pizza 90 cm');
    expect(p.explicit).toBe(false);
    expect(p.label).toBe('large');
  });
  it('parses rectangles', () => {
    const p = parseSize('Sicilian Pan 30x40 cm');
    expect(p.shape).toBe('rect');
    expect(p.lengthCm).toBe(40);
    expect(p.widthCm).toBe(30);
    expect(computeAreaCm2({ shape: 'rect', lengthCm: p.lengthCm, widthCm: p.widthCm })).toBe(1200);
    const q = parseSize('Detroit 10 x 14"');
    expect(q.shape).toBe('rect');
    expect(q.lengthCm).toBe(35.6);
    expect(q.widthCm).toBe(25.4);
  });
  it('does not treat "6x 7. Cacciatore" (qty prefix) as a rectangle', () => {
    expect(parseSize('6x 7. Cacciatore').shape).toBeNull();
  });
  it('detects slices and half pizzas', () => {
    expect(parseSize('Pepperoni Slice').shape).toBe('slice');
    expect(parseSize('1 Porción Muzzarella').shape).toBe('slice');
    expect(parseSize('1/2 Calabresa').label).toBe('half');
    expect(parseSize('1/2 Calabresa').sliceFraction).toBe(0.5);
  });
  it('does not treat a slice COUNT as a single slice', () => {
    expect(parseSize('Large Pizza 8 slices').shape).toBeNull();
    expect(parseSize('Large Pizza 8 slices').label).toBe('large');
  });
});

describe('parseSize: single-letter guard', () => {
  it('counts S/M/L only when standing alone at the end of the name', () => {
    expect(parseSize('Pepperoni L').label).toBe('large');
    expect(parseSize('Margherita (M)').label).toBe('medium');
    expect(parseSize('Veggie - S').label).toBe('small');
  });
  it('ignores single letters inside words/abbreviations', () => {
    expect(parseSize('S&R Supreme').label).toBeNull();
    expect(parseSize('Pizza M Special Deluxe').label).toBeNull();
    expect(parseSize('pepperoni l').label).toBeNull(); // lowercase never counts
    expect(parseSize('L Special Pizza').label).toBeNull();
  });
});

describe('style detection', () => {
  it('detects styles', () => {
    expect(parseSize('Large Pan Pizza').style).toBe('pan');
    expect(parseSize('X Large New York').style).toBe('ny');
    expect(parseSize('PIZZA SICILIENNE').style).toBe('sicilian');
    expect(parseSize('Detroit Style').style).toBe('detroit');
    expect(parseSize('Margherita Napoletana').style).toBe('neapolitan');
  });
});

describe('bundle detection', () => {
  it.each([
    'Pizza Party', 'Promoción Pizza Libre + 1 consumición x 50', 'Pizzas varias',
    'All You Can Eat Pizza', 'Rodizio de pizza',
  ])('flags %s', (n) => expect(looksLikeBundle(n)).toBe(true));
  it.each(['Pizzas', '3 Cheese Pizza (12 Inch)', 'Pizza Large', 'Margherita'])(
    'does not flag %s', (n) => expect(looksLikeBundle(n)).toBe(false));
});

describe('area math', () => {
  it('round', () => {
    expect(computeAreaCm2({ shape: 'round', diameterCm: 30 })).toBe(706.9);
    expect(computeAreaCm2({ shape: 'round', diameterCm: 25 })).toBe(490.9);
  });
  it('rect', () => expect(computeAreaCm2({ shape: 'rect', lengthCm: 40, widthCm: 30 })).toBe(1200));
  it('slice = fraction of parent pie', () => {
    expect(computeAreaCm2({ shape: 'slice', diameterCm: 45, sliceFraction: 0.125 })).toBe(198.8);
  });
  it('null when unusable', () => {
    expect(computeAreaCm2({ shape: 'round' })).toBeNull();
    expect(computeAreaCm2({ shape: 'slice', diameterCm: 45 })).toBeNull();
    expect(computeAreaCm2({ shape: 'other' })).toBeNull();
  });
  it('priceForDiameter scales by area', () => {
    expect(priceForDiameter(0.02, 30)).toBeCloseTo(14.14, 2);
  });
});

describe('preset precedence', () => {
  const merchantLarge = preset({ scope: 'merchant', merchantKey: 'la pinoz pizza', sizeLabel: 'large', shape: 'round', diameterCm: 33 });
  const countryLarge = preset({ scope: 'country', country: 'India', sizeLabel: 'large', shape: 'round', diameterCm: 32 });
  const chainLarge = preset({ scope: 'chain', merchantKey: 'dominos', sizeLabel: 'large', shape: 'round', diameterCm: 34 });
  const all = [...GLOBALS, countryLarge, chainLarge, merchantLarge];

  it('merchant beats chain beats country beats global', () => {
    expect(lookupPreset(all, 'large', { merchantKey: 'la pinoz pizza', country: 'India' })?.preset.id).toBe(merchantLarge.id);
    expect(lookupPreset(all, 'large', { merchantKey: 'dominos pizza', country: 'India' })?.preset.id).toBe(chainLarge.id);
    expect(lookupPreset(all, 'large', { merchantKey: 'some place', country: 'India' })?.preset.id).toBe(countryLarge.id);
    expect(lookupPreset(all, 'large', { merchantKey: 'some place', country: 'Peru' })?.preset.scope).toBe('global');
  });
  it('confidences', () => {
    expect(lookupPreset(all, 'large', { merchantKey: 'la pinoz pizza' })?.confidence).toBe(0.85);
    expect(lookupPreset(all, 'large', { merchantKey: 'dominos' })?.confidence).toBe(0.8);
    expect(lookupPreset(all, 'large', { country: 'India' })?.confidence).toBe(0.6);
    expect(lookupPreset(all, 'large', {})?.confidence).toBe(0.5);
  });
  it("'default' is never satisfied by a global preset", () => {
    expect(lookupPreset(GLOBALS, 'default', { country: 'India' })).toBeNull();
  });
  it('detects chains regardless of branch suffix', () => {
    expect(detectChainKey("domino's pizza ikeja")).toBe('dominos');
    expect(detectChainKey('pizza hut manila')).toBe('pizza hut');
    expect(detectChainKey('joe s pizzeria')).toBeNull();
  });
});

describe('resolveSize', () => {
  it('explicit dimensions win over presets (parsed, 0.95)', () => {
    const { resolved } = parseAndResolve('Pesto & Basil Veg Pizza (Large Serves 4, 33 cm)', GLOBALS, { country: 'India' });
    expect(resolved.sizeSource).toBe('parsed');
    expect(resolved.sizeConfidence).toBe(0.95);
    expect(resolved.diameterCm).toBe(33);
    expect(resolved.areaCm2).toBe(855.3);
  });
  it('size word resolves through the country preset (0.6) before global (0.5)', () => {
    const india = [...GLOBALS, preset({ scope: 'country', country: 'India', sizeLabel: 'medium', shape: 'round', diameterCm: 25 })];
    const a = parseAndResolve('Farm Fresh (Medium [Serve 2])', india, { country: 'India' }).resolved;
    expect(a.diameterCm).toBe(25);
    expect(a.sizeSource).toBe('preset');
    expect(a.sizeConfidence).toBe(0.6);
    const b = parseAndResolve('Farm Fresh (Medium [Serve 2])', india, { country: 'Peru' }).resolved;
    expect(b.diameterCm).toBe(30);
    expect(b.sizeConfidence).toBe(0.5);
  });
  it('no size cue + no default preset = unresolved', () => {
    const r = parseAndResolve('S&R Supreme New York', GLOBALS, { country: 'Philippines' }).resolved;
    expect(r.areaCm2).toBeNull();
    expect(r.sizeSource).toBeNull();
    expect(r.style).toBe('ny');
  });
  it("no size cue + country 'default' preset resolves (Argentina molde)", () => {
    const ar = [...GLOBALS, preset({ scope: 'country', country: 'Argentina', sizeLabel: 'default', shape: 'round', diameterCm: 35 })];
    const r = parseAndResolve('P. Muzzarella', ar, { country: 'Argentina' }).resolved;
    expect(r.diameterCm).toBe(35);
    expect(r.sizeLabel).toBe('default');
  });
  it('a merchant default beats everything for an unlabeled line', () => {
    const ps = [...GLOBALS, preset({ scope: 'merchant', merchantKey: 'napoli', sizeLabel: 'default', shape: 'round', diameterCm: 31 })];
    const r = parseAndResolve('Margherita', ps, { merchantKey: 'napoli' }).resolved;
    expect(r.diameterCm).toBe(31);
    expect(r.sizeConfidence).toBe(0.85);
  });
  it('slice uses the slice preset (1/8 of 45 cm)', () => {
    const r = parseAndResolve('Pepperoni Slice', GLOBALS, {}).resolved;
    expect(r.shape).toBe('slice');
    expect(r.areaCm2).toBe(198.8);
  });
  it('half pizza = 0.5 of the labeled pie', () => {
    const r = parseAndResolve('1/2 Calabresa', GLOBALS, { country: 'Brazil' }).resolved;
    expect(r.shape).toBe('slice');
    expect(r.sliceFraction).toBe(0.5);
    expect(r.areaCm2).toBe(353.4); // half of a 30 cm pie
  });
  it('rect from parsed dims', () => {
    const r = resolveSize(parseSize('Sicilian 30x40 cm'), GLOBALS);
    expect(r.shape).toBe('rect');
    expect(r.areaCm2).toBe(1200);
  });
});

describe('merchant key', () => {
  it('normalizes', () => {
    expect(normalizeMerchantKey("La Pino'z Pizza!")).toBe('la pino z pizza');
    expect(normalizeMerchantKey('  PIZZERÍA   Ñandú ')).toBe('pizzeria nandu');
    expect(normalizeMerchantKey(null)).toBeNull();
    expect(normalizeMerchantKey('***')).toBeNull();
  });
});

describe('resolveFromReportedDims (llm/vision/ocr)', () => {
  it('accepts sane round dims and caps nothing itself', () => {
    const r = resolveFromReportedDims({ diameterCm: 33 }, 0.7, 'llm');
    expect(r?.shape).toBe('round');
    expect(r?.areaCm2).toBe(855.3);
    expect(r?.sizeSource).toBe('llm');
  });
  it('rejects out-of-bounds', () => {
    expect(resolveFromReportedDims({ diameterCm: 5 }, 0.7, 'llm')).toBeNull();
    expect(resolveFromReportedDims({ diameterCm: 120 }, 0.7, 'llm')).toBeNull();
    expect(resolveFromReportedDims({}, 0.7, 'llm')).toBeNull();
  });
  it('rect + slice', () => {
    expect(resolveFromReportedDims({ shape: 'rect', lengthCm: 40, widthCm: 30 }, 0.6, 'llm')?.areaCm2).toBe(1200);
    expect(resolveFromReportedDims({ shape: 'slice', diameterCm: 45, sliceFraction: 0.125 }, 0.6, 'llm')?.areaCm2).toBe(198.8);
  });
});
