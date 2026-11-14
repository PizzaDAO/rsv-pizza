import { describe, it, expect } from 'vitest';
import { ClipboardCheck, Users, MapPin, Camera, Printer, FileImage, Zap, Megaphone } from 'lucide-react';
import { resolveChecklistAction, hostTabPath, sortByDueDate } from './checklistActions';
import { checklistIcon, checklistLabel } from './checklistIcons';
import { hostDefaultTab, isBrandSeriesParty, dashboardKind } from '../../lib/hostDefaultTab';

const item = (name: string, autoRule: string | null, linkTab: string | null) => ({ name, autoRule, linkTab });

/**
 * The original GPPDashboardTab row behavior (pre brand-checklists), reproduced
 * here as the oracle: name matches first, else navigate to linkTab.
 */
function legacyGppAction(i: { name: string; linkTab: string | null }) {
  if (i.name === 'Build a Team') return { kind: 'hosts' };
  if (i.name === 'Find Partners') return { kind: 'tab', tab: 'partners' };
  if (i.name === 'Find a Venue') return { kind: 'venue-modal' };
  if (i.name === 'Estimated Attendance') return { kind: 'attendance-modal' };
  if (i.name === 'Post about the party on socials') return { kind: 'social-modal' };
  return i.linkTab ? { kind: 'tab', tab: i.linkTab } : null;
}

// Real GPP rows: the current global template + legacy GPP2026 party rows.
const GPP_ROWS = [
  item('Create Event', 'event_created', null),
  item('Request Party Kit', 'party_kit_submitted', 'gpp'),
  item('Build a Team', 'team_built', 'details'),
  item('Find a Venue', 'venue_added', 'venue'),
  item('Set Up Budget', 'budget_submitted', 'budget'),
  item('Find Partners', null, 'partners'),
  item('Find Partners', null, 'sponsors'), // legacy GPP2026 rows
  item('Select Pizzeria', 'pizzerias_selected', 'pizza'),
  item('Select Pizzeria', null, 'venue'), // legacy GPP2026 rows
  item('Prepare for the Party', null, null),
  item('Post to Socials', null, 'promo'),
  item('Estimated Attendance', 'attendance_estimated', 'attendance'),
  item('Get reviewed for funding', 'underboss_reviewed', null),
  item('Submit photos + receipts', null, 'payments'),
  item('Guest reminders go out by email', null, null),
  item('Post about the party on socials', null, 'social-post'),
  item('Print Stuff (Flyers, Roll-ups, and/or Stickers)', null, 'print'),
  item('Customize your flyer', null, 'flyer'),
  item('Set expected guests', null, 'pizza'),
  item('Submit payments info', null, 'payments'),
  item('Use your Party Guide to throw a great party!', null, 'party-guide'),
];

describe('resolveChecklistAction (gpp)', () => {
  it('matches the original GPP dashboard behavior for every GPP row', () => {
    for (const r of GPP_ROWS) {
      expect(resolveChecklistAction(r, 'gpp')).toEqual(legacyGppAction(r));
    }
  });

  it('legacy "Select Pizzeria" with link venue opens the Venue TAB, not the modal', () => {
    expect(resolveChecklistAction(item('Select Pizzeria', null, 'venue'), 'gpp')).toEqual({ kind: 'tab', tab: 'venue' });
  });

  it('legacy link "sponsors" goes to the Partners tab', () => {
    expect(resolveChecklistAction(item('Find Partners', null, 'sponsors'), 'gpp')).toEqual({ kind: 'tab', tab: 'partners' });
    expect(resolveChecklistAction(item('Other', null, 'sponsors'), 'gpp')).toEqual({ kind: 'tab', tab: 'partners' });
    expect(resolveChecklistAction(item('Other', null, 'sponsors'), 'series')).toEqual({ kind: 'tab', tab: 'partners' });
  });
});

