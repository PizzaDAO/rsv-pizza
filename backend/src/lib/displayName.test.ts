import { describe, it, expect } from 'vitest';
import { shortName } from './displayName.js';

describe('shortName', () => {
  it('first name + last initial', () => {
    expect(shortName('Jane Doe')).toBe('Jane D.');
  });
  it('keeps single-word names', () => {
    expect(shortName('Madonna')).toBe('Madonna');
  });
  it('trims and collapses extra spaces', () => {
    expect(shortName('  Jane   Doe  ')).toBe('Jane D.');
  });
  it('uses the last word for multi-part and hyphenated names', () => {
    expect(shortName('Mary Anne van Dyke')).toBe('Mary D.');
    expect(shortName('Jane Smith-Jones')).toBe('Jane S.');
  });
  it('uppercases the initial', () => {
    expect(shortName('jane doe')).toBe('jane D.');
  });
  it('empty / nullish -> Guest', () => {
    expect(shortName('')).toBe('Guest');
    expect(shortName('   ')).toBe('Guest');
    expect(shortName(null)).toBe('Guest');
    expect(shortName(undefined)).toBe('Guest');
  });
});
