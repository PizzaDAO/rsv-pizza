/**
 * party-password-anon-exposure: guards for the anon `parties` column allowlist.
 *
 * After the column lockdown, anon may SELECT only the columns in scripts/parties-anon-columns.json.
 * A column selected by the client but not granted makes every party read fail with 42501, and a
 * host-only column that leaks into the allowlist re-exposes it. These tests tie the three sources
 * of truth together (SAFE_PARTY_COLUMNS, the JSON allowlist, SENSITIVE_PARTY_COLUMNS).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SAFE_PARTY_COLUMNS, SENSITIVE_PARTY_COLUMNS, mergeHostOnlyPartyFields, DbParty } from '../lib/supabase';
import { preserveHostOnlyFields } from '../contexts/PizzaContext';
import type { Party } from '../types';

const REPO = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');
const safe = SAFE_PARTY_COLUMNS.split(',').map((c) => c.trim()).filter(Boolean);

describe('parties anon column allowlist', () => {
  it('scripts/parties-anon-columns.json equals SAFE_PARTY_COLUMNS', () => {
    const allow: string[] = JSON.parse(read('scripts/parties-anon-columns.json'));
    expect([...allow].sort()).toEqual([...safe].sort());
  });

  it('scripts/anon-sensitive-columns.json equals SENSITIVE_PARTY_COLUMNS', () => {
    const sens: string[] = JSON.parse(read('scripts/anon-sensitive-columns.json')).parties;
    expect([...sens].sort()).toEqual([...SENSITIVE_PARTY_COLUMNS].sort());
  });

  it('SAFE_PARTY_COLUMNS has no duplicates and never overlaps SENSITIVE_PARTY_COLUMNS', () => {
    expect(new Set(safe).size).toBe(safe.length);
    expect(safe.filter((c) => SENSITIVE_PARTY_COLUMNS.includes(c))).toEqual([]);
  });

  it('the four host-only columns are no longer in SAFE_PARTY_COLUMNS; has_password is', () => {
    for (const c of ['host_telegram_chat_id', 'host_telegram_link_token', 'cancelled_by', 'reimbursement_cap_appeal_note']) {
      expect(safe).not.toContain(c);
    }
    expect(safe).toContain('has_password');
    expect(safe).toContain('co_hosts_public');
    expect(safe).not.toContain('co_hosts');
    expect(safe).not.toContain('password');
  });

  it('the lockdown runner GRANT list is the JSON allowlist (no inline column list)', () => {
    const src = read('backend/scripts/apply-lockdown-parties-columns.cjs');
    expect(src).toMatch(/const allow = ALLOW_ALL\.filter\(/);
    expect(src).toContain('GRANT SELECT (${allow.map(q).join');
    // JSON allowlist == SAFE_PARTY_COLUMNS (so runner GRANT == SAFE_PARTY_COLUMNS)
    const allow: string[] = JSON.parse(read('scripts/parties-anon-columns.json'));
    expect(allow.length).toBe(safe.length);
    expect(new Set(allow)).toEqual(new Set(safe));
  });

  it('the CI check script parses SAFE_PARTY_COLUMNS from supabase.ts', () => {
    expect(read('scripts/check-rls-anon-exposure.js')).toContain('SAFE_PARTY_COLUMNS');
  });

  it('the lockdown runner reads the same allowlist file', () => {
    const src = read('backend/scripts/apply-lockdown-parties-columns.cjs');
    expect(src).toContain('scripts/parties-anon-columns.json');
    expect(src).toContain('scripts/anon-sensitive-columns.json');
  });
});

describe('no anon select-star against parties', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
        walk(rel);
      } else if (/\.(ts|tsx|js)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(rel);
    }
  };
  walk('frontend/src');
  walk('frontend/api');
  files.push('scripts/generate-og-meta.js');

  it('REST select=* on /parties is never used', () => {
    const offenders = files.filter((f) => /rest\/v1\/parties[^`'"]*select=\*/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("supabase .from('parties').select('*') is never used", () => {
    const offenders = files.filter((f) => /from\('parties'\)\s*\.select\(\s*['"`]\*['"`]/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the OG function and build script select explicit columns that are all allowlisted', () => {
    const allow: string[] = JSON.parse(read('scripts/parties-anon-columns.json'));
    const fn = read('frontend/api/event/[slug].ts');
    const fnCols = /OG_PARTY_COLUMNS = '([^']+)'/.exec(fn)![1].split(',');
    const script = read('scripts/generate-og-meta.js');
    const scriptCols = /OG_COLUMNS = '([^']+)'/.exec(script)![1].split(',');
    expect(fnCols.filter((c) => !allow.includes(c))).toEqual([]);
    expect(scriptCols.filter((c) => !allow.includes(c))).toEqual([]);
  });

  it('the has-password probe no longer filters on the password column', () => {
    const src = read('frontend/src/lib/supabase.ts');
    expect(src).not.toMatch(/\.not\('password'/);
  });
});

describe('mergeHostOnlyPartyFields', () => {
  const base = () => ({ id: 'p1', co_hosts: [{ id: 'a' }] } as unknown as DbParty);

  it('merges host-only fields when the API says the caller can edit', () => {
    const p = base();
    mergeHostOnlyPartyFields(p, {
      canEdit: true,
      allowedTabs: ['details'],
      coHosts: [{ id: 'a', email: 'x@y.z' }],
      hostTelegramChatId: '12345',
      hostTelegramLinkToken: 'tok',
      reimbursementCapAppealNote: 'please',
      cancelledBy: 'host@example.com',
      password: 'secret',
    });
    expect(p.host_telegram_chat_id).toBe('12345');
    expect(p.host_telegram_link_token).toBe('tok');
    expect(p.reimbursement_cap_appeal_note).toBe('please');
    expect(p.cancelled_by).toBe('host@example.com');
    expect(p.can_edit).toBe(true);
    expect(p.allowed_tabs).toEqual(['details']);
    expect(p.co_hosts).toEqual([{ id: 'a', email: 'x@y.z' }]);
    // The password is intentionally NOT surfaced to the client by this stage.
    expect((p as unknown as Record<string, unknown>).password).toBeUndefined();
  });

  it('does not merge host-only fields when canEdit is not true', () => {
    const p = base();
    mergeHostOnlyPartyFields(p, { canEdit: false, hostTelegramChatId: '1', reimbursementCapAppealNote: 'n' });
    expect(p.host_telegram_chat_id).toBeUndefined();
    expect(p.reimbursement_cap_appeal_note).toBeUndefined();
  });

  it('keeps null host fields as null and ignores a missing API party', () => {
    const p = base();
    mergeHostOnlyPartyFields(p, { canEdit: true, hostTelegramChatId: null });
    expect(p.host_telegram_chat_id).toBeNull();
    expect(() => mergeHostOnlyPartyFields(p, undefined)).not.toThrow();
  });
});

describe('preserveHostOnlyFields', () => {
  it('carries host-only fields from the loaded party onto a re-read party', () => {
    const prev = { hostTelegramChatId: '9', hostTelegramLinkToken: 't', reimbursementCapAppealNote: 'n', cancelledBy: 'e' } as Party;
    const next = { hostTelegramChatId: null, hostTelegramLinkToken: null, reimbursementCapAppealNote: null, cancelledBy: null } as Party;
    preserveHostOnlyFields(next, prev);
    expect(next.hostTelegramChatId).toBe('9');
    expect(next.hostTelegramLinkToken).toBe('t');
    expect(next.reimbursementCapAppealNote).toBe('n');
    expect(next.cancelledBy).toBe('e');
  });
});