describe('resolveChecklistAction (series)', () => {
  it('gives brand items the same behavior as GPP items with the same meaning', () => {
    expect(resolveChecklistAction(item('Add a co-host', 'team_built', 'details'), 'series')).toEqual({ kind: 'hosts' });
    expect(resolveChecklistAction(item('Add a co-host or volunteers', 'team_built', null), 'series')).toEqual({ kind: 'hosts' });
    expect(resolveChecklistAction(item('Confirm venue', 'venue_added', 'venue'), 'series')).toEqual({ kind: 'venue-modal' });
    expect(resolveChecklistAction(item('Confirm venue and Wi-Fi/power', 'venue_added', 'venue'), 'series')).toEqual({ kind: 'venue-modal' });
    expect(resolveChecklistAction(item('Estimate attendance', 'attendance_estimated', 'attendance'), 'series')).toEqual({ kind: 'attendance-modal' });
    expect(resolveChecklistAction(item('Post on X with #DogeDay', null, 'social-post'), 'series')).toEqual({ kind: 'social-modal' });
    expect(resolveChecklistAction(item('Pick a photo/video person', null, 'photos'), 'series')).toEqual({ kind: 'tab', tab: 'photos' });
    expect(resolveChecklistAction(item('Line up judges and mentors', null, null), 'series')).toBeNull();
  });

  it('a bare venue link without the venue_added rule navigates to the Venue tab', () => {
    expect(resolveChecklistAction(item('Anything', null, 'venue'), 'series')).toEqual({ kind: 'tab', tab: 'venue' });
  });
});

describe('checklistIcon', () => {
  it('GPP keeps the name map with a ClipboardCheck fallback', () => {
    expect(checklistIcon(item('Build a Team', 'team_built', 'details'), 'gpp')).toBe(Users);
    expect(checklistIcon(item('Find a Venue', 'venue_added', 'venue'), 'gpp')).toBe(MapPin);
    for (const name of ['Print Stuff (Flyers, Roll-ups, and/or Stickers)', 'Customize your flyer',
      'Set expected guests', 'Use your Party Guide to throw a great party!', 'Submit photos + receipts']) {
      const row = GPP_ROWS.find((r) => r.name === name)!;
      expect(checklistIcon(row, 'gpp')).toBe(ClipboardCheck);
    }
  });

  it('brand items fall back by rule / link', () => {
    expect(checklistIcon(item('Add a co-host', 'team_built', 'details'), 'series')).toBe(Users);
    expect(checklistIcon(item('Pick a photo/video person', null, 'photos'), 'series')).toBe(Camera);
    expect(checklistIcon(item('Print flyers and stickers', null, 'print'), 'series')).toBe(Printer);
    expect(checklistIcon(item('Customize your flyer', null, 'flyer'), 'series')).toBe(FileImage);
    expect(checklistIcon(item('Use your Party Guide on Doge Day', null, 'party-guide'), 'series')).toBe(Zap);
    expect(checklistIcon(item('Post on X with #DogeDay', null, 'social-post'), 'series')).toBe(Megaphone);
    expect(checklistIcon(item('Schedule the next meetup', null, null), 'series')).toBe(ClipboardCheck);
  });

  it('keeps the GPP label override', () => {
    expect(checklistLabel({ name: 'Estimated Attendance' })).toBe('Submit Estimated Attendance');
    expect(checklistLabel({ name: 'Estimate attendance' })).toBe('Estimate attendance');
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

describe('dashboardKind', () => {
  it('only brand-series parties get the series dashboard', () => {
    expect(dashboardKind(true, false)).toBe('series');
    expect(dashboardKind(true, true)).toBe('series');
  });

  it('GPP and plain parties keep the original routing (GPP27 opt-in, else GPP)', () => {
    const plain = isBrandSeriesParty({ eventType: 'standard', eventSeriesId: null });
    const gpp = isBrandSeriesParty({ eventType: 'gpp', eventSeriesId: 's1' });
    expect(dashboardKind(plain, false)).toBe('gpp');
    expect(dashboardKind(plain, true)).toBe('gpp27');
    expect(dashboardKind(gpp, false)).toBe('gpp');
    expect(dashboardKind(gpp, true)).toBe('gpp27');
  });
});
