/**
 * guests-anon-exposure: the public (anon) key must never touch `guests` or `user_preferences`.
 * Guest reads go through the backend; live updates use the `guests:<partyId>` broadcast.
 * See plans/guests-anon-exposure.md.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
