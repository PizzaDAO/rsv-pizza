import { describe, it, expect } from 'vitest';
import {
  runChecks, worstStatus, cityIdentity, RESERVED_SLUGS,
  type VerificationParty, type VerificationContext, type CheckId,
} from './gppVerification.js';

const NOW = new Date('2027-01-10T00:00:00Z');

const good: VerificationParty = {
  id: 'p1', name: 'Global Pizza Party Austin', inviteCode: 'abc123xyz', customUrl: 'austin27',
  date: new Date('2027-05-22T22:00:00Z'), timezone: 'America/Chicago',
  venueName: 'Slice House', address: '1 Main St, Austin', addressIsCityDefault: false,
  eventImageUrl: 'https://img/x.png', description: 'Pizza!', maxGuests: 100,
  venueCapacity: null, expectedGuests: null, rsvpClosedAt: null, cancelledAt: null,
  requireApproval: false, nftEnabled: false, eventTags: ['Global Pizza Party', 'gpp2027'],
  city: 'Austin', country: 'United States',
  coHosts: [{ email: 'host@x.com', canEdit: true }, { email: 'hello@rarepizzas.com' }],
  hostEmail: 'host@x.com', hostName: 'Hosty',
};

const ctx: VerificationContext = {
  now: NOW, year: 2027, yearTag: 'gpp2027',
  otherInviteCodes: new Set(), reservedSlugs: RESERVED_SLUGS, duplicateIds: [],
};

function status(p: Partial<VerificationParty>, c: Partial<VerificationContext> = {}) {
  const results = runChecks({ ...good, ...p }, { ...ctx, ...c });
  const byId = Object.fromEntries(results.map((r) => [r.id, r])) as Record<CheckId, (typeof results)[number]>;
  return { results, byId };
}

describe('runChecks', () => {
  it('passes everything for a healthy event', () => {
    const { results } = status({});
    expect(results.filter((r) => r.status !== 'pass')).toEqual([]);
    expect(worstStatus(results)).toBe('pass');
  });

  it('fails a reserved slug', () => {
    expect(status({ customUrl: 'admin' }).byId['page-resolves'].status).toBe('fail');
  });

  it('fails a slug that collides with another invite code', () => {
    const { byId } = status({}, { otherInviteCodes: new Set(['austin27']) });
    expect(byId['page-resolves'].status).toBe('fail');
  });

  it('fails an invalid slug and warns on a missing one', () => {
    expect(status({ customUrl: 'Aus tin' }).byId['page-resolves'].status).toBe('fail');
    expect(status({ customUrl: null }).byId['page-resolves'].status).toBe('warn');
  });

  it('fails RSVP when closed, cancelled, past, or undated', () => {
    expect(status({ rsvpClosedAt: NOW }).byId['rsvp-open'].status).toBe('fail');
    expect(status({ cancelledAt: NOW }).byId['rsvp-open'].reason).toMatch(/cancelled/);
    expect(status({ date: new Date('2026-01-01') }).byId['rsvp-open'].reason).toMatch(/passed/);
    expect(status({ date: null }).byId['date'].status).toBe('fail');
  });

  it('warns when timezone is missing', () => {
    expect(status({ timezone: null }).byId['date'].status).toBe('warn');
  });

  it('grades venue: none fails, city-default warns, full passes', () => {
    expect(status({ venueName: null, address: null }).byId['venue'].status).toBe('fail');
    expect(status({ venueName: null }).byId['venue'].status).toBe('warn');
    expect(status({ addressIsCityDefault: true }).byId['venue'].status).toBe('warn');
  });

  it('fails without image or description, warns without capacity', () => {
    expect(status({ eventImageUrl: ' ' }).byId['image'].status).toBe('fail');
    expect(status({ description: null }).byId['description'].status).toBe('fail');
    expect(status({ maxGuests: null }).byId['capacity'].status).toBe('warn');
    expect(status({ maxGuests: null, venueCapacity: 50 }).byId['capacity'].status).toBe('pass');
  });

  it('checks the GPP year', () => {
    expect(status({ date: new Date('2026-05-22T20:00:00Z') }).byId['year'].status).toBe('fail');
    expect(status({ customUrl: 'austin26' }).byId['year'].status).toBe('fail');
    expect(status({ customUrl: 'austin' }).byId['year'].status).toBe('pass');
    expect(status({ customUrl: 'austin27-2' }).byId['year'].status).toBe('pass');
    expect(status({ eventTags: [] }).byId['year'].status).toBe('warn');
  });

  it('fails duplicates', () => {
    expect(status({}, { duplicateIds: ['p2'] }).byId['duplicate'].status).toBe('fail');
  });

  it('checks the host', () => {
    expect(status({ hostEmail: null }).byId['host'].status).toBe('fail');
    expect(status({ coHosts: [] }).byId['host'].status).toBe('warn');
    expect(status({ hostName: '' }).byId['host'].status).toBe('warn');
  });

  it('fails NFT without image (and image check fails too)', () => {
    const { byId } = status({ nftEnabled: true, eventImageUrl: null });
    expect(byId['nft'].status).toBe('fail');
    expect(status({ nftEnabled: true }).byId['nft'].status).toBe('pass');
  });

  it('shows requireApproval as a warning but does not color the row', () => {
    const { results, byId } = status({ requireApproval: true });
    expect(byId['approval'].status).toBe('warn');
    expect(worstStatus(results)).toBe('pass');
  });

  it('row status is the worst counted check', () => {
    expect(worstStatus(status({ maxGuests: null }).results)).toBe('warn');
    expect(worstStatus(status({ maxGuests: null, description: '' }).results)).toBe('fail');
  });
});

describe('cityIdentity', () => {
  it('uses city+country, falling back to the party name', () => {
    expect(cityIdentity({ city: 'Austin', name: 'x', country: 'USA' })).toBe(
      cityIdentity({ city: null, name: 'Global Pizza Party Austin', country: 'usa' }),
    );
    expect(cityIdentity({ city: null, name: 'Random', country: null })).toBe('');
  });
});
