/**
 * Server-side registry for the white-label streamlined create flow (plans/wl-streamlined-create.md).
 * `event_series.create_flow` selects a preset; NULL = the generic create flow (unchanged).
 * The frontend mirrors the same keys in frontend/src/config/createPresets.ts.
 */

export const CREATE_FLOW_KEYS = ['global_day', 'meetup', 'hackathon'] as const;
export type CreateFlowKey = (typeof CREATE_FLOW_KEYS)[number];

export type DateMode = 'fixed' | 'single' | 'range';

export interface ServerCreatePreset {
  key: CreateFlowKey;
  /** Default name template when series.name_template is NULL. null = host-named (name required). */
  nameTemplate: string | null;
  /** true = the name is always rendered from the template (host can't override at create). */
  nameLocked: boolean;
  dateMode: DateMode;
  /** 'HH:MM' local defaults when the series has no start/end time. */
  defaultStart: string;
  defaultEnd: string;
  /** Preset defaults; undefined = fall through to the series column. */
  defaults: { requireApproval?: boolean; hideGuests?: boolean };
  /** App ids from the host-page pinnable apps (frontend lib/appDefinitions.ts). */
  pinnedApps: string[];
  requireMaxGuests: boolean;
  /** Max event span in days (range events). */
  maxSpanDays: number | null;
}

export const CREATE_PRESETS: Record<CreateFlowKey, ServerCreatePreset> = {
  global_day: {
    key: 'global_day',
    nameTemplate: '{series} {city}',
    nameLocked: true,
    dateMode: 'fixed',
    defaultStart: '18:00',
    defaultEnd: '21:00',
    defaults: {},
    pinnedApps: ['checklist', 'venue'],
    requireMaxGuests: false,
    maxSpanDays: null,
  },
  meetup: {
    key: 'meetup',
    nameTemplate: '{series} Meetup {city}',
    nameLocked: false,
    dateMode: 'single',
    defaultStart: '18:30',
    defaultEnd: '21:00',
    defaults: { requireApproval: false },
    pinnedApps: ['checklist', 'venue'],
    requireMaxGuests: false,
    maxSpanDays: null,
  },
  hackathon: {
    key: 'hackathon',
    nameTemplate: null, // host-named
    nameLocked: false,
    dateMode: 'range',
    defaultStart: '10:00',
    defaultEnd: '18:00',
    defaults: { requireApproval: true },
    pinnedApps: ['checklist', 'venue', 'staffing', 'displays'],
    requireMaxGuests: true,
    maxSpanDays: 14,
  },
};

/** Known preset for a stored value, else null (NULL/unknown = generic flow). */
export function resolveCreatePreset(key: unknown): ServerCreatePreset | null {
  return typeof key === 'string' && (CREATE_FLOW_KEYS as readonly string[]).includes(key)
    ? CREATE_PRESETS[key as CreateFlowKey]
    : null;
}

export function isCreateFlowKey(v: unknown): v is CreateFlowKey {
  return typeof v === 'string' && (CREATE_FLOW_KEYS as readonly string[]).includes(v);
}

/** Tokens: {city} {brand} {series}. Collapses extra whitespace. */
export function renderNameTemplate(tpl: string, vars: { city?: string | null; brand?: string | null; series?: string | null }): string {
  return tpl
    .replace(/\{city\}/g, vars.city ?? '')
    .replace(/\{brand\}/g, vars.brand ?? '')
    .replace(/\{series\}/g, vars.series ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'Zürich' -> 'zurich', 'New York' -> 'new-york'. */
export function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Custom-URL candidates: `<series>-<city>`, then `-2..-20`. Each is 3..50 chars. */
export function customUrlCandidates(seriesSlug: string, city: string): string[] {
  const c = citySlug(city);
  if (!c) return [];
  const base = `${seriesSlug}-${c}`.slice(0, 46).replace(/-+$/, '');
  if (base.length < 3) return [];
  return [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)];
}
