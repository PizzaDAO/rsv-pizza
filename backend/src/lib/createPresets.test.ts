import { describe, it, expect } from 'vitest';
import {
  CREATE_FLOW_KEYS, CREATE_PRESETS, resolveCreatePreset, isCreateFlowKey,
  renderNameTemplate, citySlug, customUrlCandidates,
} from './createPresets.js';

describe('createPresets', () => {
  it('key set is exactly global_day, meetup, hackathon (mirrors the frontend registry)', () => {
    expect([...CREATE_FLOW_KEYS]).toEqual(['global_day', 'meetup', 'hackathon']);
    expect(Object.keys(CREATE_PRESETS).sort()).toEqual(['global_day', 'hackathon', 'meetup']);
  });

  it('resolveCreatePreset: NULL/unknown -> null', () => {
    for (const v of [null, undefined, '', 'nope', 42]) expect(resolveCreatePreset(v)).toBeNull();
    expect(resolveCreatePreset('meetup')?.key).toBe('meetup');
    expect(isCreateFlowKey('hackathon')).toBe(true);
    expect(isCreateFlowKey('x')).toBe(false);
  });

  it('per-preset shape', () => {
    expect(CREATE_PRESETS.global_day).toMatchObject({ dateMode: 'fixed', nameLocked: true, pinnedApps: ['checklist', 'venue'] });
    expect(CREATE_PRESETS.meetup).toMatchObject({ dateMode: 'single', defaultStart: '18:30', defaultEnd: '21:00' });
    expect(CREATE_PRESETS.hackathon).toMatchObject({ nameTemplate: null, requireMaxGuests: true, maxSpanDays: 14, defaults: { requireApproval: true } });
    expect(CREATE_PRESETS.hackathon.pinnedApps).toEqual(['checklist', 'venue', 'staffing', 'displays']);
  });

  it('renderNameTemplate tokens', () => {
    expect(renderNameTemplate('{series} {city}', { city: 'Austin', series: 'Doge Day', brand: 'x' })).toBe('Doge Day Austin');
    expect(renderNameTemplate('{series} Meetup {city}', { city: 'Austin', series: 'Team1' })).toBe('Team1 Meetup Austin');
    expect(renderNameTemplate('{brand} Hack {city}', { city: '', brand: 'Monad Pizza' })).toBe('Monad Pizza Hack');
  });

  it('citySlug + customUrlCandidates', () => {
    expect(citySlug('Zürich')).toBe('zurich');
    expect(citySlug('New York')).toBe('new-york');
    expect(customUrlCandidates('doge', 'Austin').slice(0, 3)).toEqual(['doge-austin', 'doge-austin-2', 'doge-austin-3']);
    expect(customUrlCandidates('doge', '!!!')).toEqual([]);
    for (const c of customUrlCandidates('doge', 'A'.repeat(80))) expect(c.length).toBeLessThanOrEqual(50);
  });
});
