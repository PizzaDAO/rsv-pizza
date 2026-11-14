/**
 * brand-checklists: due dates for brand-series host checklist items.
 *
 * GPP stores ABSOLUTE due dates on checklist_defaults because every GPP party is
 * on the same day. Brand-series parties each have their own date (meetups,
 * hackathons; Doge Day is fixed to Nov 2 but still per-party), so their due
 * dates are offsets in days from the party's own date, keyed by the series'
 * create_flow preset and the item name. They are computed when the checklist is
 * read, so they follow the party if the host changes the date.
 *
 * A due date stored on the item (e.g. set by an admin at /admin/series) always
 * wins; offsets only fill items whose due_date is NULL.
 */
import type { CreateFlowKey } from './createPresets.js';

export interface DueOffset {
  /** Days relative to the anchor date (negative = before). */
  days: number;
  /** 'start' = the party's date; 'end' = its end date (multi-day events). */
  anchor?: 'start' | 'end';
}

export const BRAND_DUE_OFFSETS: Record<CreateFlowKey, Record<string, DueOffset>> = {
  // Doge Day (one global day, Nov 2).
  global_day: {
    'Add a co-host': { days: -49 },
    'Get approved': { days: -42 },
    'Pick a venue': { days: -42 },
    'Find partners': { days: -35 },
    'Choose a pizzeria': { days: -28 },
    'Share your invite link': { days: -28 },
    'Share the Doge Day countdown': { days: -28 },
    'Estimate attendance': { days: -21 },
    'Customize your flyer': { days: -21 },
    'Post on X with #DogeDay': { days: -14 },
    'Plan Doge decor and a Kabosu photo spot': { days: -14 },
    'Print flyers and stickers': { days: -10 },
    'Pick a photo/video person': { days: -7 },
    'Use your Party Guide on Doge Day': { days: 0 },
    'Upload photos after the party': { days: 3 },
  },
  // Team1 community meetup (single evening, shorter lead time).
  meetup: {
    'Confirm venue': { days: -21 },
    'Line up a speaker or topic': { days: -21 },
    'Add a co-host': { days: -21 },
    'Get approved': { days: -14 },
    'Share in your Team1 community chat': { days: -14 },
    'Post to socials': { days: -10 },
    'Estimate attendance': { days: -7 },
    'Choose a pizzeria': { days: -7 },
    'Pick a photo/video person': { days: -3 },
    'Print name tags for check-in': { days: -2 },
    'Remind guests the day before': { days: -1 },
    'Post photos and a recap': { days: 2 },
    'Schedule the next meetup': { days: 7 },
  },
  // Monad hackathon (multi-day; post-event items anchor on the last day).
  hackathon: {
    'Get approved': { days: -42 },
    'Confirm venue and Wi-Fi/power': { days: -42 },
    'Publish tracks, prizes and rules': { days: -35 },
    'Set up the submission platform': { days: -28 },
    'Add a co-host or volunteers': { days: -28 },
    'Post the day-by-day schedule': { days: -21 },
    'Line up judges and mentors': { days: -21 },
    'Post to socials': { days: -21 },
    'Set capacity and review applications': { days: -14 },
    'Plan meals per day: choose pizzerias': { days: -10 },
    'Pick a photo/video person': { days: -7 },
    'Day-of: check-in and displays': { days: 0 },
    'Run demos and judging': { days: 0, anchor: 'end' },
    'Post winners and photos': { days: 2, anchor: 'end' },
    'Send prizes to winners': { days: 14, anchor: 'end' },
  },
};

/** 'YYYY-MM-DD' of an instant in a time zone (UTC if missing/invalid). */
export function localDateString(instant: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DueParty {
  date: Date | null;
  endTime?: Date | null;
  timezone?: string | null;
  createdAt?: Date | null;
}

/**
 * Due date (UTC-midnight Date, the same shape Prisma returns for @db.Date) for a
 * brand item, or null when the series has no preset, the item has no offset, or
 * the party has no date. Clamped to the party's creation date so a host who
 * creates an event late doesn't start with items already overdue.
 */
export function brandDueDate(createFlow: string | null | undefined, itemName: string, party: DueParty): Date | null {
  if (!createFlow || !party.date) return null;
  const offsets = (BRAND_DUE_OFFSETS as Record<string, Record<string, DueOffset>>)[createFlow];
  const offset = offsets?.[itemName];
  if (!offset) return null;
  const anchorInstant = offset.anchor === 'end' && party.endTime ? party.endTime : party.date;
  let ymd = addDays(localDateString(anchorInstant, party.timezone), offset.days);
  if (party.createdAt) {
    const created = localDateString(party.createdAt, party.timezone);
    if (ymd < created) ymd = created;
  }
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Fill null due dates on default items from the brand offsets (pure; returns new objects). */
export function withBrandDueDates<T extends { name: string; dueDate: Date | null; isDefault: boolean }>(
  items: T[], createFlow: string | null | undefined, party: DueParty,
): T[] {
  if (!createFlow) return items;
  return items.map((it) => {
    if (it.dueDate || !it.isDefault) return it;
    const due = brandDueDate(createFlow, it.name, party);
    return due ? { ...it, dueDate: due } : it;
  });
}
