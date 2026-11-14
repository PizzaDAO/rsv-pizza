import { describe, it, expect } from 'vitest';
import { resolveChecklistAction, hostTabPath, sortByDueDate } from './checklistActions';
import { hostDefaultTab, isBrandSeriesParty } from '../../lib/hostDefaultTab';

const item = (name: string, autoRule: string | null, linkTab: string | null) => ({ name, autoRule, linkTab });

describe('resolveChecklistAction', () => {
  it('keeps the GPP dashboard behaviors', () => {
    expect(resolveChecklistAction(item('Build a Team', 'team_built', 'details'))).toEqual({ kind: 'hosts' });
    expect(resolveChecklistAction(item('Find a Venue', 'venue_added', 'venue'))).toEqual({ kind: 'venue-modal' });
    expect(resolveChecklistAction(item('Estimated Attendance', 'attendance_estimated', 'attendance'))).toEqual({ kind: 'attendance-modal' });
    expect(resolveChecklistAction(item('Post about the party on socials', null, 'social-post'))).toEqual({ kind: 'social-modal' });
    expect(resolveChecklistAction(item('Find Partners', null, 'partners'))).toEqual({ kind: 'tab', tab: 'partners' });
    expect(resolveChecklistAction(item('Prepare for the Party', null, null))).toBeNull();
  });

  it('gives brand items with the same meaning the same behavior', () => {
    expect(resolveChecklistAction(item('Add a co-host', 'team_built', 'details'))).toEqual({ kind: 'hosts' });
    expect(resolveChecklistAction(item('Add a co-host or volunteers', 'team_built', null))).toEqual({ kind: 'hosts' });
    expect(resolveChecklistAction(item('Confirm venue', 'venue_added', 'venue'))).toEqual({ kind: 'venue-modal' });
    expect(resolveChecklistAction(item('Estimate attendance', 'attendance_estimated', 'attendance'))).toEqual({ kind: 'attendance-modal' });
    expect(resolveChecklistAction(item('Post on X with #DogeDay', null, 'social-post'))).toEqual({ kind: 'social-modal' });
    expect(resolveChecklistAction(item('Pick a photo/video person', null, 'photos'))).toEqual({ kind: 'tab', tab: 'photos' });
  });
});

describe('hostTabPath', () => {
  it('always uses an explicit tab segment, including Settings', () => {
    expect(hostTabPath('abc', 'details')).toBe('/host/abc/details');
    expect(hostTabPath('abc', 'photos')).toBe('/host/abc/photos');
  });
});

describe('sortByDueDate', () => {
  it('sorts ascending with undated items last, stable otherwise', () => {
    const rows = [
      { id: 'a', dueDate: null },
      { id: 'b', dueDate: '2027-10-01' },
      { id: 'c', dueDate: '2027-09-01' },
      { id: 'd', dueDate: null },
    ];
    expect(sortByDueDate(rows).map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('hostDefaultTab', () => {
  it('lands GPP and brand-series hosts on the dashboard, others on Settings', () => {
    expect(hostDefaultTab({ eventType: 'gpp', eventSeriesId: 's1' })).toBe('dashboard');
    expect(hostDefaultTab({ eventType: 'gpp', eventSeriesId: null })).toBe('dashboard');
    expect(hostDefaultTab({ eventType: null, eventSeriesId: 'doge-series' })).toBe('dashboard');
    expect(hostDefaultTab({ eventType: 'standard', eventSeriesId: null })).toBe('details');
    expect(hostDefaultTab(null)).toBe('details');
  });

  it('isBrandSeriesParty excludes GPP series parties', () => {
    expect(isBrandSeriesParty({ eventType: 'gpp', eventSeriesId: 's1' })).toBe(false);
    expect(isBrandSeriesParty({ eventType: null, eventSeriesId: 's2' })).toBe(true);
    expect(isBrandSeriesParty({ eventType: null, eventSeriesId: null })).toBe(false);
  });
});
