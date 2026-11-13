/**
 * guests-anon-exposure: the public (anon) key must never touch `guests` or `user_preferences`.
 * Guest reads go through the backend; live updates use the `guests:<partyId>` broadcast.
 * See plans/guests-anon-exposure.md.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { GUESTS_BROADCAST_EVENT, GUESTS_TOPIC_PREFIX } from '../lib/supabase';

const REPO = path.resolve(__dirname, '../../..');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const FORBIDDEN = [
  /\.from\(\s*['"`]guests['"`]\s*\)/,
  /\.from\(\s*['"`]user_preferences['"`]\s*\)/,
  /rest\/v1\/guests/,
  /rest\/v1\/user_preferences/,
  /postgres_changes/,
];

describe('no anon access to guests / user_preferences', () => {
  const files = [
    ...walk(path.join(REPO, 'frontend/src'), ['.ts', '.tsx']),
    ...walk(path.join(REPO, 'frontend/api'), ['.ts', '.tsx', '.js']),
    ...walk(path.join(REPO, 'scripts'), ['.js']),
  ].filter((f) => !fs.readFileSync(f, 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY'));

  it('scans a non-trivial set of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no forbidden references', () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) if (re.test(src)) hits.push(`${path.relative(REPO, f)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('guests broadcast contract', () => {
  it('uses the agreed topic prefix and event name', () => {
    expect(GUESTS_TOPIC_PREFIX).toBe('guests:');
    expect(GUESTS_BROADCAST_EVENT).toBe('guests_changed');
  });

  it('matches the Migration A SQL when that migration is present', () => {
    const dir = path.join(REPO, 'backend/prisma/migrations');
    const m = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => d.includes('guests_broadcast_trigger')) : undefined;
    if (!m) return; // backend PR (guests-anon-api) not merged into this branch yet
    const sql = fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8');
    expect(sql).toContain(GUESTS_BROADCAST_EVENT);
    expect(sql).toContain(`'${GUESTS_TOPIC_PREFIX}`);
  });
});

// ---------------------------------------------------------------------------------------------
// PR2 guests-anon-lockdown: Migration B, its runner, and the CI guards C1/C3/C4.
// ---------------------------------------------------------------------------------------------
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION_B = 'backend/prisma/migrations/20261113_guests_anon_lockdown/migration.sql';
const RUNNER_B = 'backend/scripts/apply-lockdown-guests.cjs';

describe('Migration B (guests anon lockdown)', () => {
  const sql = read(MIGRATION_B).replace(/--[^\n]*/g, '');
  const runner = read(RUNNER_B);

  it('revokes everything on both tables from anon and authenticated, and grants nothing', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.guests FROM anon, authenticated;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.user_preferences FROM anon, authenticated;/);
    expect(sql).not.toMatch(/\bGRANT\b/i);
  });

  it('drops guests from the realtime publication', () => {
    expect(sql).toMatch(/ALTER PUBLICATION supabase_realtime DROP TABLE public\.guests;/);
  });

  it('drops exactly the policies the runner can recreate on --rollback', () => {
    const dropped = [...sql.matchAll(/DROP POLICY IF EXISTS "([^"]+)" ON public\.(\w+);/g)].map((m) => `${m[2]}:${m[1]}`).sort();
    const restorable = [...runner.matchAll(/\{ table: '(\w+)', name: '([^']+)', cmd:/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(dropped.length).toBe(7);
    expect(dropped).toEqual(restorable);
    // the "false" write-deny policies on guests stay
    expect(sql).not.toMatch(/No public (insert|update|delete) on guests/);
  });

  it('the runner executes the migration file and never uses a session-level SET', () => {
    expect(runner).toContain('20261113_guests_anon_lockdown/migration.sql');
    const code = stripComments(runner);
    expect(code).not.toMatch(/\bSET\s+(?!LOCAL\b)(ROLE|lock_timeout|statement_timeout|search_path|session)/i);
    expect(code).toMatch(/SET LOCAL lock_timeout/);
    expect(code).toMatch(/SET LOCAL ROLE \$\{role\}/);
  });

  it('does not re-lock experiment_flags (D9 is done by the parties lockdown runner)', () => {
    expect(sql).not.toMatch(/experiment_flags/);
    expect(read('backend/scripts/apply-lockdown-parties-columns.cjs')).toMatch(/REVOKE SELECT ON public\.experiment_flags/);
  });
});

