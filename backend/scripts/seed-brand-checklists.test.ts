import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  BRAND_CHECKLISTS,
  planSeries,
  validateChecklists,
} = require('./seed-brand-checklists.cjs');

// The short lists already in prod (apply-brand-checklists.cjs). Every name must
// survive in the new plan, or the seed would leave a stray row / duplicate.
const EXISTING: Record<string, string[]> = {
  doge: ['Create your event', 'Get approved', 'Pick a venue', 'Choose a pizzeria', 'Add a co-host',
    'Share your invite link', 'Post on X with #DogeDay', 'Estimate attendance', 'Upload photos after the party'],
  team1: ['Create your event', 'Get approved', 'Confirm venue', 'Choose a pizzeria', 'Line up a speaker or topic',
    'Share in your Team1 community chat', 'Estimate attendance', 'Post photos and a recap', 'Schedule the next meetup'],
  monad: ['Create your event', 'Get approved', 'Confirm venue and Wi-Fi/power', 'Set capacity and review applications',
    'Publish tracks, prizes and rules', 'Line up judges and mentors', 'Plan meals per day: choose pizzerias',
    'Add a co-host or volunteers', 'Day-of: check-in and displays', 'Post winners and photos'],
};

describe('seed-brand-checklists', () => {
  it('brand lists are valid (known auto rules + link tabs, unique names)', () => {
    expect(validateChecklists()).toEqual([]);
  });

  it('never uses GPP-only kit/reimbursement auto rules', () => {
    for (const rows of Object.values(BRAND_CHECKLISTS) as [string, string | null, string | null][][]) {
      for (const [, rule] of rows) {
        expect(['party_kit_submitted', 'budget_submitted']).not.toContain(rule);
      }
    }
  });

  it('keeps every existing prod item name for each brand', () => {
    for (const [slug, names] of Object.entries(EXISTING)) {
      const planned = (BRAND_CHECKLISTS[slug] as [string][]).map(([n]) => n);
      for (const n of names) expect(planned).toContain(n);
    }
  });

  it('every brand gets the universal photo/video step', () => {
    for (const rows of Object.values(BRAND_CHECKLISTS) as [string][][]) {
      expect(rows.map(([n]) => n)).toContain('Pick a photo/video person');
    }
  });

  it('flags invalid rules, tabs and duplicates', () => {
    const problems = validateChecklists({
      x: [['A', 'party_kit_submitted', null], ['B', null, 'nope'], ['A', null, null]],
    });
    expect(problems).toHaveLength(3);
  });

  it('planSeries inserts missing, skips existing, reorders, and reports extras', () => {
    const existing = [
      { name: 'One', sort_order: 1 },
      { name: 'Three', sort_order: 2 },
      { name: 'Custom', sort_order: 3 },
    ];
    const planned = [['One', 'event_created', null], ['Two', null, 'pizza'], ['Three', null, null]];
    const plan = planSeries(existing, planned);
    expect(plan.insert).toEqual([{ name: 'Two', autoRule: null, linkTab: 'pizza', isAuto: false, sortOrder: 2 }]);
    expect(plan.keep).toEqual(['One', 'Three']);
    expect(plan.reorder).toEqual([{ name: 'Three', from: 2, to: 3 }]);
    expect(plan.extras).toEqual(['Custom']);
  });

  it('planSeries is idempotent: a fully applied plan is a no-op', () => {
    for (const planned of Object.values(BRAND_CHECKLISTS) as [string, string | null, string | null][][]) {
      const applied = planned.map(([name, , linkTab], i) => ({ name, sort_order: i + 1, link_tab: linkTab }));
      const plan = planSeries(applied, planned);
      expect(plan.insert).toEqual([]);
      expect(plan.reorder).toEqual([]);
      expect(plan.extras).toEqual([]);
      expect(plan.linkFixes).toEqual([]);
    }
  });

  it('planSeries fills only EMPTY links, never overwrites an admin-set one', () => {
    const existing = [
      { name: 'Add a co-host', sort_order: 1, link_tab: null },
      { name: 'Pick a photo/video person', sort_order: 2, link_tab: 'guests' },
    ];
    const planned = [['Add a co-host', 'team_built', 'details'], ['Pick a photo/video person', null, 'photos']];
    expect(planSeries(existing, planned).linkFixes).toEqual([{ name: 'Add a co-host', to: 'details' }]);
  });

  it('co-host items link to Settings and photo/video items to Photos, like GPP27', () => {
    for (const rows of Object.values(BRAND_CHECKLISTS) as [string, string | null, string | null][][]) {
      for (const [name, rule, tab] of rows) {
        if (rule === 'team_built') expect(tab).toBe('details');
        if (name === 'Pick a photo/video person') expect(tab).toBe('photos');
        if (rule === 'event_created') expect(tab).toBe('details');
      }
    }
  });
});
