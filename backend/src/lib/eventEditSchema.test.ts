import { describe, it, expect } from 'vitest';
import {
  EVENT_EDIT_CATALOG,
  PATCH_WHITELIST_SNAKE,
  buildToolSchema,
  validatePatch,
  diffPatch,
} from './eventEditSchema.js';

describe('eventEditSchema drift guard', () => {
  it('every catalog key (except synthetic resolvesTo fields) is in the PATCH whitelist', () => {
    const offenders = EVENT_EDIT_CATALOG.filter(
      (f) => !f.resolvesTo && !PATCH_WHITELIST_SNAKE.has(f.key),
    ).map((f) => f.key);
    expect(offenders).toEqual([]);
  });

  it('synthetic event_datetime resolves only to whitelisted PATCH keys', () => {
    const dt = EVENT_EDIT_CATALOG.find((f) => f.key === 'event_datetime');
    expect(dt).toBeTruthy();
    for (const target of dt!.resolvesTo ?? []) {
      expect(PATCH_WHITELIST_SNAKE.has(target)).toBe(true);
    }
  });

  it('has no duplicate catalog keys', () => {
    const keys = EVENT_EDIT_CATALOG.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildToolSchema', () => {
  it('omits admin-only fields for hosts but includes them for admins', () => {
    const hostProps = (buildToolSchema('host').function.parameters as any).properties.changes
      .properties;
    const adminProps = (buildToolSchema('admin').function.parameters as any).properties.changes
      .properties;
    expect(hostProps.reimbursement_cap_usd).toBeUndefined();
    expect(hostProps.tax_form_required).toBeUndefined();
    expect(adminProps.reimbursement_cap_usd).toBeDefined();
    expect(adminProps.tax_form_required).toBeDefined();
  });

  it('forces the tool name propose_event_changes', () => {
    expect(buildToolSchema('host').function.name).toBe('propose_event_changes');
  });
});

describe('validatePatch', () => {
  it('drops unknown keys and admin-only keys for hosts', () => {
    const out = validatePatch(
      { name: 'New Name', bogus: 'x', reimbursement_cap_usd: 100 },
      'host',
    );
    expect(out).toEqual({ name: 'New Name' });
  });

  it('keeps admin-only keys for admins', () => {
    const out = validatePatch({ reimbursement_cap_usd: 250 }, 'admin');
    expect(out).toEqual({ reimbursement_cap_usd: 250 });
  });

  it('coerces booleans and clamps numeric arrays', () => {
    const out = validatePatch(
      { hide_guests: 'true', suggested_amounts: [500, -1, 'x', 999.6] },
      'host',
    );
    expect(out.hide_guests).toBe(true);
    expect(out.suggested_amounts).toEqual([500, 1000]);
  });

  it('drops invalid enum values', () => {
    expect(validatePatch({ pizza_style: 'martian' }, 'host')).toEqual({});
    expect(validatePatch({ pizza_style: 'detroit' }, 'host')).toEqual({
      pizza_style: 'detroit',
    });
  });

  it('filters external_links to {label,url} and caps at 10', () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, url: `http://x/${i}` }));
    const out = validatePatch({ external_links: [...links, { label: 1 }] }, 'host');
    expect((out.external_links as any[]).length).toBe(10);
  });
});

describe('diffPatch', () => {
  it('returns only changed fields with formatted displays', () => {
    const current = { name: 'Old', hide_guests: false };
    const proposed = { name: 'New', hide_guests: false };
    const diff = diffPatch(current, proposed, 'host');
    expect(diff.length).toBe(1);
    expect(diff[0].key).toBe('name');
    expect(diff[0].currentDisplay).toBe('Old');
    expect(diff[0].proposedDisplay).toBe('New');
  });

  it('treats null/empty-string as no change', () => {
    const diff = diffPatch({ music_notes: null }, { music_notes: '' }, 'host');
    expect(diff).toEqual([]);
  });
});
