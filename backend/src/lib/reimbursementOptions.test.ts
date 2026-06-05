import { describe, it, expect } from 'vitest';
import { resolveReimbursementOptions } from './reimbursementOptions.js';
import type { ReimbursementRules } from './privateConfig.js';

const RULES: ReimbursementRules = {
  methods: [
    { id: 'usdc_base', label: 'USDC on Base', kind: 'method' },
    { id: 'mercury_card', label: 'Mercury virtual card', kind: 'method' },
    { id: 'wire', label: 'Bank wire', kind: 'method' },
    { id: 'swc_hub', label: 'Pay via your hub', description: 'Your hub handles it.', kind: 'external', url: '' },
  ],
  default: ['usdc_base', 'mercury_card', 'wire'],
  countryRules: [
    // country match → restrict to the external hub card only
    { match: { country: 'Exampleland' }, visible: ['swc_hub'] },
    // country match → mercury disabled with a reason
    {
      match: { country: 'Blockistan' },
      disable: [{ id: 'mercury_card', reason: 'Mercury unavailable in Blockistan.' }],
    },
    // tag match → restrict to the hub card
    { match: { tag: 'hub-only' }, visible: ['swc_hub'] },
  ],
};

describe('resolveReimbursementOptions', () => {
  it('no match → returns the default methods in methods[] order, all enabled', () => {
    const out = resolveReimbursementOptions({ country: 'Nowhereland', eventTags: [] }, RULES);
    expect(out.map((o) => o.id)).toEqual(['usdc_base', 'mercury_card', 'wire']);
    expect(out.every((o) => o.enabled)).toBe(true);
    expect(out.every((o) => o.disabledReason === undefined)).toBe(true);
  });

  it('a visible rule → restricts to exactly that id', () => {
    const out = resolveReimbursementOptions({ country: 'Exampleland' }, RULES);
    expect(out.map((o) => o.id)).toEqual(['swc_hub']);
    expect(out[0].kind).toBe('external');
    expect(out[0].enabled).toBe(true);
  });

  it('a disable rule → method present but enabled:false with reason', () => {
    const out = resolveReimbursementOptions({ country: 'Blockistan' }, RULES);
    expect(out.map((o) => o.id)).toEqual(['usdc_base', 'mercury_card', 'wire']);
    const mercury = out.find((o) => o.id === 'mercury_card')!;
    expect(mercury.enabled).toBe(false);
    expect(mercury.disabledReason).toBe('Mercury unavailable in Blockistan.');
    // others stay enabled
    expect(out.find((o) => o.id === 'usdc_base')!.enabled).toBe(true);
  });

  it('tag match path → restricts via eventTags', () => {
    const out = resolveReimbursementOptions({ country: 'Nowhereland', eventTags: ['hub-only'] }, RULES);
    expect(out.map((o) => o.id)).toEqual(['swc_hub']);
  });

  it('empty/unseeded config → returns []', () => {
    const out = resolveReimbursementOptions(
      { country: 'Anywhere' },
      { methods: [], default: [], countryRules: [] }
    );
    expect(out).toEqual([]);
  });

  it('visible ids not present in methods are dropped', () => {
    const rules: ReimbursementRules = {
      methods: [{ id: 'usdc_base', label: 'USDC', kind: 'method' }],
      default: ['usdc_base'],
      countryRules: [{ match: { country: 'X' }, visible: ['ghost', 'usdc_base'] }],
    };
    const out = resolveReimbursementOptions({ country: 'X' }, rules);
    expect(out.map((o) => o.id)).toEqual(['usdc_base']);
  });
});
