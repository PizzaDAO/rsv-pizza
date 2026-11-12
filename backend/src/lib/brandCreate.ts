/**
 * Server-side application of a create-flow preset to POST /api/parties (white-label streamlined
 * create, plans/wl-streamlined-create.md). Only called when the branded series has a known
 * `create_flow`; a NULL create_flow never reaches this module (current behavior is unchanged).
 *
 * Precedence for overridable defaults: explicit body value > preset default > series column.
 */
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import type { BrandedSeries } from './siteBrand.js';
import {
  ServerCreatePreset,
  renderNameTemplate,
  customUrlCandidates,
} from './createPresets.js';
import { isValidTimezone, localToUTC, localHM } from './localTime.js';

/** Brand creates per account per rolling 24h (Decided #10). Applies only to preset flows. */
export const BRAND_CREATES_PER_DAY = 5;

const HM_RE = /^(\d{1,2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BrandCreateOverrides {
  name: string;
  date: Date | null;
  endTime: Date | null;
  duration: number | null;
  timezone: string | null;
  address: string | null;
  addressIsCityDefault: boolean;
  customUrl: string | null;
  maxGuests: number | null;
  requireApproval: boolean;
  hideGuests: boolean;
  photosEnabled: boolean;
  photosPublic: boolean;
  eventImageUrl: string | null;
  description: string | null;
  pinnedApps: string[];
  externalLinks?: Array<{ label: string; url: string }>;
}

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');

function parseHM(v: string): { h: number; m: number } | null {
  const m = HM_RE.exec(v.trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  return h <= 23 && mm <= 59 ? { h, m: mm } : null;
}

/** A posted time as local 'HH:MM': either already 'HH:MM', or an ISO instant converted into `tz`. */
function postedLocalHM(v: unknown, tz: string): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  if (parseHM(v)) return v.trim();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : localHM(d, tz);
}

function cleanExternalLinks(v: unknown): Array<{ label: string; url: string }> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Array<{ label: string; url: string }> = [];
  for (const l of v.slice(0, 5)) {
    if (!l || typeof l !== 'object') continue;
    const url = typeof (l as any).url === 'string' ? (l as any).url.trim() : '';
    const label = typeof (l as any).label === 'string' ? (l as any).label.trim().slice(0, 80) : '';
    if (!/^https?:\/\//i.test(url) || url.length > 500) continue;
    out.push({ label: label || url, url });
  }
  return out;
}

/** Throws 429 when the account already made BRAND_CREATES_PER_DAY branded-series parties in 24h. */
export async function enforceBrandCreateLimit(userId: string): Promise<void> {
  const recent = await prisma.party.count({
    where: {
      userId,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
      eventSeries: { is: { siteUrl: { not: null } } },
    },
  });
  if (recent >= BRAND_CREATES_PER_DAY) {
    throw new AppError(
      `You can create up to ${BRAND_CREATES_PER_DAY} events per day. Please try again tomorrow.`,
      429,
      'RATE_LIMITED',
    );
  }
}

export async function applyCreatePreset(
  series: BrandedSeries,
  preset: ServerCreatePreset,
  body: Record<string, any>,
): Promise<BrandCreateOverrides> {
  const city = typeof body.city === 'string' ? body.city.trim() : '';
  const address = typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null;
  if (!city && !address) throw bad('City or address is required');

  // ---- name ----
  const tpl = series.nameTemplate?.trim() || preset.nameTemplate;
  const templated = tpl
    ? renderNameTemplate(tpl, {
        city,
        brand: series.brandName || series.displayName || null,
        series: series.displayName || null,
      })
    : '';
  const bodyName = typeof body.name === 'string' ? body.name.trim() : '';
  let name: string;
  if (preset.nameLocked && templated) {
    if (!city) throw bad('City is required');
    name = templated; // locked: always the template
  } else {
    name = bodyName || templated;
    if (!name) throw bad('Event name is required');
  }

  // ---- date / time ----
  let date: Date | null = null;
  let endTime: Date | null = null;
  let timezone: string | null = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : null;

  if (preset.dateMode === 'fixed') {
    // Server-enforced day from series.eventDate (stored as midnight UTC; take only Y-M-D).
    if (!series.eventDate) throw bad('This series has no fixed date configured');
    if (!isValidTimezone(timezone)) throw bad('A valid timezone is required');
    const y = series.eventDate.getUTCFullYear();
    const mo = series.eventDate.getUTCMonth() + 1;
    const d = series.eventDate.getUTCDate();
    const startHM = postedLocalHM(body.startTime ?? body.date, timezone as string) ?? series.eventStartTime ?? preset.defaultStart;
    const endHM = postedLocalHM(body.endTime, timezone as string) ?? series.eventEndTime ?? preset.defaultEnd;
    const s = parseHM(startHM);
    const e = parseHM(endHM);
    if (!s || !e) throw bad('Invalid start or end time');
    date = localToUTC(y, mo, d, s.h, s.m, timezone as string);
    endTime = localToUTC(y, mo, d, e.h, e.m, timezone as string);
    if (endTime <= date) throw bad('End time must be after start time');
  } else {
    if (!body.date) throw bad('Start date and time are required');
    date = new Date(body.date);
    if (Number.isNaN(date.getTime())) throw bad('Invalid start date');
    if (body.endTime) {
      endTime = new Date(body.endTime);
      if (Number.isNaN(endTime.getTime())) throw bad('Invalid end date');
      if (endTime <= date) throw bad('End time must be after start time');
      if (preset.maxSpanDays && endTime.getTime() - date.getTime() > preset.maxSpanDays * DAY_MS) {
        throw bad(`Events can span at most ${preset.maxSpanDays} days`);
      }
    }
  }
  const duration = endTime && date ? Math.round(((endTime.getTime() - date.getTime()) / 3_600_000) * 100) / 100 : (body.duration || null);

  // ---- capacity ----
  const maxGuestsNum = body.maxGuests ? Number(body.maxGuests) : null;
  if (maxGuestsNum !== null && (!Number.isFinite(maxGuestsNum) || maxGuestsNum < 1)) throw bad('Capacity must be a positive number');
  if (preset.requireMaxGuests && !maxGuestsNum) throw bad('Capacity is required');

  // ---- custom URL: client value wins (route validates it); else <series>-<city> with collision suffixes ----
  let customUrl: string | null = body.customUrl || null;
  if (!customUrl && series.slug) {
    const candidates = customUrlCandidates(series.slug, city || '');
    if (candidates.length) {
      const taken = await prisma.party.findMany({
        where: { customUrl: { in: candidates } },
        select: { customUrl: true },
      });
      const takenSet = new Set(taken.map((t: { customUrl: string | null }) => t.customUrl));
      customUrl = candidates.find((c) => !takenSet.has(c)) ?? null;
    }
  }

  // ---- precedence: body > preset > series ----
  const pick = <T>(bodyVal: unknown, presetVal: T | undefined, seriesVal: T | undefined, fallback: T): T =>
    typeof bodyVal === 'boolean' ? (bodyVal as unknown as T) : presetVal !== undefined ? presetVal : seriesVal !== undefined ? seriesVal : fallback;

  const cityOnly = preset.dateMode === 'fixed'
    ? !body.venueName && !body.placeId
    : body.addressIsCityDefault === true;

  const pinnedApps = [...preset.pinnedApps];
  if (series.flyerTemplateKey && !pinnedApps.includes('flyer')) pinnedApps.push('flyer');

  return {
    name,
    date,
    endTime,
    duration,
    timezone,
    address: address ?? (city || null),
    addressIsCityDefault: cityOnly,
    customUrl,
    maxGuests: maxGuestsNum,
    requireApproval: pick(body.requireApproval, preset.defaults.requireApproval, series.requireApproval, false),
    hideGuests: pick(body.hideGuests, preset.defaults.hideGuests, series.hideGuests, false),
    photosEnabled: series.photosEnabled ?? true,
    photosPublic: series.photosPublic ?? true,
    eventImageUrl: body.eventImageUrl || series.ogImageUrl || null,
    description: (typeof body.description === 'string' && body.description.trim()) || series.description || null,
    pinnedApps,
    externalLinks: cleanExternalLinks(body.externalLinks),
  };
}
