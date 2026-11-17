import { describe, it, expect } from 'vitest';
import {
  isApexHost, assertSubdomainHost, emailOrNull, hostnameOrNull, senderNameOrNull, addressUnderDomain, assertSenderConsistent, siteAliasesOrNull,
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
    expect(senderNameOrNull('Acme "Events" <x>\r\nBcc: a@b.co')).toBe('Acme Events xBcc ab.co');
    // RFC 5322 specials are stripped (never quoted): no extra recipients, no lookalike address
    expect(senderNameOrNull('Acme, Inc')).toBe('Acme Inc');
    expect(senderNameOrNull('support@paypal.com')).toBe('supportpaypal.com');
    expect(senderNameOrNull('A; B: (C) [D] \\E')).toBe('A B C D E');
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

  it('isApexHost / assertSubdomainHost: subdomains only', () => {
    for (const h of ['partner.com', 'partner.co.uk', 'a.io', 'partner.com.au']) expect(isApexHost(h), h).toBe(true);
    for (const h of ['events.partner.com', 'mail.partner.co.uk', 'a.b.partner.com', 'team1.rsv.pizza']) expect(isApexHost(h), h).toBe(false);
    expect(() => assertSubdomainHost('partner.com', 'emailDomain')).toThrow(/subdomain/);
    expect(() => assertSubdomainHost('mail.partner.com', 'emailDomain')).not.toThrow();
  });

  it('hostnameOrNull subdomainOnly rejects an apex', () => {
    expect(() => hostnameOrNull('partner.com', 'emailDomain', { subdomainOnly: true })).toThrow(/subdomain/);
    expect(hostnameOrNull('mail.partner.com', 'emailDomain', { subdomainOnly: true })).toBe('mail.partner.com');
    expect(hostnameOrNull('partner.com', 'x')).toBe('partner.com'); // opt-in only
  });

  it('assertSenderConsistent rejects an apex from-address domain', () => {
    expect(() => assertSenderConsistent('a@partner.com', 'partner.com')).toThrow(/subdomain/);
  });
});
