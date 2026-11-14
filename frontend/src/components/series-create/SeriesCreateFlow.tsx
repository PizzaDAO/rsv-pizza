import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Calendar, FileText, Link as LinkIcon, Loader2, Lock, Type, Users } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { LocationAutocomplete, type CityData } from '../LocationAutocomplete';
import { TimePickerInput } from '../TimePickerInput';
import { TimezonePickerInput } from '../TimezonePickerInput';
import { LoginModal } from '../LoginModal';
import { useAuth } from '../../contexts/AuthContext';
import { createPartyApi, updatePartyApi, fetchPublicSeriesEvents } from '../../lib/api';
import type { PublicSeries } from '../../lib/seriesApi';
import { renderNameTemplate, type CreatePreset } from '../../config/createPresets';
import {
  buildCreatePayload,
  resolveName,
  seriesTokens,
  resolveStartDate,
  validateCreateForm,
  type CreateFormState,
} from './buildCreatePayload';

interface SeriesCreateFlowProps {
  series: PublicSeries;
  preset: CreatePreset;
}

const pendingKey = (slug: string) => `pendingSeriesCreate:${slug}`;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function initialForm(preset: CreatePreset, series: PublicSeries): CreateFormState {
  return {
    name: '',
    nameTouched: false,
    locationText: '',
    picked: false,
    cityName: '',
    country: '',
    address: '',
    placeId: null,
    venueName: null,
    street: null,
    lat: null,
    lng: null,
    timezone: detectTimezone(),
    startDate: '',
    startTime: series.eventStartTime || preset.defaultStart,
    endDate: '',
    endTime: series.eventEndTime || preset.defaultEnd,
    description: '',
    maxGuests: '',
    requireApproval: preset.defaults.requireApproval,
    externalLink: '',
  };
}

