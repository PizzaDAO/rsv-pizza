/**
 * Small generic settings registry on top of the `app_config` table.
 *
 * One setting = one integer stored as JSON in `app_config.value`. Each definition carries its own
 * bounds, a shipped default, and (for settings that gate trust or money) a "stricter-only" rule:
 *
 *  - The schema bound stops at the shipped default, so the admin UI can only TIGHTEN a rule.
 *    Loosening beyond the default needs a code change.
 *  - Moving a value back toward the default (loosening relative to the stored value) is allowed
 *    only with a non-empty note, and every change is audited (`app_config_audit`).
 *  - If the DB cannot be read, each setting resolves to its failure value (the strict one), never
 *    the default. A missing row resolves to the default; an existing but invalid row resolves to the
 *    failure value.
 *
 * Pure helpers (no DB) are exported separately so they can be unit tested.
 */
import { prisma } from '../config/database.js';

export interface SettingDef {
  key: string;
  area: string;
  label: string;
  help: string;
  min: number;
  max: number;
  /** Shipped default (the loosest value a stricter-only setting can hold). */
  default: number;
  /** Value used when the DB cannot be read. Strict for stricter-only settings. */
  failure: number;
  unit?: string;
  stricterOnly?: boolean;
  /** Which direction loosens the rule. Required when stricterOnly. */
  looserWhen?: 'higher' | 'lower';
}

export type SettingSource = 'stored' | 'default' | 'failure';

export interface ResolvedSetting {
  value: number;
  source: SettingSource;
}

/** Integer within the definition's bounds. */
export function isValidSettingValue(def: SettingDef, v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= def.min && v <= def.max;
}

/** Resolve one raw stored string. Missing -> default; unparseable or out of bounds -> failure value (never throws). */
export function resolveRaw(def: SettingDef, raw: string | undefined | null): ResolvedSetting {
  if (raw == null) return { value: def.default, source: 'default' };
  try {
    const v = JSON.parse(raw);
    if (isValidSettingValue(def, v)) return { value: v, source: 'stored' };
  } catch {
    /* fall through */
  }
  // A row exists but is unusable: be strict, not loose.
  return { value: def.failure, source: 'failure' };
}

/** True when moving from `from` to `to` makes the rule looser. */
export function isLoosening(def: SettingDef, from: number, to: number): boolean {
  if (!def.looserWhen) return false;
  return def.looserWhen === 'higher' ? to > from : to < from;
}

export type SettingChangeCheck =
  | { ok: true; loosening: boolean }
  | { ok: false; code: 'OUT_OF_RANGE' | 'NOTE_REQUIRED'; message: string };

/**
 * Validate a requested change. `current` is the value in force now.
 * Out of bounds is refused. A loosening change on a stricter-only setting needs a note.
 */
export function checkSettingChange(
  def: SettingDef,
  current: number,
  next: unknown,
  note?: string | null,
): SettingChangeCheck {
  if (!isValidSettingValue(def, next)) {
    return {
      ok: false,
      code: 'OUT_OF_RANGE',
      message: `${def.label} must be a whole number from ${def.min} to ${def.max}.`,
    };
  }
  const loosening = def.stricterOnly === true && isLoosening(def, current, next);
  if (loosening && !note?.trim()) {
    return { ok: false, code: 'NOTE_REQUIRED', message: `A note is required to loosen "${def.label}".` };
  }
  return { ok: true, loosening };
}

/** Sanity check for a registry: bounds ordered, default and failure in range, direction declared. */
export function validateRegistry(defs: SettingDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.key)) problems.push(`${d.key}: duplicate key`);
    seen.add(d.key);
    if (d.min > d.max) problems.push(`${d.key}: min > max`);
    if (!isValidSettingValue(d, d.default)) problems.push(`${d.key}: default out of range`);
    if (!isValidSettingValue(d, d.failure)) problems.push(`${d.key}: failure out of range`);
    if (d.stricterOnly) {
      if (!d.looserWhen) problems.push(`${d.key}: stricterOnly needs looserWhen`);
      // The default is the loosest allowed value: the bound on the loose side must equal it.
      if (d.looserWhen === 'higher' && d.max !== d.default) problems.push(`${d.key}: max must equal default`);
      if (d.looserWhen === 'lower' && d.min !== d.default) problems.push(`${d.key}: min must equal default`);
      // The failure value must not be looser than the default.
      if (isLoosening(d, d.default, d.failure)) problems.push(`${d.key}: failure looser than default`);
    }
  }
  return problems;
}

export interface SettingsSnapshot {
  values: Record<string, ResolvedSetting>;
  /** True when the DB read failed and every value is its failure value. */
  readFailed: boolean;
}

/** Read every setting in one query. Never throws. */
export async function readSettings(defs: SettingDef[]): Promise<SettingsSnapshot> {
  const values: Record<string, ResolvedSetting> = {};
  try {
    const rows = await prisma.appConfig.findMany({
      where: { key: { in: defs.map((d) => d.key) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    for (const d of defs) values[d.key] = resolveRaw(d, byKey.get(d.key));
    return { values, readFailed: false };
  } catch (err) {
    console.warn('[appSettings] DB read failed; using failure values.', err);
    for (const d of defs) values[d.key] = { value: d.failure, source: 'failure' };
    return { values, readFailed: true };
  }
}

/**
 * Persist one validated change and append an audit row in one transaction. The audit oldValue is
 * read inside the transaction, so it is the value actually replaced.
 */
export async function writeSetting(
  def: SettingDef,
  newValue: number,
  actorEmail: string,
  note: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.appConfig.findUnique({ where: { key: def.key } });
    const oldValue = resolveRaw(def, row?.value).value;
    await tx.appConfig.upsert({
      where: { key: def.key },
      create: { key: def.key, value: JSON.stringify(newValue) },
      update: { value: JSON.stringify(newValue), updatedAt: new Date() },
    });
    await tx.appConfigAudit.create({
      data: { key: def.key, oldValue, newValue, actorEmail, note },
    });
  });
}
