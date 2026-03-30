import { describe, it, expect } from 'vitest';
import { isEmailProvider, extractEmailDomain, extractEmailLocalPart } from './emailUtils';

describe('isEmailProvider', () => {
  it('recognizes common email providers', () => {
    expect(isEmailProvider('gmail.com')).toBe(true);
    expect(isEmailProvider('yahoo.com')).toBe(true);
    expect(isEmailProvider('hotmail.com')).toBe(true);
    expect(isEmailProvider('outlook.com')).toBe(true);
    expect(isEmailProvider('icloud.com')).toBe(true);
    expect(isEmailProvider('protonmail.com')).toBe(true);
    expect(isEmailProvider('proton.me')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isEmailProvider('Gmail.com')).toBe(true);
    expect(isEmailProvider('YAHOO.COM')).toBe(true);
    expect(isEmailProvider('Outlook.Com')).toBe(true);
  });

  it('returns false for custom domains', () => {
    expect(isEmailProvider('company.com')).toBe(false);
    expect(isEmailProvider('mywebsite.io')).toBe(false);
    expect(isEmailProvider('university.edu')).toBe(false);
  });
});

describe('extractEmailDomain', () => {
  it('extracts domain from valid email', () => {
    expect(extractEmailDomain('user@example.com')).toBe('example.com');
    expect(extractEmailDomain('alice@company.io')).toBe('company.io');
  });

  it('returns lowercase domain', () => {
    expect(extractEmailDomain('user@Example.COM')).toBe('example.com');
  });

  it('returns null for empty string', () => {
    expect(extractEmailDomain('')).toBeNull();
  });

  it('returns null for invalid email (no @)', () => {
    expect(extractEmailDomain('invalid-email')).toBeNull();
  });

  it('returns null for email with multiple @ signs', () => {
    expect(extractEmailDomain('user@@example.com')).toBeNull();
  });

  it('hides provider domains when hideProviders is true', () => {
    expect(extractEmailDomain('user@gmail.com', true)).toBeNull();
    expect(extractEmailDomain('user@yahoo.com', true)).toBeNull();
  });

  it('shows custom domains even when hideProviders is true', () => {
    expect(extractEmailDomain('user@company.com', true)).toBe('company.com');
  });

  it('shows all domains when hideProviders is false', () => {
    expect(extractEmailDomain('user@gmail.com', false)).toBe('gmail.com');
    expect(extractEmailDomain('user@company.com', false)).toBe('company.com');
  });
});

describe('extractEmailLocalPart', () => {
  it('extracts local part from valid email', () => {
    expect(extractEmailLocalPart('user@example.com')).toBe('user');
    expect(extractEmailLocalPart('alice.bob@company.io')).toBe('alice.bob');
  });

  it('returns empty string for empty input', () => {
    expect(extractEmailLocalPart('')).toBe('');
  });

  it('returns the whole string if no @ sign', () => {
    expect(extractEmailLocalPart('noemail')).toBe('noemail');
  });
});
