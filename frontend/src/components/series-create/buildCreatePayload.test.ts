import { describe, it, expect } from 'vitest';
import { CREATE_PRESETS } from '../../config/createPresets';
import type { PublicSeries } from '../../lib/seriesApi';
import { buildCreatePayload, resolveName, validateCreateForm, type CreateFormState } from './buildCreatePayload';

const series = (over: Partial<PublicSeries> = {}): PublicSeries => ({
  slug: 'x', name: 'x', displayName: 'Doge Day', isActive: true, themeClass: null, logoUrl: null,
  ogImageUrl: null, description: null, eventType: null, publicTags: [], requireApproval: false,
  hideGuests: false, photosEnabled: true, photosPublic: true, eventDate: null, eventStartTime: null,
  eventEndTime: null, ...over,
});

const form = (over: Partial<CreateFormState> = {}): CreateFormState => ({
  name: '', nameTouched: false, locationText: 'Austin, TX, USA', picked: true, cityName: 'Austin',
  country: 'United States', address: 'Austin, TX, USA', placeId: 'pid', venueName: null, street: null,
  lat: 30.27, lng: -97.74, timezone: 'America/Chicago', startDate: '', startTime: '18:00',
  endDate: '', endTime: '21:00', description: '', maxGuests: '', requireApproval: false, externalLink: '', ...over,
});

describe('buildCreatePayload', () => {
  it('global_day: locked date, template name, city default', () => {
    const p = CREATE_PRESETS.global_day;
    const s = series({ eventDate: '2027-11-02T00:00:00.000Z' });
    const f = form();
    expect(validateCreateForm(p, s, f)).toBeNull();
    const body = buildCreatePayload(p, s, f, 'Sam');
    expect(body.name).toBe('Doge Day Austin');
    expect(body.date).toBe('2027-11-02T23:00:00.000Z'); // 18:00 CDT
    expect(body.endTime).toBe('2027-11-03T02:00:00.000Z');
    expect(body.duration).toBe(3);
    expect(body.addressIsCityDefault).toBe(true);
    expect(body.city).toBe('Austin');
    expect(body.requireApproval).toBeUndefined();
    expect(body.maxGuests).toBeUndefined();
  });

  it('global_day: requires a picked city and a series date', () => {
    const p = CREATE_PRESETS.global_day;
    expect(validateCreateForm(p, series({ eventDate: '2027-11-02T00:00:00.000Z' }), form({ picked: false }))).toMatch(/city/i);
    expect(validateCreateForm(p, series(), form())).toMatch(/date/i);
  });

  it('meetup: editable name wins; same-day end; venue pick keeps place', () => {
    const p = CREATE_PRESETS.meetup;
    const s = series({ displayName: 'Team1', brandName: 'Team1' });
    const f = form({ name: 'Team1 Austin Builders', startDate: '2027-03-10', venueName: 'Cool Bar', street: '1 Main St' });
    expect(validateCreateForm(p, s, f)).toBeNull();
    const body = buildCreatePayload(p, s, f);
    expect(body.name).toBe('Team1 Austin Builders');
    expect(body.addressIsCityDefault).toBe(false);
    expect(body.venueName).toBe('Cool Bar');
    expect(body.date).toBe('2027-03-11T00:00:00.000Z'); // 18:00 CST
    expect(body.endTime).toBe('2027-03-11T03:00:00.000Z');
    expect(resolveName(p, s, form())).toBe('Team1 Meetup Austin');
  });

  it('meetup: end before start fails', () => {
    const p = CREATE_PRESETS.meetup;
    expect(validateCreateForm(p, series(), form({ name: 'n', startDate: '2027-03-10', startTime: '21:00', endTime: '18:00' }))).toMatch(/after/i);
  });

  it('hackathon: capacity required, multi-day, approval and link', () => {
    const p = CREATE_PRESETS.hackathon;
    const base = form({ name: 'Monad Blitz', startDate: '2027-04-01', endDate: '2027-04-03', startTime: '10:00', endTime: '18:00', requireApproval: true, externalLink: 'https://devpost.com/x' });
    expect(validateCreateForm(p, series(), base)).toMatch(/capacity/i);
    const f = { ...base, maxGuests: '150' };
    expect(validateCreateForm(p, series(), f)).toBeNull();
    const body = buildCreatePayload(p, series(), f);
    expect(body.maxGuests).toBe(150);
    expect(body.requireApproval).toBe(true);
    expect(body.externalLinks).toEqual([{ label: 'Rules and tracks', url: 'https://devpost.com/x' }]);
    expect(new Date(body.endTime!).getTime() - new Date(body.date!).getTime()).toBeGreaterThan(86400000);
  });

  it('hackathon: caps the span at 14 days', () => {
    const p = CREATE_PRESETS.hackathon;
    const f = form({ name: 'n', startDate: '2027-04-01', endDate: '2027-04-30', maxGuests: '10' });
    expect(validateCreateForm(p, series(), f)).toMatch(/14 days/);
  });
});
