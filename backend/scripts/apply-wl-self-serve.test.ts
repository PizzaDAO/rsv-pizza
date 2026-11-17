/**
 * wl-self-serve migration + runner, statically (no DB): the SQL file is what the runner executes,
 * every new table gets RLS + REVOKE and is on the anon-no-access list, nothing destructive or
 * session-level, the runner's expected spec matches the file, the default mode is the dry run, and
 * `problems()` flags each unsafe state. The runner was also exercised end to end (dry run, apply,
 * re-apply, verify, rollback) against a throwaway Postgres; see the PR description.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const runner = require('./apply-wl-self-serve.cjs');
const SQL: string = fs.readFileSync(runner.MIGRATION, 'utf8');
const RUNNER_SRC = fs.readFileSync(require.resolve('./apply-wl-self-serve.cjs'), 'utf8');
const stmts: string[] = runner.splitStatements(SQL);

describe('20261118_wl_self_serve migration.sql', () => {
  it('is additive: no DROP / DELETE / TRUNCATE / GRANT / policy / realtime / BEGIN / SET', () => {
    const body = stmts.join(';\n');
    expect(body).not.toMatch(/\bDROP\b|(?<!ON )\bDELETE\b|\bTRUNCATE\b|\bGRANT\b|CREATE POLICY|supabase_realtime|\$\$/i);
    for (const s of stmts) expect(s).not.toMatch(/^(BEGIN|COMMIT|SET)\b/i);
  });

  it('adds exactly the event_series columns the runner expects, all nullable or defaulted', () => {
    const added = [...SQL.matchAll(/ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "(\w+)" ([^;]+);/g)];
    expect(added.map((m) => m[1]).sort()).toEqual(Object.keys(runner.SERIES_COLUMNS).sort());
    for (const [, name, def] of added) {
      if (/NOT NULL/.test(def)) expect(def, name).toMatch(/DEFAULT/);
    }
  });

  it('creates the two new tables and locks each down (RLS on, REVOKE anon + authenticated)', () => {
    const created = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]);
    expect(created).toEqual(Object.keys(runner.TABLES));
    for (const t of created) {
      expect(SQL).toContain(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`);
      expect(SQL).toContain(`REVOKE ALL ON "${t}" FROM anon;`);
      expect(SQL).toContain(`REVOKE ALL ON "${t}" FROM authenticated;`);
    }
    // only event_series (ADD COLUMN) and the new tables are altered
    const alters = [...SQL.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(alters.every((t) => t === 'event_series' || created.includes(t))).toBe(true);
  });

  it('lists both new tables in scripts/anon-no-access-tables.json (CI guard C1)', () => {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/anon-no-access-tables.json'), 'utf8'));
    for (const t of Object.keys(runner.TABLES)) expect(list.tables).toContain(t);
  });

  it('keeps the role / status / actor_kind CHECKs and the (series_id, email) unique index', () => {
    expect(SQL).toContain(`CHECK ("role" IN ('owner', 'editor'))`);
    expect(SQL).toContain(`CHECK ("status" IN ('invited', 'active', 'revoked'))`);
    expect(SQL).toContain(`CHECK ("actor_kind" IN ('super_admin', 'series_admin', 'system'))`);
    expect(SQL).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "series_admins_series_id_email_key" ON "series_admins" ("series_id", "email")');
  });

  it('every Prisma-declared new column exists in the migration', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const block = (name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))![0];
    for (const [model, table] of [['SeriesAdmin', 'series_admins'], ['SeriesAudit', 'series_audit']] as const) {
      const cols = Object.keys(runner.TABLES[table].columns);
      const mapped = [...block(model).matchAll(/(?<!@)@map\("(\w+)"\)/g)].map((m) => m[1]);
      for (const c of mapped) expect(cols, `${table}.${c}`).toContain(c);
    }
    const series = block('EventSeries');
    for (const c of Object.keys(runner.SERIES_COLUMNS)) {
      expect(series.includes(`@map("${c}")`) || new RegExp(`^\\s+${c}\\s`, 'm').test(series), c).toBe(true);
    }
  });
});

describe('apply-wl-self-serve.cjs', () => {
  it('defaults to the dry run and never issues a session-level SET', () => {
    expect(runner.MODE).toBe('dry'); // vitest passes no --apply / --rollback
    const sets = [...RUNNER_SRC.matchAll(/`SET\s+(\w+)/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((w) => w === 'LOCAL')).toBe(true);
  });

  it('only writes behind --apply / --rollback', () => {
    // every $executeRawUnsafe sits after the dry-run early return
    const dryReturn = RUNNER_SRC.indexOf("console.log('\\nDRY RUN: nothing changed.');");
    const firstWrite = RUNNER_SRC.indexOf('$executeRawUnsafe');
    expect(dryReturn).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(dryReturn);
  });

  // A state that passes every check, then broken one way at a time.
  const good = () => {
    const seriesCols = Object.entries(runner.SERIES_COLUMNS).map(([c, [t, nullable]]: any) => ({
      column_name: c, data_type: t, is_nullable: nullable ? 'YES' : 'NO',
    }));
    const tables: Record<string, any> = {};
    for (const [name, spec] of Object.entries<any>(runner.TABLES)) {
      tables[name] = {
        exists: true, rows: 0, rls: true, policies: [], fks: spec.fks, checks: spec.checks,
        privs: { anon: [], authenticated: [] },
        idx: Object.fromEntries(spec.indexes.map((i: string) => [i, true])),
        cols: Object.entries(spec.columns).map(([c, [t, nullable]]: any) => ({
          column_name: c, data_type: t, is_nullable: nullable ? 'YES' : 'NO',
        })),
      };
    }
    return { series: { cols: seriesCols }, tables, seriesRows: 6 };
  };

  it('passes a correct state', () => {
    expect(runner.problems(good())).toEqual([]);
  });

  it('flags a missing event_series column, a missing table, RLS off, an anon grant and a policy', () => {
    const a = good(); a.series.cols.pop();
    expect(runner.problems(a).join()).toMatch(/event_series\.\w+ missing/);

    const b = good(); b.tables.series_admins = { exists: false };
    expect(runner.problems(b)).toContain('series_admins does not exist');

    const c = good(); c.tables.series_audit.rls = false;
    expect(runner.problems(c).join()).toMatch(/series_audit: row level security is OFF/);

    const d = good(); d.tables.series_admins.privs.anon = ['SELECT'];
    expect(runner.problems(d).join()).toMatch(/series_admins: anon holds SELECT/);

    const e = good(); e.tables.series_audit.privs.authenticated = ['INSERT'];
    expect(runner.problems(e).join()).toMatch(/authenticated holds INSERT/);

    const f = good(); f.tables.series_admins.policies = ['p'];
    expect(runner.problems(f).join()).toMatch(/unexpected policies/);

    const g = good(); g.tables.series_admins.idx.series_admins_email_idx = false;
    expect(runner.problems(g).join()).toMatch(/index series_admins_email_idx missing/);
  });
});
