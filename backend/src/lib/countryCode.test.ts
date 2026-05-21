import { describe, it, expect, vi } from 'vitest';
import { getCountryCode } from './countryCode.js';

describe('getCountryCode', () => {
  it('returns ISO2 for canonical English names', () => {
    expect(getCountryCode('United Kingdom')).toBe('GB');
    expect(getCountryCode('Brazil')).toBe('BR');
    expect(getCountryCode('United States')).toBe('US');
    expect(getCountryCode('India')).toBe('IN');
  });

  it('handles localized aliases seen in production', () => {
    expect(getCountryCode('Deutschland')).toBe('DE');
    expect(getCountryCode('Brasil')).toBe('BR');
    expect(getCountryCode('Türkiye')).toBe('TR');
    expect(getCountryCode('México')).toBe('MX');
    expect(getCountryCode('日本')).toBe('JP');
    expect(getCountryCode('България')).toBe('BG');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(getCountryCode('  brazil ')).toBe('BR');
    expect(getCountryCode('UNITED KINGDOM')).toBe('GB');
  });

  it('returns null for null/undefined/empty', () => {
    expect(getCountryCode(null)).toBeNull();
    expect(getCountryCode(undefined)).toBeNull();
    expect(getCountryCode('')).toBeNull();
    expect(getCountryCode('   ')).toBeNull();
  });

  it('returns null for unknown strings and logs a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getCountryCode('Atlantis')).toBeNull();
    expect(getCountryCode('xyzzy')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does NOT warn on null/empty input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCountryCode(null);
    getCountryCode('');
    getCountryCode('   ');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
