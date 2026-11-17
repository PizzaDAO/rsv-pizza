#!/usr/bin/env node
/**
 * wl-self-serve-brands PRs 9-12: write a brand's theme tokens (and its flourish class) to its
 * `event_series` row, from backend/scripts/data/brand-tokens.json.
 *
 *   event_series.theme_tokens  <- entry.themeTokens   (flags hideHeaderName / hideHeroLogo live in it)
 *   event_series.theme_class   <- entry.themeClass    ('brand-doge', ...)
 *   tagline / meta_description / favicon_url           <- optional entry fields of the same name, so the
 *                                                         runtime config reproduces the build-time env
 *                                                         (VITE_BRAND_TAGLINE / _DESCRIPTION / _FAVICON_URL)
 *   event_series.config_version += 1                   (cache key of /api/brand-config)
 *   series_audit row                                   (actor_kind 'system', snapshot = the previous values)
 *
 * The tokens are validated with the SAME code the API uses (src/lib/themeTokens.ts parseThemeTokens:
 * shape, mode-vs-bg, WCAG AA text pairs, super-admin overrides allowed). A failing entry aborts; the
 * validator is never loosened here.
 *
 * theme_tokens is inert until the brand's frontend build is runtime-enabled (VITE_BRAND_RUNTIME=1).
 * theme_class is also read by the flag-off site's series page wrapper (a class name with no rules
 * outside a runtime build), so that stays harmless too. Follow the PR's prod steps for the order.
 *
 * Modes (default is a read-only dry run that prints the before/after diff):
 *   (none)                   dry run for every entry in the data file, or just `--slug <slug>`
 *   --slug doge --apply      ONE transaction: SET LOCAL timeouts, lock the row, UPDATE, audit row
 *   --slug doge --rollback   undo the newest apply not yet rolled back (restore its snapshot, audit it, verify);
 *                            run again to step back to the previous apply. Refuses if the row was edited
 *                            since that apply, unless --force
 *
 *   cd backend && node --env-file=.env scripts/apply-brand-tokens.cjs [--slug doge] [--apply|--rollback]
 *
 * Never a session-level SET (DATABASE_URL is the 6543 transaction pooler): only SET LOCAL inside the
 * transaction. Prints the brand's own style values (colours); never secrets.
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data/brand-tokens.json');
const ACTOR_EMAIL = 'system:apply-brand-tokens';
const TX_OPTS = { timeout: 30000, maxWait: 15000 };

/** Data-file field -> event_series column. `json` columns are written as jsonb. */
const FIELDS = {
  themeClass: { column: 'theme_class' },
  themeTokens: { column: 'theme_tokens', json: true },
  tagline: { column: 'tagline' },
  metaDescription: { column: 'meta_description' },
  faviconUrl: { column: 'favicon_url' },
};
const FIELD_KEYS = Object.keys(FIELDS);
const URL_OK = /^(?:https?:\/\/[^\s"'<>\\]+|\/(?!\/)[^\s"'<>\\]*)$/;

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply' : ARGS.includes('--rollback') ? 'rollback' : 'dry';
const slugIdx = ARGS.indexOf('--slug');
const SLUG = slugIdx >= 0 ? ARGS[slugIdx + 1] : null;
const FORCE = ARGS.includes('--force');

let themeTokensLib = null;
/** src/lib/themeTokens.ts (TypeScript) through tsx, loaded lazily so tests can inject their own. */
function lib() {
  if (!themeTokensLib) {
    require('tsx/cjs');
    themeTokensLib = require('../src/lib/themeTokens.ts');
  }
  return themeTokensLib;
}

function loadData(file = DATA_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [slug, v] of Object.entries(raw)) if (!slug.startsWith('_')) out[slug] = v;
  return out;
}

/** Validate one data entry with the API's validator. Returns { ok, tokens, warnings, errors }. */
function validateEntry(entry, parse) {
  const parseFn = parse || lib().parseThemeTokens;
  const errors = [];
  if (!entry || typeof entry !== 'object') return { ok: false, errors: ['entry must be an object'], warnings: [] };
  if (typeof entry.themeClass !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(entry.themeClass)) {
    errors.push('themeClass must be a CSS class name');
  }
  for (const k of Object.keys(entry)) if (!FIELD_KEYS.includes(k)) errors.push(`unknown field: ${k}`);
  // Same caps as the brand-settings API (tagline 80, meta description 200).
  for (const [k, max] of [['tagline', 80], ['metaDescription', 200]]) {
    if (entry[k] !== undefined && (typeof entry[k] !== 'string' || !entry[k].trim() || entry[k].length > max)) {
      errors.push(`${k} must be a non-empty string (max ${max})`);
    }
  }
  if (entry.faviconUrl !== undefined && (typeof entry.faviconUrl !== 'string' || !URL_OK.test(entry.faviconUrl))) {
    errors.push('faviconUrl must be an http(s) or root-relative URL');
  }
  const r = parseFn(entry.themeTokens, { allowOverrides: true });
  if (!r.ok) errors.push(...r.errors);
  if (errors.length) return { ok: false, errors, warnings: [] };
  return { ok: true, tokens: r.tokens, warnings: r.warnings || [], errors: [] };
}

/** Stable (key-sorted) JSON, so jsonb key reordering is never a "change". */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

function pick(row, keys) {
  const o = {};
  for (const k of keys) o[k] = row[k] ?? null;
  return o;
}

/** `{field: {old, new}}` for the fields the write would change (fields absent from `after` are left alone). */
function diffValues(before, after) {
  const out = {};
  for (const k of FIELD_KEYS) {
    if (!(k in after)) continue;
    if (stable(before[k] ?? null) !== stable(after[k] ?? null)) out[k] = { old: before[k] ?? null, new: after[k] ?? null };
  }
  return out;
}

/** Line-per-key before/after view (`*` marks a change). */
function formatDiff(before, after) {
  const lines = [];
  const show = (v) => (v === undefined || v === null ? '(unset)' : typeof v === 'string' ? v : JSON.stringify(v));
  for (const k of FIELD_KEYS) {
    if (k === 'themeTokens' || !(k in after)) continue;
    const same = stable(before[k] ?? null) === stable(after[k] ?? null);
    lines.push(`  ${same ? ' ' : '*'} ${FIELDS[k].column}: ${show(before[k])}${same ? '' : ` -> ${show(after[k])}`}`);
  }
  if ('themeTokens' in after) {
    const flat = (v) => {
      const o = {};
      if (!v || typeof v !== 'object') return o;
      for (const [k, val] of Object.entries(v)) {
        if (k === 'overrides' && val && typeof val === 'object') for (const [n, x] of Object.entries(val)) o[`overrides.${n}`] = x;
        else o[k] = val;
      }
      return o;
    };
    const b = flat(before.themeTokens);
    const a = flat(after.themeTokens);
    for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) {
      const same = stable(b[k] ?? null) === stable(a[k] ?? null);
      lines.push(`  ${same ? ' ' : '*'} theme_tokens.${k}: ${show(b[k])}${same ? '' : ` -> ${show(a[k])}`}`);
    }
  }
  return lines.join('\n');
}

