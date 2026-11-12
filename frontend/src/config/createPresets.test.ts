import { describe, it, expect } from 'vitest';
import { CREATE_FLOW_KEYS, resolvePreset, renderNameTemplate } from './createPresets';

describe('createPresets', () => {
  it('has the shared key set', () => {
    expect([...CREATE_FLOW_KEYS].sort()).toEqual(['global_day', 'hackathon', 'meetup']);
  });

  it('resolves known keys and rejects unknown/absent', () => {
    expect(resolvePreset('meetup')?.dateMode).toBe('single');
    expect(resolvePreset(undefined)).toBeNull();
    expect(resolvePreset(null)).toBeNull();
    expect(resolvePreset('nope')).toBeNull();
  });

  it('renders name templates', () => {
    expect(renderNameTemplate('{series} {city}', { series: 'Doge Day', city: 'Austin' })).toBe('Doge Day Austin');
    expect(renderNameTemplate('{brand} Meetup {city}', { brand: 'Team1', city: '' })).toBe('Team1 Meetup');
  });
});
