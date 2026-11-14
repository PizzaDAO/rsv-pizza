import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { HACKATHON_AUTO_RULES } from '../src/lib/hackathon/checklistRules.js';
import { isValidSeriesLinkTab } from '../src/lib/checklistLinkTabs.js';

const require = createRequire(import.meta.url);
const { HACKATHON_ITEMS, LINK_TAB, RENAMES, planRow } = require('./seed-hackathon-checklist.cjs');
const { BRAND_CHECKLISTS } = require('./seed-brand-checklists.cjs');

describe('seed-hackathon-checklist', () => {
  it('targets the six Monad hackathon items by their exact prod names', () => {
    const monad = (BRAND_CHECKLISTS.monad as [string][]).map(([n]) => n);
    for (const [name] of HACKATHON_ITEMS) expect(monad).toContain(name);
    expect(HACKATHON_ITEMS).toHaveLength(6);
  });

  it('only uses auto rules the checklist endpoint computes, and a valid link tab', () => {
    for (const [, rule] of HACKATHON_ITEMS) if (rule) expect(HACKATHON_AUTO_RULES).toContain(rule);
    expect(isValidSeriesLinkTab(LINK_TAB)).toBe(true);
  });

  it('fills empty / seed-default links and missing auto rules', () => {
    expect(planRow({ name: 'Publish tracks, prizes and rules', link_tab: 'details', auto_rule: null }))
      .toEqual({ linkTab: 'hackathon', autoRule: 'hackathon_published' });
    expect(planRow({ name: 'Run demos and judging', link_tab: null, auto_rule: null }))
      .toEqual({ linkTab: 'hackathon', autoRule: 'hackathon_judging_closed' });
    // PR 4 re-run over rows PR 2 already linked: only the new auto rule is added.
    expect(planRow({ name: 'Run demos and judging', link_tab: 'hackathon', auto_rule: null })).toEqual({ autoRule: 'hackathon_judging_closed' });
    expect(planRow({ name: 'Post winners and photos', link_tab: 'photos', auto_rule: null }))
      .toEqual({ linkTab: 'hackathon', autoRule: 'hackathon_results_revealed' });
    // PR 5 re-run over rows PR 2 already linked: only the new auto rules are added.
    expect(planRow({ name: 'Post winners and photos', link_tab: 'hackathon', auto_rule: null })).toEqual({ autoRule: 'hackathon_results_revealed' });
    expect(planRow({ name: 'Send prizes to winners', link_tab: 'hackathon', auto_rule: null })).toEqual({ autoRule: 'hackathon_prizes_paid' });
    // ...and a third run changes nothing.
    expect(planRow({ name: 'Send prizes to winners', link_tab: 'hackathon', auto_rule: 'hackathon_prizes_paid' })).toBeNull();
    // A host who already ticked "Send prizes" by hand keeps it manual.
    expect(planRow({ name: 'Send prizes to winners', link_tab: 'hackathon', auto_rule: null, completed: true })).toBeNull();
  });

  it('never clobbers an admin edit, and is idempotent', () => {
    expect(planRow({ name: 'Publish tracks, prizes and rules', link_tab: 'partners', auto_rule: 'custom' })).toBeNull();
    expect(planRow({ name: 'Line up judges and mentors', link_tab: 'hackathon', auto_rule: 'hackathon_judges_added' })).toBeNull();
    expect(planRow({ name: 'Some other item', link_tab: null, auto_rule: null })).toBeNull();
  });

  it('a party item the host already completed keeps its manual tick (link only, no auto rule)', () => {
    expect(planRow({ name: 'Line up judges and mentors', link_tab: null, auto_rule: null, completed: true })).toEqual({ linkTab: 'hackathon' });
    expect(planRow({ name: 'Publish tracks, prizes and rules', link_tab: 'hackathon', auto_rule: null, completed: true })).toBeNull();
    expect(planRow({ name: 'Line up judges and mentors', link_tab: null, auto_rule: null, completed: false }))
      .toEqual({ linkTab: 'hackathon', autoRule: 'hackathon_judges_added' });
  });

  it('renames the old submission-platform item and keeps its link / auto rule planning', () => {
    expect(RENAMES).toEqual({ 'Set up the submission platform': 'Open project submissions' });
    // old-named rows are still planned (dry run sees the old name before the rename is applied)
    expect(planRow({ name: 'Set up the submission platform', link_tab: null, auto_rule: null }))
      .toEqual({ linkTab: 'hackathon', autoRule: 'hackathon_submissions_ready' });
    expect(planRow({ name: 'Open project submissions', link_tab: 'hackathon', auto_rule: 'hackathon_submissions_ready' })).toBeNull();
    // an existing link and auto rule are kept
    expect(planRow({ name: 'Set up the submission platform', link_tab: 'hackathon', auto_rule: 'hackathon_submissions_ready' })).toBeNull();
  });
});
