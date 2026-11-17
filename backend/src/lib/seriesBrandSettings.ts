/**
 * Brand-admin settings: the explicit ALLOWLIST of `event_series` fields a brand admin may change,
 * their validators, and the shared apply / revert helpers (plans/wl-self-serve-brands.md §2.1, §2.4).
 *
 * Anything not listed here is super-admin only. That includes: slug, internal name, is_active,
 * theme_class, flyer_template_key, create_flow, require_approval, event_type, public/internal tags,
 * funding wallet, site_url / aliases, email sender address and sending domain, the verified flag, the
 * Resend domain id, pending-domain fields and every image URL (these arrive with the validated
 * upload PR). Unknown or super-only keys in a request are a 400, never ignored.
 *
 * Theme tokens ARE brand-editable (PR 8): strict shape, size and WCAG AA validation in
 * lib/themeTokens.ts. `overrides` inside them is super-admin only (a brand admin's save keeps them).
 *
 * Text rules: no angle brackets and no control chars, so brand-controlled strings can't carry markup
 * into pages or emails (emails escape them again regardless).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { emailOrNull, senderNameOrNull } from './seriesEmailFields.js';
import { parseThemeTokens } from './themeTokens.js';
import { writeSeriesAudit, snapshotOf, type SeriesActorKind } from './seriesAudit.js';

export const BRAND_ADMIN_FIELDS = [
  'brandName', 'displayName', 'tagline', 'metaDescription', 'supportEmail', 'description',
  'nameTemplate', 'hideGuests', 'photosEnabled', 'photosPublic',
  'eventDate', 'eventStartTime', 'eventEndTime', 'emailFromName', 'emailReplyTo', 'themeTokens',
] as const;
export type BrandAdminField = (typeof BRAND_ADMIN_FIELDS)[number];

/** What a brand admin may read: the editable fields plus a little read-only context. */
export const BRAND_SETTINGS_SELECT = {
  id: true, slug: true, name: true, siteUrl: true, requireApproval: true, createFlow: true, configVersion: true,
  ...Object.fromEntries(BRAND_ADMIN_FIELDS.map((f) => [f, true])),
} as Prisma.EventSeriesSelect;

const bad = (msg: string): never => {
  throw new AppError(msg, 400, 'VALIDATION_ERROR');
};

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/;
const NAME_RE = /^[\p{L}\p{N} .&'!-]+$/u;

function text(v: unknown, field: string, max: number, opts: { multiline?: boolean } = {}): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return bad(`${field} must be text`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) bad(`${field} must be at most ${max} characters`);
  if (/[<>]/.test(s)) bad(`${field} can't contain < or >`);
  if (opts.multiline ? CONTROL.test(s) : /[\u0000-\u001f\u007f\u2028\u2029]/.test(s)) bad(`${field} contains invalid characters`);
  return s;
}

/** Names that would impersonate the platform or its operator (case, spaces and punctuation ignored). */
const RESERVED_FRAGMENTS = ['pizzadao', 'rsvpizza'];
export function assertNotReservedName(v: string | null, field: string): void {
  if (!v) return;
  const flat = v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (RESERVED_FRAGMENTS.some((r) => flat.includes(r))) bad(`${field} can't use a reserved name`);
}

function name(v: unknown, field: string): string | null {
  const s = text(v, field, 40);
  if (s && !NAME_RE.test(s)) bad(`${field} can only use letters, digits, spaces and . & ' ! -`);
  assertNotReservedName(s, field);
  return s;
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') bad(`${field} must be true or false`);
  return v as boolean;
}

function hm(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim())) return bad(`${field} must be HH:MM (24-hour)`);
  return v.trim();
}

function date(v: unknown, field: string): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return bad(`${field} must be a date (YYYY-MM-DD)`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return bad(`${field} must be a valid date`);
  return d;
}

/**
 * Theme tokens: null/empty clears them. Otherwise the full strict validation (hex colours, font
 * keys, radius, mode, size, AA contrast). `overrides` is super-admin only, so a PATCH containing it
 * is a 400; revert (trusted snapshot of this same series) passes allowOverrides.
 */
function themeTokensValue(v: unknown, allowOverrides: boolean): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === null || v === undefined) return Prisma.DbNull;
  const r = parseThemeTokens(v, { allowOverrides });
  if (!r.ok) return bad(`themeTokens: ${r.errors.slice(0, 6).join('; ')}`);
  return r.tokens as unknown as Prisma.InputJsonValue;
}

/**
 * Validate `input` against the allowlist and return the Prisma update fragment. With `strict` (the
 * PATCH route) any key outside the allowlist is rejected; revert passes pre-filtered values.
 */
