/**
 * Event-type presets for the white-label streamlined create flow
 * (plans/wl-streamlined-create.md section 3b). A series opts in via its
 * `createFlow` key; the backend mirrors the server-side fields. Keep the key
 * set in sync with backend/src/lib/createPresets.ts.
 */

export type CreateFlowKey = 'global_day' | 'meetup' | 'hackathon';
export type DateMode = 'fixed' | 'single' | 'range';
export type PresetField = 'description' | 'capacity' | 'requireApproval' | 'externalLink';

export interface CreatePreset {
  key: CreateFlowKey;
  /** Default name template; empty means host-named. Tokens: {city} {brand} {series}. */
  nameTemplate: string;
  /** Show the (prefilled) name field? */
  nameEditable: boolean;
  /** fixed = series.eventDate; single = host date + times same day; range = start/end date + time. */
  dateMode: DateMode;
  defaultStart: string; // HH:MM local
  defaultEnd: string; // HH:MM local
  /** For `range`: default length in days when the host picks a start date. */
  defaultDays: number;
  /** city = (cities) autocomplete, pick required; venue_or_city = venue autocomplete, venue optional. */
  location: 'city' | 'venue_or_city';
  fields: PresetField[];
  requiredFields: Array<'name' | 'location' | 'date' | 'capacity'>;
  defaults: { requireApproval: boolean; hideGuests: boolean };
  /** Apps pinned on the host page after create (ids from lib/appDefinitions PINNABLE_APPS). */
  pinnedApps: string[];
  /** Soft "already one in this city" hint. */
  cityDedupeHint: boolean;
  copy: {
    /** May use {series} / {brand} tokens (renderNameTemplate). */
    title: string;
    subtitle: string;
    cityPlaceholder: string;
    namePlaceholder: string;
    submit: string;
  };
}

export const CREATE_PRESETS: Record<CreateFlowKey, CreatePreset> = {
  global_day: {
    key: 'global_day',
    nameTemplate: '{series} {city}',
    nameEditable: false,
    dateMode: 'fixed',
    defaultStart: '18:00',
    defaultEnd: '21:00',
    defaultDays: 1,
    location: 'city',
    fields: [],
    requiredFields: ['location'],
    defaults: { requireApproval: false, hideGuests: false },
    pinnedApps: ['checklist', 'venue'],
    cityDedupeHint: true,
    copy: {
      title: 'Host a Party for {series}',
      subtitle: 'Pick your city and you are done. You can add the venue later.',
      cityPlaceholder: 'Your city',
      namePlaceholder: 'Event name',
      submit: 'Create my party',
    },
  },
  meetup: {
    key: 'meetup',
    nameTemplate: '{brand} Meetup {city}',
    nameEditable: true,
    dateMode: 'single',
    defaultStart: '18:30',
    defaultEnd: '21:00',
    defaultDays: 1,
    location: 'venue_or_city',
    fields: ['description'],
    requiredFields: ['name', 'location', 'date'],
    defaults: { requireApproval: false, hideGuests: false },
    pinnedApps: ['checklist', 'venue'],
    cityDedupeHint: false,
    copy: {
      title: 'Host a meetup',
      subtitle: 'Name it, pick a place and a time. The venue can wait.',
      cityPlaceholder: 'Venue or city',
      namePlaceholder: 'Meetup name',
      submit: 'Create meetup',
    },
  },
  hackathon: {
    key: 'hackathon',
    nameTemplate: '',
    nameEditable: true,
    dateMode: 'range',
    defaultStart: '10:00',
    defaultEnd: '18:00',
    defaultDays: 2,
    location: 'venue_or_city',
    fields: ['description', 'capacity', 'requireApproval', 'externalLink'],
    requiredFields: ['name', 'location', 'date', 'capacity'],
    defaults: { requireApproval: true, hideGuests: false },
    pinnedApps: ['checklist', 'venue', 'staffing', 'displays'],
    cityDedupeHint: false,
    copy: {
      title: 'Host a hackathon',
      subtitle: 'Name it, set the dates, capacity and where it happens.',
      cityPlaceholder: 'Venue or city',
      namePlaceholder: 'Hackathon name',
      submit: 'Create hackathon',
    },
  },
};

export const CREATE_FLOW_KEYS = Object.keys(CREATE_PRESETS) as CreateFlowKey[];

/** Look up a preset by the series' `createFlow`; null for absent/unknown values (generic form). */
export function resolvePreset(createFlow: string | null | undefined): CreatePreset | null {
  if (!createFlow) return null;
  return (CREATE_FLOW_KEYS as string[]).includes(createFlow)
    ? CREATE_PRESETS[createFlow as CreateFlowKey]
    : null;
}

export function renderNameTemplate(
  template: string,
  tokens: { city?: string | null; brand?: string | null; series?: string | null },
): string {
  return template
    .replace(/\{city\}/g, tokens.city ?? '')
    .replace(/\{brand\}/g, tokens.brand ?? '')
    .replace(/\{series\}/g, tokens.series ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
