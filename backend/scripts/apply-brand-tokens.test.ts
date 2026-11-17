/**
 * apply-brand-tokens.cjs, without a database: the data file passes the API's validators (contrast,
 * mode-vs-bg), derives exactly the variables the old doge theme set, the runner defaults to the dry
 * run and only uses SET LOCAL, and apply / re-apply / rollback behave against an in-memory fake of the
 * two tables (config_version bump, system audit row, snapshot restore).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import { parseThemeTokens, deriveThemeVars, checkThemeContrast } from '../src/lib/themeTokens.js';

const require = createRequire(import.meta.url);
const runner = require('./apply-brand-tokens.cjs');
const SRC = fs.readFileSync(require.resolve('./apply-brand-tokens.cjs'), 'utf8');
const data = runner.loadData();

describe('data file', () => {
  it('has the doge entry and every entry passes the API validator (shape, mode vs bg, AA contrast)', () => {
    expect(Object.keys(data)).toContain('doge');
    for (const [slug, entry] of Object.entries<any>(data)) {
      const v = runner.validateEntry(entry);
      expect(v.errors, slug).toEqual([]);
      expect(v.ok, slug).toBe(true);
      expect(checkThemeContrast(v.tokens).filter((f) => f.blocking), slug).toEqual([]);
    }
  });

  it('doge derives exactly the variables the old .doge-theme block set', () => {
    const t = parseThemeTokens(data.doge.themeTokens, { allowOverrides: true });
    if (!t.ok) throw new Error(t.errors.join('; '));
    const v = deriveThemeVars(t.tokens);
    const old: Record<string, string> = {
      '--bg-main': '#f4ebd7', '--bg-card': '#fcf4e1', '--bg-card-hover': '#fff6e3', '--bg-surface': '#fcf4e1',
      '--bg-surface-hover': '#fff6e3', '--bg-overlay': 'rgba(48, 45, 37, 0.55)', '--bg-input': '#fcf4e1',
      '--bg-input-focus': '#fff6e3', '--bg-header': '#f4ebd7', '--text-primary': '#302d25',
      '--text-secondary': 'rgba(48, 45, 37, 0.85)', '--text-muted': 'rgba(48, 45, 37, 0.7)',
      '--text-faint': 'rgba(48, 45, 37, 0.72)', '--text-inverted': '#f4ebd7', '--stroke': 'rgba(48, 45, 37, 0.35)',
      '--stroke-hover': 'rgba(48, 45, 37, 0.6)', '--stroke-strong': '#302d25', '--accent': '#302d25',
      '--accent-hover': '#4a463b', '--success': '#1f7a45', '--warning': '#8a5a00', '--error': '#b3261e',
      '--color-scheme': 'light',
    };
    for (const [k, want] of Object.entries(old)) expect(v[k], k).toBe(want);
    expect(t.tokens.hideHeaderName).toBe(true);
    expect(t.tokens.hideHeroLogo).toBe(true);
  });

  it('does not loosen the validator: low-contrast or wrong-mode tokens are rejected', () => {
    const bad = { ...data.doge, themeTokens: { ...data.doge.themeTokens, textMuted: '#d9cfb8' } };
    expect(runner.validateEntry(bad).ok).toBe(false);
    const wrongMode = { ...data.doge, themeTokens: { ...data.doge.themeTokens, mode: 'dark' } };
    expect(runner.validateEntry(wrongMode).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, themeClass: 'bad class!' }).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, surprise: 1 }).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, faviconUrl: 'javascript:alert(1)' }).ok).toBe(false);
  });
});

describe('runner source', () => {
  it('defaults to the dry run and never issues a session-level SET', () => {
    expect(runner.MODE).toBe('dry');
    expect(SRC).toContain("const MODE = ARGS.includes('--apply') ? 'apply' : ARGS.includes('--rollback') ? 'rollback' : 'dry'");
    expect(SRC).toContain('SET LOCAL lock_timeout');
    expect(SRC).toContain('SET LOCAL statement_timeout');
    expect(SRC).not.toMatch(/\$executeRawUnsafe\(`SET (?!LOCAL)/);
    expect(SRC).not.toMatch(/SET (?!LOCAL)(SESSION|ROLE|search_path|statement_timeout|lock_timeout)/);
  });

  it('requires --slug for apply and rollback', () => {
    expect(SRC).toContain('needs --slug <slug>');
  });
});

// ---- in-memory fake of event_series + series_audit ------------------------------------------------

function fakeDb(initial: Record<string, any> = {}) {
  const row: Record<string, any> = {
    id: '11111111-1111-1111-1111-111111111111', slug: 'doge', theme_class: 'doge-theme', theme_tokens: null,
    tagline: null, meta_description: null, favicon_url: null, config_version: 1, ...initial,
  };
  const audits: any[] = [];
  const log: string[] = [];
  const db = {
    row, audits, log,
    async $executeRawUnsafe(sql: string, ...p: any[]) {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (/^SET LOCAL/.test(sql)) return 0;
      if (/^UPDATE event_series SET/.test(sql)) {
        const sets = [...sql.matchAll(/(\w+) = \$(\d+)(::jsonb)?/g)];
        for (const m of sets) {
          const v = p[Number(m[2]) - 1];
          row[m[1]] = m[3] && v !== null ? JSON.parse(v) : v;
        }
        row.config_version += 1;
        return 1;
      }
      if (/^INSERT INTO series_audit/.test(sql)) {
        audits.push({ series_id: p[0], actor_email: p[1], actor_kind: 'system', action: p[2], changes: JSON.parse(p[3]), snapshot: JSON.parse(p[4]), created_at: audits.length });
        return 1;
      }
      throw new Error('unexpected exec: ' + sql);
    },
    async $queryRawUnsafe(sql: string, ...p: any[]) {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (/FROM event_series/.test(sql)) return p[0] === row.slug ? [{ ...row }] : [];
      if (/FROM series_audit/.test(sql)) {
        const mine = audits.filter((a) => a.action === 'brand-tokens.apply').sort((a, b) => b.created_at - a.created_at);
        return mine.slice(0, 1);
      }
      throw new Error('unexpected query: ' + sql);
    },
  };
  return db;
}

describe('apply / rollback against a fake database', () => {
  const entry = () => {
    const v = runner.validateEntry(data.doge);
    if (!v.ok) throw new Error('doge invalid');
    return { ...data.doge, themeTokens: v.tokens };
  };

  it('apply: updates the row, bumps config_version once, writes ONE system audit row with the previous values', async () => {
    const db = fakeDb();
    const r = await runner.applyEntry(db, 'doge', entry());
    expect(r.changed).toBe(true);
    expect(db.row.theme_class).toBe('brand-doge');
    expect(db.row.theme_tokens.hideHeaderName).toBe(true);
    expect(db.row.favicon_url).toBe(data.doge.faviconUrl);
    expect(db.row.config_version).toBe(2);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0].actor_kind).toBe('system');
    expect(db.audits[0].action).toBe('brand-tokens.apply');
    expect(db.audits[0].snapshot.themeClass).toBe('doge-theme');
    expect(db.audits[0].snapshot.themeTokens).toBeNull();
    expect(Object.keys(db.audits[0].changes)).toContain('themeTokens');
    // timeouts are SET LOCAL and come before any write
    expect(db.log[0]).toMatch(/^SET LOCAL lock_timeout/);
    expect(db.log[1]).toMatch(/^SET LOCAL statement_timeout/);
    expect(db.log.some((l) => /^SET (?!LOCAL)/.test(l))).toBe(false);
  });

  it('re-apply is a no-op: no write, no audit row, no version bump (jsonb key order is not a change)', async () => {
    const db = fakeDb();
    await runner.applyEntry(db, 'doge', entry());
    const reordered = { ...db.row, theme_tokens: Object.fromEntries(Object.entries(db.row.theme_tokens).reverse()) };
    Object.assign(db.row, reordered);
    const r = await runner.applyEntry(db, 'doge', entry());
    expect(r.changed).toBe(false);
    expect(db.audits).toHaveLength(1);
    expect(db.row.config_version).toBe(2);
  });

  it('rollback restores the audited previous values, bumps the version and writes a rollback audit row', async () => {
    const db = fakeDb({ tagline: 'Old tagline' });
    await runner.applyEntry(db, 'doge', entry());
    expect(db.row.tagline).not.toBe('Old tagline');
    const r = await runner.rollbackEntry(db, 'doge');
    expect(r.changed).toBe(true);
    expect(db.row.theme_class).toBe('doge-theme');
    expect(db.row.theme_tokens).toBeNull();
    expect(db.row.tagline).toBe('Old tagline');
    expect(db.row.favicon_url).toBeNull();
    expect(db.row.config_version).toBe(3);
    expect(db.audits.map((a) => a.action)).toEqual(['brand-tokens.apply', 'brand-tokens.rollback']);
    expect(db.audits[1].actor_kind).toBe('system');
  });

  it('rollback with no apply audit row refuses; an unknown slug throws', async () => {
    await expect(runner.rollbackEntry(fakeDb(), 'doge')).rejects.toThrow(/nothing to roll back/);
    await expect(runner.applyEntry(fakeDb(), 'nope', entry())).rejects.toThrow(/no event_series row/);
  });

  it('formatDiff marks every changed key', () => {
    const out = runner.formatDiff({ themeClass: 'doge-theme', themeTokens: null }, entry());
    expect(out).toContain('* theme_class: doge-theme -> brand-doge');
    expect(out).toContain('* theme_tokens.mode: (unset) -> light');
    expect(out).toContain('theme_tokens.overrides.--stroke');
  });
});