function normalizeCity(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function SeriesCreateFlow({ series, preset }: SeriesCreateFlowProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [form, setForm] = useState<CreateFormState>(() => {
    // Resume after the login round trip.
    try {
      const saved = sessionStorage.getItem(pendingKey(series.slug));
      if (saved) return { ...initialForm(preset, series), ...JSON.parse(saved) };
    } catch { /* fall through to a fresh form */ }
    return initialForm(preset, series);
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const resumed = useRef(false);

  // Soft dedupe hint: is there already an event in this city? Degrades to nothing on failure.
  const { data: seriesEvents } = useQuery({
    queryKey: ['public-series-events', series.slug],
    queryFn: () => fetchPublicSeriesEvents(series.slug),
    enabled: preset.cityDedupeHint,
    retry: false,
    staleTime: 60_000,
  });
  const existing = preset.cityDedupeHint && form.cityName
    ? (seriesEvents?.events ?? []).find((e) => normalizeCity(e.city) === normalizeCity(form.cityName))
    : undefined;

  const update = (patch: Partial<CreateFormState>) => {
    setError(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const submit = async (f: CreateFormState) => {
    setError(null);
    const problem = validateCreateForm(preset, series, f);
    if (problem) {
      setError(problem);
      return;
    }
    setCreating(true);
    try {
      const { party } = await createPartyApi(buildCreatePayload(preset, series, f, user?.name || undefined));
      const code: string | undefined = party?.inviteCode;
      if (!code) throw new Error('No invite code returned');
      sessionStorage.removeItem(pendingKey(series.slug));
      // Safe against merge order: if the backend did not pin the preset apps, pin them here.
      if (!(party.pinnedApps ?? []).includes('checklist') && party.id) {
        try { await updatePartyApi(party.id, { pinnedApps: preset.pinnedApps }); } catch { /* best effort */ }
      }
      navigate(`/host/${code}/checklist`);
    } catch (err) {
      console.error('Error creating event:', err);
      setError(err instanceof Error && err.message ? err.message : 'Could not create the event. Please try again.');
      setCreating(false);
    }
  };

  // After login the form is restored from sessionStorage; submit once.
  useEffect(() => {
    if (!user || resumed.current) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(pendingKey(series.slug)); } catch { /* ignore */ }
    if (!saved) return;
    resumed.current = true;
    void submit({ ...initialForm(preset, series), ...JSON.parse(saved) });
  }, [user]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    if (!user) {
      const problem = validateCreateForm(preset, series, form);
      if (problem) {
        setError(problem);
        return;
      }
      setError(null);
      try {
        sessionStorage.setItem(pendingKey(series.slug), JSON.stringify(form));
        sessionStorage.setItem('authReturnUrl', window.location.pathname);
      } catch { /* storage blocked: the form just won't resume */ }
      setShowLogin(true);
      return;
    }
    void submit(form);
  };

  const handleCitySelected = (c: CityData) => {
    setForm((prev) => ({
      ...prev,
      cityName: c.cityName || '',
      country: c.country || '',
      street: c.street || null,
      lat: c.lat || prev.lat,
      lng: c.lng || prev.lng,
    }));
  };

  const previewName = resolveName(preset, series, form);
  const nameInputValue = form.nameTouched ? form.name : previewName;
  const fixedDate = preset.dateMode === 'fixed' ? resolveStartDate(preset, series, form) : '';

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="space-y-3" data-testid="series-create-form">
        <div className="text-center pb-2">
          <h1 className="text-2xl font-bold text-theme-text">{renderNameTemplate(preset.copy.title, seriesTokens(series, ''))}</h1>
          <p className="text-sm text-theme-text-secondary mt-1">{preset.copy.subtitle}</p>
        </div>

        {preset.nameEditable && (
          <IconInput
            icon={Type}
            type="text"
            value={nameInputValue}
            onChange={(e) => update({ name: e.target.value, nameTouched: true })}
            placeholder={preset.copy.namePlaceholder}
            required={preset.requiredFields.includes('name')}
            data-testid="series-create-name"
          />
        )}

        <LocationAutocomplete
          value={form.locationText}
          onChange={(v) => update({
            locationText: v,
            // Typing without picking from the list invalidates the pick.
            picked: false, cityName: '', country: '', address: '', placeId: null, venueName: null,
            street: null, lat: null, lng: null,
          })}
          onTimezoneChange={(tz) => update({ timezone: tz })}
          onLocationSelected={(loc) => update({ lat: loc?.lat ?? null, lng: loc?.lng ?? null })}
          onCitySelected={handleCitySelected}
          onPlaceSelected={(address, venueName, placeId) => update({ address, venueName, placeId, picked: true })}
          types={preset.location === 'city' ? ['(cities)'] : undefined}
          placeholder={preset.copy.cityPlaceholder}
          disabled={creating}
        />

        {!preset.nameEditable && form.cityName && previewName && (
          <div className="text-center text-theme-text font-semibold py-1" data-testid="series-create-name-preview">
            {previewName}
          </div>
        )}

        {existing && (
          <div className="flex items-start gap-2 rounded-xl border border-theme-stroke bg-theme-surface p-3 text-sm text-theme-text-secondary" data-testid="series-create-dedupe">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-theme-text-muted" />
            <span>
              A party already exists in {form.cityName}.{' '}
              {existing.slug && <Link to={`/${existing.slug}`} className="underline">Join it</Link>}
              {existing.slug && ', or '}create your own anyway.
            </span>
          </div>
        )}

        {preset.dateMode === 'fixed' ? (
          <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-theme-text" data-testid="series-create-fixed-date">
              <Lock size={16} className="text-theme-text-muted" />
              <span className="font-medium">
                {fixedDate
                  ? new Date(`${fixedDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
                  : 'Date to be announced'}
              </span>
            </div>
            <TimeRow form={form} update={update} />
          </div>
        ) : (
          <div className="bg-theme-surface border border-theme-stroke rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <IconInput
                  icon={Calendar}
                  type="date"
                  value={form.startDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    update({
                      startDate: v,
                      ...(preset.dateMode === 'range' && v && (!form.endDate || form.endDate < v)
                        ? { endDate: addDays(v, preset.defaultDays - 1) }
                        : {}),
                    });
                  }}
                  style={{ colorScheme: 'dark' }}
                  placeholder="Start date"
                  aria-label="Start date"
                  data-testid="series-create-start-date"
                />
              </div>
              <TimePickerInput value={form.startTime} onChange={(v) => update({ startTime: v })} placeholder="Start time" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                {preset.dateMode === 'range' ? (
                  <IconInput
                    icon={Calendar}
                    type="date"
                    value={form.endDate}
                    min={form.startDate || undefined}
                    onChange={(e) => update({ endDate: e.target.value })}
                    style={{ colorScheme: 'dark' }}
                    placeholder="End date"
                    aria-label="End date"
                    data-testid="series-create-end-date"
                  />
                ) : (
                  <div className="text-sm text-theme-text-secondary pl-1">Ends the same day</div>
                )}
              </div>
              <TimePickerInput value={form.endTime} onChange={(v) => update({ endTime: v })} placeholder="End time" />
            </div>
            <div className="flex justify-end">
              <TimezonePickerInput value={form.timezone} onChange={(v) => update({ timezone: v })} />
            </div>
          </div>
        )}

        {preset.fields.includes('capacity') && (
          <IconInput
            icon={Users}
            type="number"
            min={1}
            inputMode="numeric"
            value={form.maxGuests}
            onChange={(e) => update({ maxGuests: e.target.value })}
            placeholder="Capacity (max attendees)"
            required={preset.requiredFields.includes('capacity')}
            data-testid="series-create-capacity"
          />
        )}

        {preset.fields.includes('requireApproval') && (
          <div className="rounded-xl border border-theme-stroke bg-theme-surface p-3">
            <Checkbox
              checked={form.requireApproval}
              onChange={() => update({ requireApproval: !form.requireApproval })}
              label="Attendees apply and you approve them"
            />
            <p className="text-xs text-theme-text-muted mt-1 pl-7">
              Guests request a spot and you accept or decline each one.
            </p>
          </div>
        )}

        {preset.fields.includes('externalLink') && (
          <IconInput
            icon={LinkIcon}
            type="url"
            value={form.externalLink}
            onChange={(e) => update({ externalLink: e.target.value })}
            placeholder="Rules / tracks link (optional)"
            data-testid="series-create-link"
          />
        )}

        {preset.fields.includes('description') && (
          <IconInput
            icon={FileText}
            multiline
            rows={3}
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Description (optional)"
          />
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-400" role="alert" data-testid="series-create-error">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className="btn-primary w-full flex items-center justify-center gap-2 text-lg py-4"
          disabled={creating}
          data-testid="series-create-submit"
        >
          {creating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Creating...
            </>
          ) : (
            preset.copy.submit
          )}
        </button>

        <div className="text-center pt-1">
          <Link to="/new?full=1" className="text-xs text-theme-text-muted underline" data-testid="series-create-full-link">
            Use the full form
          </Link>
        </div>
      </form>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}

function TimeRow({ form, update }: { form: CreateFormState; update: (p: Partial<CreateFormState>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TimePickerInput value={form.startTime} onChange={(v) => update({ startTime: v })} placeholder="Start time" />
      <span className="text-theme-text-muted text-sm">to</span>
      <TimePickerInput value={form.endTime} onChange={(v) => update({ endTime: v })} placeholder="End time" />
      <div className="ml-auto">
        <TimezonePickerInput value={form.timezone} onChange={(v) => update({ timezone: v })} />
      </div>
    </div>
  );
}
