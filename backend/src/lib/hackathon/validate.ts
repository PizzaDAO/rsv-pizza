/**
 * Hackathon host-setup input validation (plans/hackathon-platform.md §5, PR 2).
 * Pure functions: each returns a Prisma `data` object for the fields present in the body
 * (PATCH semantics: absent = unchanged) or throws a 400 AppError. Limits mirror the CHECKs in
 * backend/prisma/migrations/hackathon-1-core.sql so a bad value never reaches the DB.
 */
import { AppError } from '../../middleware/error.js';
import { isUuid } from '../guestToken.js';

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');

export const ELIGIBILITY = ['registered', 'checked_in'] as const;
export const GALLERY_VISIBILITY = ['hidden', 'after_deadline', 'after_reveal'] as const;
export const PRIZE_KINDS = ['judged', 'peoples_choice'] as const;
export const JUDGE_STATUSES = ['active', 'removed'] as const;

/** Per-hackathon row caps (abuse guard; far above any real event). */
export const LIMITS = { tracks: 50, prizes: 100, criteria: 20, judges: 200 } as const;

type Body = Record<string, unknown>;
const has = (b: Body, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

/** Optional text: '' / null -> null. Trimmed. Throws over `max`. */
export function optText(v: unknown, field: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  // Postgres text can't hold NUL; reject instead of letting the write 500.
  if (v.includes('\u0000')) throw bad(`${field} contains an invalid character`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw bad(`${field} must be at most ${max} characters`);
  return t;
}

/** Required text, 1..max after trim. */
export function reqText(v: unknown, field: string, max: number): string {
  const t = optText(v, field, max);
  if (!t) throw bad(`${field} is required`);
  return t;
}

export function intIn(v: unknown, field: string, min: number, max: number): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw bad(`${field} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function optInt(v: unknown, field: string, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  return intIn(v, field, min, max);
}

/** ISO date string / null. */
export function optDate(v: unknown, field: string): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw bad(`${field} must be a date`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${field} must be a valid date`);
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 9999) throw bad(`${field} must be between 1970 and 9999`);
  return d;
}

function oneOf<T extends readonly string[]>(v: unknown, field: string, allowed: T): T[number] {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return v as T[number];
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw bad(`${field} must be true or false`);
  return v;
}

export interface CurrentSettings {
  teamMinSize: number;
  teamMaxSize: number;
  submissionsOpenAt: Date | null;
  submissionDeadline: Date | null;
  publishedAt: Date | null;
}

/**
 * PUT /:partyId/hackathon. `published: true` stamps publishedAt (kept if already set),
 * `false` clears it. Cross-field rules are checked against the merged result.
 */
export function parseSettings(body: Body, current: CurrentSettings, now = new Date()): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (has(body, 'rules')) data.rules = optText(body.rules, 'Rules', 20000);
  if (has(body, 'submissionsOpenAt')) data.submissionsOpenAt = optDate(body.submissionsOpenAt, 'Submissions open');
  if (has(body, 'submissionDeadline')) data.submissionDeadline = optDate(body.submissionDeadline, 'Submission deadline');
  if (has(body, 'teamMinSize')) data.teamMinSize = intIn(body.teamMinSize, 'Minimum team size', 1, 20);
  if (has(body, 'teamMaxSize')) data.teamMaxSize = intIn(body.teamMaxSize, 'Maximum team size', 1, 20);
  if (has(body, 'maxTracksPerSubmission')) data.maxTracksPerSubmission = intIn(body.maxTracksPerSubmission, 'Tracks per project', 1, 20);
  if (has(body, 'eligibility')) data.eligibility = oneOf(body.eligibility, 'Eligibility', ELIGIBILITY);
  if (has(body, 'blindJudging')) data.blindJudging = bool(body.blindJudging, 'Blind judging');
  if (has(body, 'galleryVisibility')) data.galleryVisibility = oneOf(body.galleryVisibility, 'Gallery visibility', GALLERY_VISIBILITY);
  if (has(body, 'published')) {
    const pub = bool(body.published, 'Published');
    data.publishedAt = pub ? current.publishedAt ?? now : null;
  }

  const min = (data.teamMinSize as number | undefined) ?? current.teamMinSize;
  const max = (data.teamMaxSize as number | undefined) ?? current.teamMaxSize;
  if (max < min) throw bad('Maximum team size must be at least the minimum team size');
  const open = has(data, 'submissionsOpenAt') ? (data.submissionsOpenAt as Date | null) : current.submissionsOpenAt;
  const deadline = has(data, 'submissionDeadline') ? (data.submissionDeadline as Date | null) : current.submissionDeadline;
  if (open && deadline && deadline <= open) throw bad('The submission deadline must be after submissions open');
  return data;
}