describe('CI guards C1/C3/C4 config', () => {
  const noAccess = JSON.parse(read('scripts/anon-no-access-tables.json'));
  const colAllow = JSON.parse(read('scripts/anon-column-allowlist.json'));
  const pubAllow = JSON.parse(read('scripts/realtime-publication-allowlist.json'));

  it('guests and user_preferences are no-access tables', () => {
    expect(noAccess.tables).toEqual(expect.arrayContaining(['guests', 'user_preferences']));
  });

  it('nothing on guests / user_preferences is allowlisted, and guests is never published', () => {
    expect(Object.keys(colAllow.allow).filter((k) => /^(guests|user_preferences)\./.test(k))).toEqual([]);
    expect(pubAllow.tables).not.toContain('guests');
    expect(pubAllow.tables).not.toContain('public.guests');
  });

  it('the workflow runs on changes to the guard config files', () => {
    const wf = read('.github/workflows/rls-anon-exposure.yml');
    expect(wf).toContain("'scripts/anon-*.json'");
    expect(wf).toContain("'scripts/realtime-publication-allowlist.json'");
    expect(wf).toContain("'frontend/src/lib/supabase.ts'");
  });
});

describe('CI guards C1/C3/C4 logic (fake catalog)', () => {
  const guards = createRequire(import.meta.url)(path.join(REPO, 'scripts/check-rls-anon-exposure.js'));

  type Row = Record<string, unknown>;
  function fakeCatalog(opts: { privs: boolean; permissive: string[]; published: string[]; anonCols: Record<string, string[]> }) {
    return async (sql: string, params: unknown[] = []): Promise<Row[]> => {
      if (sql.includes('to_regclass')) return [{ ok: ['guests', 'user_preferences'].includes(params[0] as string) }];
      if (sql.includes('has_any_column_privilege')) {
        const v = opts.privs;
        return [{ sel: v, ins: v, upd: v, del: v, trunc: v }];
      }
      if (sql.includes('FROM pg_policies')) return opts.permissive.map((t) => ({ t }));
      if (sql.includes('pg_publication_tables')) return opts.published.map((t) => ({ fq: `public.${t}`, s: 'public', t }));
      if (sql.includes('pg_attribute')) return (opts.anonCols[params[0] as string] || []).map((col) => ({ col }));
      throw new Error('unexpected query: ' + sql.slice(0, 80));
    };
  }

  it('fails on the pre-lockdown state (grants, permissive policy, published guests)', async () => {
    const q = fakeCatalog({
      privs: true,
      permissive: ['guests', 'user_preferences', 'slug_aliases'],
      published: ['guests'],
      anonCols: { guests: ['id', 'name', 'email', 'survey_token'], user_preferences: ['email'], slug_aliases: ['old_slug'] },
    });
    const out = await guards.guestsClassChecks(q);
    const text = out.fail.join('\n');
    expect(text).toMatch(/C1 anon still holds SELECT\/INSERT\/UPDATE\/DELETE\/TRUNCATE on guests/);
    expect(text).toMatch(/C3 guests: .*email, survey_token/);
    expect(text).toMatch(/C3 user_preferences: .*email/);
    expect(text).not.toMatch(/slug_aliases/);
    expect(text).toMatch(/C4 public\.guests is in the supabase_realtime publication/);
  });

  it('passes on the post-lockdown state', async () => {
    const q = fakeCatalog({ privs: false, permissive: ['slug_aliases'], published: [], anonCols: { slug_aliases: ['old_slug', 'new_slug'] } });
    const out = await guards.guestsClassChecks(q);
    expect(out.fail).toEqual([]);
    expect(out.info.join('\n')).toMatch(/C1 .*2 table/);
  });

  it('a missing no-access table fails (no silent typos)', async () => {
    const q = fakeCatalog({ privs: false, permissive: [], published: [], anonCols: {} });
    const out = await guards.checkNoAccessTables(q, ['guestz']);
    expect(out.fail[0]).toMatch(/guestz: table does not exist/);
  });

  it('the sensitive-name regex covers the guests leak columns', () => {
    for (const c of ['email', 'ethereum_address', 'survey_token', 'privy_user_id', 'visitor_session_id', 'email_resend_id']) {
      expect(guards.SENSITIVE_NAME_RE.test(c)).toBe(true);
    }
    for (const c of ['id', 'name', 'party_id', 'old_slug', 'enabled']) expect(guards.SENSITIVE_NAME_RE.test(c)).toBe(false);
  });
});
