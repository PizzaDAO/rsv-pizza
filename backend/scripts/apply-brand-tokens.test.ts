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

  // The variable set each old `.<slug>-theme` block resolved to (final values, after the QA overrides).
  const OLD_VARS: Record<string, Record<string, string>> = {
    team1: {
      '--bg-main': '#000000', '--bg-card': '#1a1b1c', '--bg-card-hover': '#222324', '--bg-surface': '#161617',
      '--bg-surface-hover': '#1f2021', '--bg-overlay': 'rgba(0, 0, 0, 0.72)', '--bg-input': '#1a1b1c',
      '--bg-input-focus': '#222324', '--bg-header': 'rgba(0, 0, 0, 0.9)', '--text-primary': '#ffffff',
      '--text-secondary': '#e5e7eb', '--text-muted': '#9ca3af', '--text-faint': 'rgba(255, 255, 255, 0.55)',
      '--text-inverted': '#1a1a1a', '--stroke': '#2a2d31', '--stroke-hover': '#3d4147', '--stroke-strong': '#565b63',
      '--accent': '#e6212f', '--accent-hover': '#ff4d5a', '--success': '#39d98a', '--warning': '#ffb347',
      '--error': '#ff4d5a', '--color-scheme': 'dark',
    },
    monad: {
      '--bg-main': '#fafafa', '--bg-card': '#ffffff', '--bg-card-hover': '#f6f4ff', '--bg-surface': '#ffffff',
      '--bg-surface-hover': '#f6f4ff', '--bg-overlay': 'rgba(14, 9, 28, 0.55)', '--bg-input': '#ffffff',
      '--bg-input-focus': '#ffffff', '--bg-header': '#fdfcfb', '--text-primary': '#111111',
      '--text-secondary': 'rgba(17, 17, 17, 0.78)', '--text-muted': 'rgba(17, 17, 17, 0.66)',
      '--text-faint': 'rgba(17, 17, 17, 0.64)', '--text-inverted': '#ffffff', '--stroke': '#e5e3ec',
      '--stroke-hover': '#c9c2f5', '--stroke-strong': '#6e54ff', '--accent': '#6e54ff', '--accent-hover': '#5a41e8',
      '--success': '#1f7a45', '--warning': '#8a5a00', '--error': '#b3261e', '--color-scheme': 'light',
    },
    swc: {
      '--bg-main': '#ffffff', '--bg-card': '#f2f5f9', '--bg-card-hover': '#eaeff6', '--bg-surface': '#f2f5f9',
      '--bg-surface-hover': '#eaeff6', '--bg-overlay': 'rgba(19, 0, 59, 0.55)', '--bg-input': '#ffffff',
      '--bg-input-focus': '#ffffff', '--bg-header': '#ffffff', '--text-primary': '#020817',
      '--text-secondary': 'rgba(2, 8, 23, 0.8)', '--text-muted': '#52607a', '--text-faint': 'rgba(2, 8, 23, 0.64)',
      '--text-inverted': '#ffffff', '--stroke': '#dbe4f0', '--stroke-hover': '#caabff', '--stroke-strong': '#6c11ff',
      '--accent': '#6c11ff', '--accent-hover': '#5a0de0', '--success': '#1f7a45', '--warning': '#8a5a00',
      '--error': '#b3261e', '--color-scheme': 'light',
    },
  };

  for (const slug of ['team1', 'monad', 'swc']) {
    it(`${slug} derives exactly the variables the old .${slug}-theme block resolved to, with the build-time env values`, () => {
      expect(Object.keys(data)).toContain(slug);
      expect(data[slug].themeClass).toBe(`brand-${slug}`);
      const t = parseThemeTokens(data[slug].themeTokens, { allowOverrides: true });
      if (!t.ok) throw new Error(t.errors.join('; '));
      const v = deriveThemeVars(t.tokens);
      for (const [k, want] of Object.entries(OLD_VARS[slug])) expect(v[k], `${slug} ${k}`).toBe(want);
      expect(t.tokens.hideHeaderName).toBe(true);
      expect(t.tokens.hideHeroLogo).toBe(true);
    });
  }

  it('team1 / monad / swc reproduce each brand project\'s VITE_BRAND_* tagline, description and favicon', () => {
    expect(data.team1.tagline).toBe('Pizza parties for the Team1 community');
    expect(data.team1.metaDescription).toBe('RSVP and plan pizza parties for the Team1 community.');
    expect(data.team1.faviconUrl).toBe('/brands/team1/logo.png'); // no VITE_BRAND_FAVICON_URL: the logo
    expect(data.monad.tagline).toBe('Pizza parties for the Monad community');
    expect(data.monad.metaDescription).toBe('RSVP and plan pizza parties for the Monad community.');
    expect(data.monad.faviconUrl).toBe('/brands/monad/logo.png');
    expect(data.swc.tagline).toBe('Crypto meetups');
    expect(data.swc.metaDescription).toBe('Host or join a Stand With Crypto meetup. Pizza, community and crypto advocacy.');
    expect(data.swc.faviconUrl).toBe('/brands/swc/favicon.png');
  });

  it('does not loosen the validator: low-contrast or wrong-mode tokens are rejected', () => {
    const bad = { ...data.doge, themeTokens: { ...data.doge.themeTokens, textMuted: '#d9cfb8' } };
    expect(runner.validateEntry(bad).ok).toBe(false);
    const wrongMode = { ...data.doge, themeTokens: { ...data.doge.themeTokens, mode: 'dark' } };
    expect(runner.validateEntry(wrongMode).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, themeClass: 'bad class!' }).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, surprise: 1 }).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, tagline: 'x'.repeat(81) }).ok).toBe(false);
    expect(runner.validateEntry({ ...data.doge, metaDescription: 'x'.repeat(201) }).ok).toBe(false);
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
        audits.push({ id: 'a' + audits.length, series_id: p[0], actor_email: p[1], actor_kind: 'system', action: p[2], changes: JSON.parse(p[3]), snapshot: JSON.parse(p[4]), created_at: audits.length });
        return 1;
      }
      throw new Error('unexpected exec: ' + sql);
    },
    async $queryRawUnsafe(sql: string, ...p: any[]) {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (/FROM event_series/.test(sql)) return p[0] === row.slug ? [{ ...row }] : [];
      if (/FROM series_audit/.test(sql)) {
        return audits.filter((a) => a.action === 'brand-tokens.apply' || a.action === 'brand-tokens.rollback').sort((a, b) => b.created_at - a.created_at);
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
    expect(data.doge.faviconUrl).toBe('/brands/doge/favicon.png');
    expect(data.doge.tagline).toBe('Pizza parties for Doge Day, Nov 2 2027');
    expect(data.doge.metaDescription).toBe('Throw a pizza party for Doge Day on November 2, 2027.');
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

  it('two applies then two rollbacks step back one apply at a time; a third has nothing left', async () => {
    const db = fakeDb({ tagline: 'T0' });
    await runner.applyEntry(db, 'doge', entry()); // T0 -> data tagline
    const second = { ...entry(), tagline: 'Second tagline' };
    await runner.applyEntry(db, 'doge', second);
    expect(db.row.tagline).toBe('Second tagline');
    await runner.rollbackEntry(db, 'doge');
    expect(db.row.tagline).toBe(data.doge.tagline); // undid apply #2 only
    expect(db.row.theme_class).toBe('brand-doge');
    await runner.rollbackEntry(db, 'doge');
    expect(db.row.tagline).toBe('T0'); // undid apply #1
    expect(db.row.theme_class).toBe('doge-theme');
    expect(db.row.theme_tokens).toBeNull();
    expect(db.audits.map((a) => a.action)).toEqual(['brand-tokens.apply', 'brand-tokens.apply', 'brand-tokens.rollback', 'brand-tokens.rollback']);
    expect(db.audits[2].snapshot._undoes).toBe('a1');
    expect(db.audits[3].snapshot._undoes).toBe('a0');
    await expect(runner.rollbackEntry(db, 'doge')).rejects.toThrow(/nothing to roll back/);
  });

  it('rollback refuses after an intervening edit (names the drifted fields) unless forced', async () => {
    const db = fakeDb({ tagline: 'T0' });
    await runner.applyEntry(db, 'doge', entry());
    db.row.tagline = 'Edited by a brand admin';
    await expect(runner.rollbackEntry(db, 'doge')).rejects.toThrow(/drifted: tagline/);
    expect(db.row.tagline).toBe('Edited by a brand admin');
    expect(db.audits).toHaveLength(1);
    const r = await runner.rollbackEntry(db, 'doge', { force: true });
    expect(r.drifted).toEqual(['tagline']);
    expect(db.row.tagline).toBe('T0');
  });

  it('rollback only restores fields the apply changed (a later edit to an untouched field survives)', async () => {
    const db = fakeDb({ tagline: data.doge.tagline }); // apply leaves tagline alone
    await runner.applyEntry(db, 'doge', entry());
    db.row.tagline = 'Later edit';
    await runner.rollbackEntry(db, 'doge');
    expect(db.row.tagline).toBe('Later edit');
    expect(db.row.theme_class).toBe('doge-theme');
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