export function parseTrack(body: Body, partial: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!partial || has(body, 'name')) data.name = reqText(body.name, 'Track name', 80);
  if (has(body, 'description')) data.description = optText(body.description, 'Track description', 2000);
  if (has(body, 'sponsorName')) data.sponsorName = optText(body.sponsorName, 'Sponsor name', 120);
  if (has(body, 'sortOrder')) data.sortOrder = intIn(body.sortOrder, 'Sort order', 0, 10000);
  return data;
}

/** trackId is returned raw (uuid or null); the route checks it belongs to this hackathon. */
export function parsePrize(body: Body, partial: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!partial || has(body, 'name')) data.name = reqText(body.name, 'Prize name', 120);
  if (has(body, 'description')) data.description = optText(body.description, 'Prize description', 2000);
  if (has(body, 'rank')) data.rank = optInt(body.rank, 'Rank', 1, 1000);
  if (has(body, 'amountText')) data.amountText = optText(body.amountText, 'Prize amount', 120);
  if (has(body, 'amountValue')) {
    const v = body.amountValue;
    if (v === null || v === '') data.amountValue = null;
    else {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e12) throw bad('Prize value must be a number of 0 or more');
      data.amountValue = n;
    }
  }
  if (has(body, 'currency')) data.currency = optText(body.currency, 'Currency', 16);
  if (has(body, 'quantity')) data.quantity = intIn(body.quantity, 'Quantity', 1, 100);
  if (has(body, 'kind')) data.kind = oneOf(body.kind, 'Prize kind', PRIZE_KINDS);
  if (has(body, 'trackId')) {
    const t = body.trackId;
    if (t === null || t === '') data.trackId = null;
    else if (isUuid(t)) data.trackId = t;
    else throw bad('Invalid track');
  }
  if (has(body, 'sortOrder')) data.sortOrder = intIn(body.sortOrder, 'Sort order', 0, 10000);
  return data;
}

export function parseCriterion(body: Body, partial: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (!partial || has(body, 'name')) data.name = reqText(body.name, 'Criterion name', 80);
  if (has(body, 'description')) data.description = optText(body.description, 'Criterion description', 1000);
  if (has(body, 'weight')) data.weight = intIn(body.weight, 'Weight', 1, 10);
  if (has(body, 'maxScore')) data.maxScore = intIn(body.maxScore, 'Max score', 1, 10);
  if (has(body, 'sortOrder')) data.sortOrder = intIn(body.sortOrder, 'Sort order', 0, 10000);
  return data;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(v: unknown): string {
  if (typeof v !== 'string') throw bad('Email is required');
  if (v.includes('\u0000')) throw bad('Enter a valid email');
  const e = v.trim().toLowerCase();
  if (e.length < 3 || e.length > 320 || !EMAIL_RE.test(e)) throw bad('Enter a valid email');
  return e;
}

/** Judge fields. trackIds: undefined = unchanged, [] = all tracks. */
export function parseJudge(body: Body, partial: boolean): { data: Record<string, unknown>; trackIds?: string[] } {
  const data: Record<string, unknown> = {};
  if (!partial) data.email = normalizeEmail(body.email);
  else if (has(body, 'email')) throw bad('A judge email cannot be changed; remove the judge and add the new email');
  if (has(body, 'name')) data.name = optText(body.name, 'Judge name', 120);
  if (has(body, 'status')) {
    if (!partial) throw bad('New judges are always active');
    data.status = oneOf(body.status, 'Status', JUDGE_STATUSES);
  }
  let trackIds: string[] | undefined;
  if (has(body, 'trackIds')) {
    if (!Array.isArray(body.trackIds) || body.trackIds.length > LIMITS.tracks || !body.trackIds.every(isUuid)) {
      throw bad('Invalid tracks');
    }
    trackIds = [...new Set(body.trackIds as string[])];
  }
  return { data, trackIds };
}
