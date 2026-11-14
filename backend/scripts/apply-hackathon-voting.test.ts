/**
 * PR 7 migration + runner, statically (no DB): the SQL file is what the runner executes, every
 * new table gets RLS + REVOKE, no session-level SET, the runner's expected spec matches the
 * file, the default mode is the dry run, and `problems()` flags each unsafe state. The runner
 * itself was exercised end to end (dry run, apply, re-apply, verify, guarded rollback) against a
 * throwaway Postgres 17; see the PR description.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const runner = require('./apply-hackathon-voting.cjs');
const SQL = fs.readFileSync(runner.MIGRATION, 'utf8');
const RUNNER_SRC = fs.readFileSync(require.resolve('./apply-hackathon-voting.cjs'), 'utf8');

describe('hackathon-2-voting.sql', () => {
  const stmts: string[] = runner.splitStatements(SQL);

  it('runs as statements without its own BEGIN / COMMIT / SET LOCAL (the runner wraps them)', () => {
    expect(stmts).toHaveLength(11);
    for (const s of stmts) expect(s).not.toMatch(/^(BEGIN|COMMIT|SET)\b/i);
    expect(SQL).toMatch(/^BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '30s';/);
    expect(SQL.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('only creates the two new tables (no ALTER of an existing table) and every one is locked down', () => {
    const created = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(['hackathon_voting', 'hackathon_votes']);
    expect(created).toEqual(runner.NAMES);
    for (const t of created) {
      expect(SQL).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      expect(SQL).toContain(`REVOKE ALL ON ${t} FROM anon, authenticated;`);
    }
    const alters = [...SQL.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]);
    expect(alters.every((t) => created.includes(t))).toBe(true);
    expect(stmts.join(";\n")).not.toMatch(/\bGRANT\b|CREATE POLICY|supabase_realtime|\$\$/i); // statements, not comments
  });

  it('keeps the one-vote-per-scope expression index, composite same-hackathon FKs and the HMAC-only ip_hash', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS hackathon_votes_one_per_scope\s+ON hackathon_votes\(hackathon_id, \(COALESCE\(track_id, '00000000-0000-0000-0000-000000000000'::uuid\)\), voter_user_id\)/);
    expect(SQL).toMatch(/FOREIGN KEY \(submission_id, hackathon_id\)\s+REFERENCES hackathon_submissions\(id, hackathon_id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/FOREIGN KEY \(track_id, hackathon_id\)\s+REFERENCES hackathon_tracks\(id, hackathon_id\) ON DELETE CASCADE/);
    expect(SQL).toContain("ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$')");
    expect(SQL).toContain("eligibility text NOT NULL DEFAULT 'checked_in'");
  });
});

describe('apply-hackathon-voting.cjs', () => {
  it('defaults to the dry run and never issues a session-level SET', () => {
    expect(runner.MODE).toBe('dry'); // vitest passes no --apply / --rollback
    expect(runner.LOCK_TIMEOUT).toBe('3s');
    const sets = [...RUNNER_SRC.matchAll(/`SET\s+(\w+)/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((w) => w === 'LOCAL')).toBe(true);
    expect(RUNNER_SRC).not.toMatch(/ARGS\.includes\('--force'\)/); // the rollback guard has no override
  });

  // A state that passes every check, then broken one way at a time.
  const good = () => {
    const tables: Record<string, any> = {};
    for (const [t, spec] of Object.entries<any>(runner.TABLES)) {
      tables[t] = {
        exists: true,
        cols: Object.entries(spec.cols).map(([column_name, data_type]) => ({ column_name, data_type })),
        rls: true,
        idx: [...spec.idx],
        idxDefs: Object.fromEntries(Object.entries<string[]>(spec.exprIdx ?? {}).map(([n, parts]) => [n, `CREATE UNIQUE INDEX ${n} ON public.${t} USING btree (${parts.join(' ')})`])),
        fks: { ...spec.fks },
        checks: 1,
        seqs: [],
        privs: { anon: [], authenticated: [] },
        policies: [],
        rows: 0,
      };
    }
    return { tables, realtime: [] as string[] };
  };

  it('a correct state has no problems', () => {
    expect(runner.problems(good())).toEqual([]);
  });

  it('flags missing tables, RLS off, policies, any anon/authenticated privilege (incl. sequences), realtime', () => {
    const cases: Array<[(s: any) => void, RegExp]> = [
      [(s) => { s.tables.hackathon_votes = { exists: false }; }, /hackathon_votes does not exist/],
      [(s) => { s.tables.hackathon_voting.rls = false; }, /row level security is OFF/],
      [(s) => { s.tables.hackathon_votes.policies = ['p']; }, /unexpected policies/],
      [(s) => { s.tables.hackathon_votes.privs.anon = ['SELECT']; }, /anon holds SELECT/],
      [(s) => { s.tables.hackathon_voting.privs.authenticated = ['SEQUENCE x USAGE']; }, /authenticated holds SEQUENCE/],
      [(s) => { s.realtime = ['hackathon_votes']; }, /supabase_realtime/],
    ];
    for (const [mut, re] of cases) {
      const s = good();
      mut(s);
      expect(runner.problems(s).join('\n')).toMatch(re);
    }
  });

  it('flags schema drift: column type, extra column, missing index, wrong expression index, FK rule', () => {
    const cases: Array<[(s: any) => void, RegExp]> = [
      [(s) => { s.tables.hackathon_votes.cols.find((c: any) => c.column_name === 'ip_hash').data_type = 'inet'; }, /ip_hash: expected text, got inet/],
      [(s) => { s.tables.hackathon_votes.cols.push({ column_name: 'ip', data_type: 'text' }); }, /hackathon_votes\.ip: unexpected column/],
      [(s) => { s.tables.hackathon_votes.idx = s.tables.hackathon_votes.idx.filter((i: string) => i !== 'hackathon_votes_one_per_scope'); }, /one_per_scope missing/],
      [(s) => { s.tables.hackathon_votes.idxDefs.hackathon_votes_one_per_scope = 'CREATE UNIQUE INDEX x ON t (hackathon_id, voter_user_id)'; }, /unexpected definition/],
      [(s) => { s.tables.hackathon_votes.fks.hackathon_votes_submission_id_hackathon_id_fkey = 'NO ACTION'; }, /expected ON DELETE CASCADE, got NO ACTION/],
      [(s) => { s.tables.hackathon_votes.fks.extra_fkey = 'CASCADE'; }, /unexpected FK extra_fkey/],
    ];
    for (const [mut, re] of cases) {
      const s = good();
      mut(s);
      expect(runner.problems(s).join('\n')).toMatch(re);
    }
  });
});
