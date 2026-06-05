import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './ocr.service.js';

describe('buildSystemPrompt country currency prior', () => {
  // calzone-58294: `parties.country` stores full English names, not ISO-2.
  // The prior must resolve those via getCountryCode rather than slicing.
  it('resolves full-name countries to their primary currency', () => {
    expect(buildSystemPrompt('Togo')).toContain('XOF');
    expect(buildSystemPrompt('Mexico')).toContain('MXN');
    expect(buildSystemPrompt('United States')).toContain('USD');
  });

  it('still accepts a bare ISO-2 code (back-compat)', () => {
    expect(buildSystemPrompt('TG')).toContain('XOF');
    expect(buildSystemPrompt('mx')).toContain('MXN');
  });

  it('omits the country prior when country is unknown/empty', () => {
    const prompt = buildSystemPrompt('Atlantis');
    expect(prompt).not.toContain('the primary currency in');
    expect(buildSystemPrompt(null)).not.toContain('the primary currency in');
    expect(buildSystemPrompt(undefined)).not.toContain('the primary currency in');
  });

  it('does not mis-key "Togo" as Tonga (TO)', () => {
    // "Togo".slice(0,2) === "TO" (Tonga, absent from the map) was the bug.
    const prompt = buildSystemPrompt('Togo');
    expect(prompt).toContain('this receipt is from TG');
  });
});
