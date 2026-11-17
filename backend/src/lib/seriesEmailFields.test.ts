import { describe, it, expect } from 'vitest';
import {
  emailOrNull, hostnameOrNull, senderNameOrNull, addressUnderDomain, assertSenderConsistent, siteAliasesOrNull,
} from './seriesEmailFields.js';

const origin = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null;
  const u = new URL(v);
  if (u.protocol !== 'https:' || u.pathname !== '/') throw new Error('bad');
  return u.origin;
};

describe('seriesEmailFields', () => {
  it('emailOrNull normalizes and rejects', () => {
    expect(emailOrNull('  Events@Mail.Partner.com ', 'x')).toBe('events@mail.partner.com');
    expect(emailOrNull('', 'x')).toBeNull();
    expect(emailOrNull(undefined, 'x')).toBeNull();
    for (const bad of ['a', 'a@b', 'A <a@b.co>', 'a@b.co, c@d.co', 'a@@b.co', 'a b@c.co']) {
      expect(() => emailOrNull(bad, 'x'), bad).toThrow();
    }
  });

  it('hostnameOrNull accepts hostnames only', () => {
    expect(hostnameOrNull('Mail.Partner.com.', 'd')).toBe('mail.partner.com');
    for (const bad of ['partner', 'https://a.co', 'a.co/x', '*.a.co', '1.2.3.4', 'a_b.co', '-a.co']) {
      expect(() => hostnameOrNull(bad, 'd'), bad).toThrow();
    }
  });

  it('senderNameOrNull strips header-breaking characters', () => {
    expect(senderNameOrNull('Acme "Events" <x>\r\nBcc: a@b.co')).toBe('Acme Events xBcc: a@b.co');
    expect(senderNameOrNull('"<>')).toBeNull();
    expect(() => senderNameOrNull('a'.repeat(101))).toThrow();
  });

  it('addressUnderDomain matches equal or subdomain only', () => {
    expect(addressUnderDomain('a@mail.p.com', 'mail.p.com')).toBe(true);
    expect(addressUnderDomain('a@x.mail.p.com', 'mail.p.com')).toBe(true);
    expect(addressUnderDomain('a@evilmail.p.com', 'mail.p.com')).toBe(false);
    expect(addressUnderDomain('a@p.com', 'mail.p.com')).toBe(false);
  });

  it('assertSenderConsistent', () => {
    expect(() => assertSenderConsistent(null, null)).not.toThrow();
    expect(() => assertSenderConsistent(null, 'mail.p.com')).not.toThrow();
    expect(() => assertSenderConsistent('a@mail.p.com', null)).toThrow();
    expect(() => assertSenderConsistent('a@mail.p.com', 'mail.p.com')).not.toThrow();
    expect(() => assertSenderConsistent('a@o.com', 'mail.p.com')).toThrow();
  });

  it('siteAliasesOrNull', () => {
    expect(siteAliasesOrNull(['https://a.com', 'https://A.com'], origin, 'https://b.com')).toEqual(['https://a.com']);
    expect(siteAliasesOrNull(null, origin, null)).toEqual([]);
    expect(() => siteAliasesOrNull(['https://b.com'], origin, 'https://b.com')).toThrow();
    expect(() => siteAliasesOrNull('x', origin, null)).toThrow();
    const many = Array.from({ length: 11 }, (_, i) => `https://a${i}.com`);
    expect(() => siteAliasesOrNull(many, origin, null)).toThrow();
  });
});
