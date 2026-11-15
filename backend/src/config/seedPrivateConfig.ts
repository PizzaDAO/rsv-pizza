/**
 * Private-config seed runner (marinara-71630 P0).
 *
 * Reads seed.private.json (real values, gitignored). If that file is absent,
 * it falls back to seed.example.json and seeds PLACEHOLDER values with a loud
 * warning. For each top-level key it upserts a row into `app_config` with the
 * value JSON-stringified.
 *
 * Run with (note the `--` separator, without it npm swallows the flags):
 *   npm run seed:private-config
 *   npm run seed:private-config -- --only private.fraud_weights --dry-run
 *
 * Flags (jalapeno-61805):
 *   --only <key>  Upsert just that top-level key (also `--only=<key>`).
 *                 Requires seed.private.json: never falls back to
 *                 seed.example.json.
 *   --dry-run     Write nothing. Prints, per key, old/new key names (recursing
 *                 one level into object values) and a count of changed values.
 *                 Never prints values.
 * Any other argument is an error (fail closed, nothing is written).
 *
 * Meta keys beginning with "_" (e.g. "_readme", "_note") are skipped — they
 * document the template and are not real config rows. (Note: nested "_note"
 * fields inside a value object ARE preserved as-is, since the whole object is
 * stored verbatim.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRIVATE_PATH = join(__dirname, 'seed.private.json');
const EXAMPLE_PATH = join(__dirname, 'seed.example.json');

export interface SeedArgs {
  only?: string;
  dryRun: boolean;
}

/**
 * Pure argv parser. Throws on anything unrecognised so a typo can never fall
 * through to a full real seed.
 */
export function parseArgs(argv: string[]): SeedArgs {
  const out: SeedArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--dry-run') {
      out.dryRun = true;
    } else if (tok === '--only') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error('--only requires a key');
      out.only = v;
      i++;
    } else if (tok.startsWith('--only=')) {
      const v = tok.slice('--only='.length);
      if (!v) throw new Error('--only requires a key');
      out.only = v;
    } else {
      throw new Error(`unrecognized argument: ${tok}`);
    }
  }
  return out;
}

/** npm turns `--only X` (no `--` separator) into env vars and drops the flags. */
export function checkNpmSwallowed(env: Record<string, string | undefined>): void {
  if (env.npm_config_only !== undefined || env.npm_config_dry_run !== undefined) {
    throw new Error(
      'npm swallowed --only/--dry-run (they arrived as npm config, not script args). ' +
        'Use the `--` separator: npm run seed:private-config -- --only <key> --dry-run',
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Result of parsing a stored app_config value. */
type Stored = { kind: 'absent' } | { kind: 'unparseable' } | { kind: 'value'; value: unknown };

function parseStored(raw: string | null | undefined): Stored {
  if (raw == null) return { kind: 'absent' };
  try {
    return { kind: 'value', value: JSON.parse(raw) };
  } catch {
    return { kind: 'unparseable' };
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  indent: string,
): string[] {
  const oldKeys = Object.keys(oldObj).sort();
  const newKeys = Object.keys(newObj).sort();
  const removed = oldKeys.filter(k => !(k in newObj));
  const added = newKeys.filter(k => !(k in oldObj));
  const common = newKeys.filter(k => k in oldObj);
  const changed = common.filter(k => !same(oldObj[k], newObj[k])).length;
  return [
    `${indent}old keys (${oldKeys.length}): ${oldKeys.join(', ')}`,
    `${indent}new keys (${newKeys.length}): ${newKeys.join(', ')}`,
    `${indent}keys removed: ${removed.length ? removed.join(', ') : '(none)'}`,
    `${indent}keys added: ${added.length ? added.join(', ') : '(none)'}`,
    `${indent}changed values among ${common.length} shared key(s): ${changed}`,
  ];
}

/**
 * Describe the difference between an old and new stored value WITHOUT
 * revealing any value: only key names (recursing one level into object-valued
 * keys) and counts of changed values.
 */
export function describeDiff(old: Stored, newVal: unknown): string[] {
  if (old.kind === 'absent') return ['  existing row: none (would be created)'];
  if (old.kind === 'unparseable') return ['  existing row unparseable (would be overwritten)'];
  const oldVal = old.value;
  if (!isPlainObject(oldVal) || !isPlainObject(newVal)) {
    return [`  non-object value: ${same(oldVal, newVal) ? 'unchanged' : 'changed'}`];
  }
  const lines = diffObjects(oldVal, newVal, '  ');
  for (const k of Object.keys(newVal).sort()) {
    const o = oldVal[k];
    const n = newVal[k];
    if (isPlainObject(o) && isPlainObject(n)) {
      lines.push(`  [${k}]`, ...diffObjects(o, n, '    '));
    }
  }
  return lines;
}

async function main(): Promise<void> {
  checkNpmSwallowed(process.env);
  const { only, dryRun } = parseArgs(process.argv.slice(2));

  // Imported lazily so the pure helpers above can be unit-tested without a DB.
  const { prisma } = await import('./database.js');

  try {
    let sourcePath: string;
    let usingPlaceholders: boolean;

    if (existsSync(PRIVATE_PATH)) {
      sourcePath = PRIVATE_PATH;
      usingPlaceholders = false;
    } else if (only !== undefined) {
      throw new Error(
        `--only ${only} requires ${PRIVATE_PATH}; refusing to fall back to seed.example.json`,
      );
    } else {
      sourcePath = EXAMPLE_PATH;
      usingPlaceholders = true;
    }

    if (usingPlaceholders) {
      console.warn(
        '\n*****************************************************************\n' +
          '*  WARNING: seed.private.json not found.                        *\n' +
          '*  Seeding PLACEHOLDER values from seed.example.json.           *\n' +
          '*  These are NOT real production values. Copy seed.example.json *\n' +
          '*  to seed.private.json and fill in real values for prod.       *\n' +
          '*****************************************************************\n'
      );
    }

    const raw = readFileSync(sourcePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (only !== undefined && (only.startsWith('_') || !(only in parsed))) {
      throw new Error(`--only ${only}: key not found in ${sourcePath} (or is a meta key)`);
    }

    const written: string[] = [];
    const skipped: string[] = [];

    for (const [key, val] of Object.entries(parsed)) {
      if (key.startsWith('_')) {
        skipped.push(key);
        continue;
      }
      if (only !== undefined && key !== only) continue;

      if (dryRun) {
        const existing = await prisma.appConfig.findUnique({ where: { key } });
        console.log(`[dry-run] ${key}`);
        for (const line of describeDiff(parseStored(existing?.value), val)) console.log(line);
        written.push(key);
        continue;
      }

      const value = JSON.stringify(val);
      await prisma.appConfig.upsert({
        where: { key },
        update: { value, updatedAt: new Date() },
        create: { key, value },
      });
      written.push(key);
    }

    if (dryRun) {
      console.log(`\n[dry-run] ${written.length} key(s) would be written from ${sourcePath}. Nothing was written.`);
      return;
    }

    console.log(`\nSeeded ${written.length} app_config key(s) from ${sourcePath}:`);
    for (const k of written) console.log(`  ✓ ${k}`);
    if (skipped.length && only === undefined) {
      console.log(`Skipped ${skipped.length} meta key(s): ${skipped.join(', ')}`);
    }
    if (usingPlaceholders) {
      console.warn('\nReminder: PLACEHOLDER values were seeded. Do NOT run this against prod.');
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('[seedPrivateConfig] seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