export function validateBrandSettings(input: Record<string, unknown>, opts: { strict?: boolean; allowOverrides?: boolean } = { strict: true }): Prisma.EventSeriesUpdateInput {
  const allowed = BRAND_ADMIN_FIELDS as readonly string[];
  if (opts.strict) {
    const extra = Object.keys(input).filter((k) => !allowed.includes(k));
    if (extra.length) {
      bad(`Not editable by brand admins: ${extra.join(', ')}. Editable fields: ${allowed.join(', ')}`);
    }
  }
  const data: Prisma.EventSeriesUpdateInput = {};
  for (const [k, v] of Object.entries(input)) {
    switch (k as BrandAdminField) {
      case 'brandName': data.brandName = name(v, 'brandName'); break;
      case 'displayName': {
        const n = name(v, 'displayName');
        if (!n) bad('displayName can\'t be empty');
        data.displayName = n as string;
        break;
      }
      case 'tagline': data.tagline = text(v, 'tagline', 80); break;
      case 'metaDescription': data.metaDescription = text(v, 'metaDescription', 200); break;
      case 'supportEmail': data.supportEmail = emailOrNull(v, 'supportEmail'); break;
      case 'description': data.description = text(v, 'description', 2000, { multiline: true }); break;
      case 'nameTemplate': data.nameTemplate = text(v, 'nameTemplate', 120); break;
      case 'hideGuests': data.hideGuests = bool(v, 'hideGuests'); break;
      case 'photosEnabled': data.photosEnabled = bool(v, 'photosEnabled'); break;
      case 'photosPublic': data.photosPublic = bool(v, 'photosPublic'); break;
      case 'eventDate': data.eventDate = date(v, 'eventDate'); break;
      case 'eventStartTime': data.eventStartTime = hm(v, 'eventStartTime'); break;
      case 'eventEndTime': data.eventEndTime = hm(v, 'eventEndTime'); break;
      case 'emailFromName': {
        const n = senderNameOrNull(v);
        assertNotReservedName(n, 'emailFromName');
        data.emailFromName = n;
        break;
      }
      case 'emailReplyTo': data.emailReplyTo = emailOrNull(v, 'emailReplyTo'); break;
      case 'themeTokens': data.themeTokens = themeTokensValue(v, !!opts.allowOverrides); break;
      default: break;
    }
  }
  return data;
}

const plain = (v: unknown) => JSON.stringify(v === undefined || v === Prisma.DbNull ? null : v);

/** Fields of `data` whose value really differs from the current row. */
function changedFields(before: Record<string, unknown>, data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => plain(before[k]) !== plain(data[k]));
}

function pickAllowed(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BRAND_ADMIN_FIELDS) if (k in obj) out[k] = obj[k];
  return out;
}

/**
 * Apply validated brand settings to ONE series (the id comes from `req.seriesAdmin`). No-op writes
 * (nothing actually changed) skip the config_version bump and the audit row.
 */
export async function applyBrandSettings(opts: {
  seriesId: string;
  data: Prisma.EventSeriesUpdateInput;
  actorEmail: string;
  actorKind: SeriesActorKind;
  action: 'settings.update' | 'revert';
  extraChanges?: Record<string, { old: unknown; new: unknown }>;
}) {
  let { data } = opts;
  const { seriesId, actorEmail, actorKind, action, extraChanges } = opts;
  return prisma.$transaction(async (tx) => {
    const before = await tx.eventSeries.findFirst({ where: { id: seriesId } });
    if (!before) throw new AppError('Not found', 404, 'NOT_FOUND');
    // Super-admin `overrides` survive a brand admin's save: they can't send them, so carry them over.
    const kept = (before as any).themeTokens?.overrides;
    const nt = (data as any).themeTokens;
    if (kept && nt && typeof nt === 'object' && nt !== Prisma.DbNull && !nt.overrides) {
      data = { ...data, themeTokens: { ...nt, overrides: kept } };
    }
    const fields = changedFields(before as any, data as any);
    if (fields.length === 0) return { changed: [] as string[], settings: pickSettings(before as any) };
    const patch: Prisma.EventSeriesUpdateInput = Object.fromEntries(fields.map((k) => [k, (data as any)[k]]));
    patch.configVersion = { increment: 1 };
    const updated = await tx.eventSeries.update({ where: { id: seriesId }, data: patch });
    const changes: Record<string, { old: unknown; new: unknown }> = { ...(extraChanges ?? {}) };
    const bs = before as any;
    const us = updated as any;
    for (const k of fields) {
      changes[k] = { old: JSON.parse(plain(bs[k])), new: JSON.parse(plain(us[k])) };
    }
    await writeSeriesAudit(tx, { seriesId, actorEmail, actorKind, action, changes, snapshot: snapshotOf(bs) });
    return { changed: fields, settings: pickSettings(us) };
  });
}

export function pickSettings(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(BRAND_SETTINGS_SELECT)) out[k] = row[k] ?? null;
  return out;
}

/** Brand-admin-visible slice of an audit `changes` object. */
export function visibleChanges(changes: unknown): Record<string, unknown> {
  if (!changes || typeof changes !== 'object') return {};
  return pickAllowed(changes as Record<string, unknown>);
}

/**
 * Revert to the pre-change snapshot of one audit row of THIS series. Only allowlisted fields are
 * written back, through the same validators; fields already equal are skipped.
 */
export async function revertToAudit(opts: { seriesId: string; auditId: string; actorEmail: string; actorKind: SeriesActorKind }) {
  const { seriesId, auditId } = opts;
  const row = await prisma.seriesAudit.findFirst({
    where: { id: auditId, seriesId, action: { in: ['settings.update', 'revert'] } },
    select: { id: true, snapshot: true },
  });
  if (!row || !row.snapshot || typeof row.snapshot !== 'object') throw new AppError('Not found', 404, 'NOT_FOUND');
  const wanted = pickAllowed(row.snapshot as Record<string, unknown>);
  const current = await prisma.eventSeries.findFirst({ where: { id: seriesId } });
  if (!current) throw new AppError('Not found', 404, 'NOT_FOUND');
  const todo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(wanted)) {
    if (plain((current as any)[k]) !== plain(v)) todo[k] = v;
  }
  const data = validateBrandSettings(todo, { strict: false, allowOverrides: true });
  return applyBrandSettings({
    seriesId, data, actorEmail: opts.actorEmail, actorKind: opts.actorKind, action: 'revert',
    extraChanges: { revertedAuditId: { old: null, new: auditId } },
  });
}