async function readRow(db, slug, forUpdate = false) {
  const rows = await db.$queryRawUnsafe(
    `SELECT id, slug, theme_class, theme_tokens, tagline, meta_description, favicon_url, config_version FROM event_series WHERE slug = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    slug,
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, slug: r.slug, configVersion: r.config_version,
    themeClass: r.theme_class ?? null, themeTokens: r.theme_tokens ?? null,
    tagline: r.tagline ?? null, metaDescription: r.meta_description ?? null, faviconUrl: r.favicon_url ?? null,
  };
}

/** UPDATE only the fields present in `values` (column names come from the FIELDS constant, never input). */
async function writeRow(tx, id, values) {
  const sets = [];
  const params = [];
  for (const k of FIELD_KEYS) {
    if (!(k in values)) continue;
    const v = values[k] ?? null;
    params.push(FIELDS[k].json ? (v === null ? null : JSON.stringify(v)) : v);
    sets.push(`${FIELDS[k].column} = $${params.length}${FIELDS[k].json ? '::jsonb' : ''}`);
  }
  params.push(id);
  await tx.$executeRawUnsafe(
    `UPDATE event_series SET ${sets.join(', ')}, config_version = config_version + 1, updated_at = now() WHERE id = $${params.length}::uuid`,
    ...params,
  );
}

async function writeAudit(tx, id, action, changes, snapshot) {
  await tx.$executeRawUnsafe(
    `INSERT INTO series_audit (series_id, actor_email, actor_kind, action, changes, snapshot) VALUES ($1::uuid, $2, 'system', $3, $4::jsonb, $5::jsonb)`,
    id, ACTOR_EMAIL, action, JSON.stringify(changes), JSON.stringify(snapshot),
  );
}

async function setLocalTimeouts(tx) {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
}

/** apply (inside ONE transaction). Returns { changed, before, after }. */
async function applyEntry(tx, slug, entry) {
  await setLocalTimeouts(tx);
  const row = await readRow(tx, slug, true);
  if (!row) throw new Error(`no event_series row with slug "${slug}"`);
  const after = { ...entry };
  const before = pick(row, Object.keys(after));
  const changes = diffValues(before, after);
  if (!Object.keys(changes).length) return { changed: false, before, after };
  await writeRow(tx, row.id, after);
  await writeAudit(tx, row.id, 'brand-tokens.apply', changes, before);
  return { changed: true, before, after };
}

/**
 * rollback (inside ONE transaction): undo the newest apply that has not been rolled back yet.
 * Each rollback audit row records which apply it undid (`snapshot._undoes`), so repeated rollbacks
 * step back through earlier applies. Refuses when the row no longer holds the values that apply wrote
 * (somebody edited it since) unless `force`; `drifted` lists the fields.
 */
async function rollbackEntry(tx, slug, opts = {}) {
  await setLocalTimeouts(tx);
  const row = await readRow(tx, slug, true);
  if (!row) throw new Error(`no event_series row with slug "${slug}"`);
  const audits = await tx.$queryRawUnsafe(
    `SELECT id, action, snapshot, changes, created_at FROM series_audit WHERE series_id = $1::uuid AND action IN ('brand-tokens.apply', 'brand-tokens.rollback') ORDER BY created_at DESC`,
    row.id,
  );
  const undone = new Set(audits.filter((a) => a.action === 'brand-tokens.rollback').map((a) => a.snapshot && a.snapshot._undoes).filter(Boolean));
  const target = audits.find((a) => a.action === 'brand-tokens.apply' && !undone.has(a.id));
  if (!target) throw new Error(`no un-rolled-back 'brand-tokens.apply' audit row for "${slug}": nothing to roll back`);
  const snap = target.snapshot || {};
  const written = target.changes || {};
  // Only the fields that apply actually changed are restored (never fields it left alone).
  const keys = Object.keys(written).filter((k) => FIELD_KEYS.includes(k) && k in snap);
  if (!keys.length) throw new Error(`the 'brand-tokens.apply' audit row for "${slug}" has no snapshot`);
  const drifted = Object.keys(written).filter((k) => FIELD_KEYS.includes(k) && stable(row[k] ?? null) !== stable(written[k].new ?? null));
  if (drifted.length && !opts.force) {
    throw new Error(`the row changed since that apply (drifted: ${drifted.join(', ')}); rollback would overwrite those edits. Re-run with --force to restore anyway`);
  }
  const before = pick(row, keys);
  const after = pick(snap, keys);
  const changes = diffValues(before, after);
  if (!Object.keys(changes).length) return { changed: false, before, after, undoes: target.id, drifted };
  await writeRow(tx, row.id, after);
  await writeAudit(tx, row.id, 'brand-tokens.rollback', changes, { ...before, _undoes: target.id });
  return { changed: true, before, after, undoes: target.id, drifted };
}

function target() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL unparseable)';
  }
}

async function main() {
  const data = loadData();
  const slugs = SLUG ? [SLUG] : Object.keys(data);
  if ((MODE === 'apply' || MODE === 'rollback') && !SLUG) throw new Error(`--${MODE} needs --slug <slug>`);
  for (const s of slugs) if (MODE !== 'rollback' && !data[s]) throw new Error(`no entry "${s}" in ${path.basename(DATA_FILE)}`);

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set (run with node --env-file=.env)');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== brand tokens (${MODE.toUpperCase()}${MODE === 'dry' ? ', read-only' : ''}) ===`);
    console.log(`target: ${target()}`);
    for (const slug of slugs) {
      console.log(`\n--- ${slug} ---`);
      const row = await readRow(prisma, slug);
      if (!row) {
        console.log(`  no event_series row "${slug}"`);
        if (MODE !== 'dry') throw new Error('series not found');
        continue;
      }
      console.log(`  config_version: ${row.configVersion}`);

      if (MODE === 'rollback') {
        const r = await prisma.$transaction((tx) => rollbackEntry(tx, slug, { force: FORCE }), TX_OPTS);
        if (r.drifted.length) console.log(`  --force: overwrote edited fields: ${r.drifted.join(', ')}`);
        console.log(r.changed ? 'rolled back; before/after (* = changes):' : 'already at the snapshot values; nothing to do');
        if (r.changed) console.log(formatDiff(r.before, r.after));
        const now = await readRow(prisma, slug);
        if (Object.keys(diffValues(pick(now, Object.keys(r.after)), r.after)).length) {
          throw new Error('post-commit verify failed: the row differs from the restored snapshot');
        }
        continue;
      }

      const v = validateEntry(data[slug]);
      if (!v.ok) throw new Error(`${slug}: tokens fail validation: ${v.errors.join('; ')}`);
      for (const w of v.warnings) console.log(`  warning: ${w}`);
      const entry = { ...data[slug], themeTokens: v.tokens };
      const before = pick(row, Object.keys(entry));
      const changes = diffValues(before, entry);
      console.log(Object.keys(changes).length ? 'before -> after (* = changes):' : 'already up to date (--apply would be a no-op):');
      console.log(formatDiff(before, entry));
      if (MODE === 'dry') {
        console.log('  (--apply would, in one transaction: SET LOCAL timeouts, UPDATE event_series, config_version + 1,');
        console.log("   INSERT a series_audit row, actor_kind 'system', with the previous values as the snapshot)");
        continue;
      }
      const r = await prisma.$transaction((tx) => applyEntry(tx, slug, entry), TX_OPTS);
      const after = await readRow(prisma, slug);
      console.log(r.changed ? `applied; config_version ${row.configVersion} -> ${after.configVersion}` : 'no change');
      if (Object.keys(diffValues(pick(after, Object.keys(entry)), entry)).length) {
        throw new Error('post-commit verify failed: the row differs from the data file');
      }
    }
    if (MODE === 'dry') console.log('\nDRY RUN: nothing changed.');
    else console.log(`\nOK: ${MODE === 'apply' ? 'applied' : 'rolled back'} and verified.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { MODE, FIELDS, DATA_FILE, ACTOR_EMAIL, loadData, validateEntry, stable, diffValues, formatDiff, applyEntry, rollbackEntry };
