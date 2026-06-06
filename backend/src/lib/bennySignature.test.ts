import { describe, it, expect } from 'vitest';
import { BENNY_SIGNATURE, withBennySignature } from './bennySignature.js';

describe('withBennySignature', () => {
  it('appends the signature on its own line', () => {
    expect(withBennySignature('Pizza payment sent!')).toBe(
      `Pizza payment sent!\n\n${BENNY_SIGNATURE}`,
    );
  });
  it('is idempotent', () => {
    const once = withBennySignature('hi');
    expect(withBennySignature(once)).toBe(once);
  });
  it('treats trailing whitespace after an existing signature as already signed', () => {
    const signed = `hi\n\n${BENNY_SIGNATURE}\n`;
    expect(withBennySignature(signed)).toBe(signed);
  });
  it('tolerates empty input', () => {
    expect(withBennySignature('')).toBe(`\n\n${BENNY_SIGNATURE}`);
  });
});
