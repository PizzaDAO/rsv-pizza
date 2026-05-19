import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  VDizzle7NFT@Gmail.COM ')).toBe('vdizzle7nft@gmail.com');
  });

  it('returns null for null/undefined/empty', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });

  it('preserves already-lowercase emails', () => {
    expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  });
});
