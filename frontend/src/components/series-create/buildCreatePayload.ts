import type { CreatePartyData } from '../../lib/api';
import type { PublicSeries } from '../../lib/seriesApi';
import { parseDateTimeInTimezone } from '../../utils/dateUtils';
import { renderNameTemplate, type CreatePreset } from '../../config/createPresets';

/** Form state for SeriesCreateFlow. Serializable (survives the login round trip via sessionStorage). */
export interface CreateFormState {
  name: string;
  /** True once the host edited the name; stops the template from overwriting it. */
  nameTouched: boolean;
  /** What is typed in the location input. */
  locationText: string;
  /** True only after picking from the autocomplete list. */
  picked: boolean;
  cityName: string;
  country: string;
  /** Full formatted address / city label from the pick. */
  address: string;
  placeId: string | null;
  venueName: string | null;
  /** Street part from the pick; absent for city-level picks. */
  street: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  description: string;
  maxGuests: string;
  requireApproval: boolean;
  externalLink: string;
}

export const MAX_RANGE_DAYS = 14;

export function seriesTokens(series: Pick<PublicSeries, 'displayName' | 'brandName'>, city: string) {
  return { city, brand: series.brandName || series.displayName, series: series.displayName };
}

/** The name the event will get (template-rendered unless the host typed one and the preset allows it). */
export function resolveName(preset: CreatePreset, series: PublicSeries, form: CreateFormState): string {
  if (preset.nameEditable && form.name.trim()) return form.name.trim();
  const tpl = series.nameTemplate || preset.nameTemplate;
  return tpl ? renderNameTemplate(tpl, seriesTokens(series, form.cityName)) : '';
}

/** YYYY-MM-DD for the event's first day. */
export function resolveStartDate(preset: CreatePreset, series: PublicSeries, form: CreateFormState): string {
  if (preset.dateMode === 'fixed') return series.eventDate ? series.eventDate.slice(0, 10) : '';
  return form.startDate;
}

export function resolveEndDate(preset: CreatePreset, series: PublicSeries, form: CreateFormState): string {
  if (preset.dateMode === 'range') return form.endDate;
  return resolveStartDate(preset, series, form);
}

/** First problem with the form, or null when it can be submitted. */
export function validateCreateForm(preset: CreatePreset, series: PublicSeries, form: CreateFormState): string | null {
  const required = preset.requiredFields;
  if (required.includes('location') && (!form.picked || (preset.location === 'city' && !form.cityName))) {
    return preset.location === 'city' ? 'Pick your city from the list.' : 'Pick a place from the list.';
  }
  if (required.includes('name') && !resolveName(preset, series, form)) return 'Give your event a name.';

  const startDate = resolveStartDate(preset, series, form);
  const endDate = resolveEndDate(preset, series, form);
  if (!startDate) return preset.dateMode === 'fixed' ? 'The event date is not set yet.' : 'Pick a start date.';
  if (!form.startTime || !form.endTime) return 'Set a start and end time.';
  if (preset.dateMode === 'range' && !endDate) return 'Pick an end date.';

  const tz = form.timezone || 'UTC';
  const start = parseDateTimeInTimezone(startDate, form.startTime, tz);
  const end = parseDateTimeInTimezone(endDate, form.endTime, tz);
  if (!(end.getTime() > start.getTime())) return 'The end must be after the start.';
  if (preset.dateMode === 'range' && end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400000) {
    return `Events can span at most ${MAX_RANGE_DAYS} days.`;
  }

  if (required.includes('capacity')) {
    const n = parseInt(form.maxGuests, 10);
    if (!Number.isFinite(n) || n < 1) return 'Set a capacity (how many people can attend).';
  }
  if (preset.fields.includes('externalLink') && form.externalLink.trim()) {
    if (!/^https?:\/\/\S+\.\S+/i.test(form.externalLink.trim())) return 'The rules/tracks link must start with http(s)://';
  }
  return null;
}

/**
 * Pure mapping from form state to the POST /api/parties body. `seriesSlug` is added by
 * createPartyApi. Call validateCreateForm first.
 */
export function buildCreatePayload(
  preset: CreatePreset,
  series: PublicSeries,
  form: CreateFormState,
  hostName?: string,
): CreatePartyData {
  const tz = form.timezone || 'UTC';
  const startDate = resolveStartDate(preset, series, form);
  const endDate = resolveEndDate(preset, series, form);
  const start = parseDateTimeInTimezone(startDate, form.startTime, tz);
  const end = parseDateTimeInTimezone(endDate, form.endTime, tz);

  const cityOnly = preset.location === 'city' || (!form.venueName && !form.street);
  const link = form.externalLink.trim();
  const maxGuests = parseInt(form.maxGuests, 10);
  const description = form.description.trim();

  const payload: CreatePartyData = {
    name: resolveName(preset, series, form) || undefined,
    hostName: hostName || undefined,
    date: start.toISOString(),
    endTime: end.toISOString(),
    duration: (end.getTime() - start.getTime()) / 3600000,
    timezone: form.timezone || undefined,
    pizzaStyle: 'new-york',
    availableBeverages: [],
    address: form.address || undefined,
    placeId: cityOnly ? undefined : form.placeId || undefined,
    venueName: cityOnly ? undefined : form.venueName,
    city: form.cityName || undefined,
    country: form.country || null,
    latitude: form.lat,
    longitude: form.lng,
    addressIsCityDefault: cityOnly,
  };
  if (preset.fields.includes('description') && description) payload.description = description;
  if (preset.fields.includes('capacity') && Number.isFinite(maxGuests) && maxGuests > 0) payload.maxGuests = maxGuests;
  if (preset.fields.includes('requireApproval')) payload.requireApproval = form.requireApproval;
  if (preset.fields.includes('externalLink') && link) payload.externalLinks = [{ label: 'Rules and tracks', url: link }];
  return payload;
}
