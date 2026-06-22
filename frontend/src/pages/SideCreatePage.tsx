import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  Shield, ShieldCheck, Loader2, MapPin, User, Mail, Send, DollarSign,
  Pizza, CheckCircle, ExternalLink, AlertTriangle, ArrowLeft, ArrowRight,
  Calendar, Clock, Tag,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import { Checkbox } from '../components/Checkbox';
import { LocationAutocomplete, CityData } from '../components/LocationAutocomplete';
import { TimezonePickerInput } from '../components/TimezonePickerInput';
import {
  fetchAdminMe, fetchUnderbossMe,
  createSideEvent, fetchSideAgreement,
  fetchSidePublishStatus, publishSideEvent,
  type SideCreateEventResponse,
  type SideAgreementClause, type SidePublishStatus,
} from '../lib/api';

// --- Agreement clause body rendering (cloned from GPP27CreatePage) ----------
// Parse inline `**bold**` markers: split on `**` and wrap odd-index segments
// in <strong>. Returns React nodes with stable index keys.
function renderInline(text: string): React.ReactNode[] {
  return text.split('**').map((seg, i) =>
    i % 2 === 1 ? <strong key={i}>{seg}</strong> : <React.Fragment key={i}>{seg}</React.Fragment>
  );
}

// Render a clause body: lines starting with `- ` become bullets grouped into a
// single <ul>; other lines render as <p>. Inline **bold** is parsed per line.
function renderClauseBody(body: string): React.ReactNode {
  const lines = body.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`} className="list-disc ml-5 space-y-1">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>
    );
    bullets = [];
  };

  for (const line of lines) {
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2));
    } else {
      flushBullets();
      if (line.trim().length > 0) {
        out.push(
          <p key={`p-${out.length}`} className="mb-1">
            {renderInline(line)}
          </p>
        );
      }
    }
  }
  flushBullets();
  return out;
}

export function SideCreatePage() {
  // --- All hooks declared ABOVE any conditional return (rules-of-hooks). ---
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Create form. 2-step wizard — step 1 collects details, step 2 reviews the
  // cap + confirms the agreement, and ONLY the step-2 confirm persists the
  // party. `step` toggles 1 | 2 (no router change).
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [hostName, setHostName] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [eventDate, setEventDate] = useState('');     // YYYY-MM-DD
  const [startTime, setStartTime] = useState('');     // HH:MM 24h
  const [endTime, setEndTime] = useState('');         // HH:MM 24h
  const [timezone, setTimezone] = useState<string>('America/New_York');
  const [cityData, setCityData] = useState<CityData | null>(null);
  const [venue, setVenue] = useState('');
  const [loadingReview, setLoadingReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<SideCreateEventResponse | null>(null);

  // Reimbursement cap (admin/UB-set; clamped server-side to the config ceiling).
  const [capInput, setCapInput] = useState<string>('');

  // Agreement (pre-fetched in step 1, confirmed in step 2 before create)
  const [agreementVersion, setAgreementVersion] = useState<string | null>(null);
  const [clauses, setClauses] = useState<SideAgreementClause[]>([]);
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  // Publish gates
  const [publishStatus, setPublishStatus] = useState<SidePublishStatus | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function gate() {
      try {
        const me = await fetchAdminMe();
        if (me.isAdmin) {
          if (!cancelled) { setAuthorized(true); setLoading(false); }
          return;
        }
        // Not a full admin — allow active underbosses.
        const ub = await fetchUnderbossMe().catch(() => null);
        if (!cancelled) {
          setAuthorized(!!(ub && (ub.isAdmin || ub.isUnderboss)));
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) { setAuthError(err?.message || 'Failed to verify access'); setLoading(false); }
      }
    }
    gate();
    return () => { cancelled = true; };
  }, []);

  const renderedClauses = useMemo(() => clauses.map((c) => ({ ...c, text: c.body })), [clauses]);
  const allAcked = renderedClauses.length > 0 && renderedClauses.every((c) => acked[c.id]);

  // Step 1 → 2: validate the details, then fetch the agreement clauses (NO party
  // row exists yet — agreement is auth-scoped). Nothing is persisted here.
  async function handleProceedToReview(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim() || !hostName.trim() || !email.trim() || !telegram.trim()) {
      setCreateError('Event name, host name, email, and Telegram are required.');
      return;
    }
    if (!eventDate.trim()) {
      setCreateError('Please pick an event date.');
      return;
    }
    setLoadingReview(true);
    try {
      const a = await fetchSideAgreement();
      setAgreementVersion(a.version);
      setClauses(a.clauses);
      setAcked({});
      setStep(2);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to load the agreement. Please try again.');
    } finally {
      setLoadingReview(false);
    }
  }

  // Step 2 confirm: persist the event with the approved cap + confirmed
  // agreement. This is the FIRST write to the parties table in the flow.
  async function handleCreate() {
    setCreateError(null);
    if (!allAcked || !agreementVersion) return;
    setSubmitting(true);
    try {
      const resp = await createSideEvent({
        name: name.trim(),
        hostName: hostName.trim(),
        email: email.trim(),
        telegram: telegram.trim(),
        timezone,
        date: eventDate || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        reimbursementCapUsd: Number(capInput) || 0,
        agreementVersion,
        acceptedClauseIds: Object.keys(acked).filter((id) => acked[id]),
        ...(cityData && {
          country: cityData.country,
          countryCode: cityData.countryCode,
          formattedName: cityData.formattedName,
          lat: cityData.lat,
          lng: cityData.lng,
        }),
      });
      setCreated(resp);

      // Load publish status for the freshly-created party.
      const ps = await fetchSidePublishStatus(resp.event.id).catch(() => null);
      if (ps) setPublishStatus(ps);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create event.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!created) return;
    setPublishing(true);
    try {
      await publishSideEvent(created.event.id);
      const ps = await fetchSidePublishStatus(created.event.id);
      setPublishStatus(ps);
    } catch (err: any) {
      setCreateError(err?.message || 'Cannot publish yet — check the gates below.');
    } finally {
      setPublishing(false);
    }
  }

  // ---- Conditional returns (all hooks above this point) ----
  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
      </Layout>
    );
  }

  if (!authorized || authError) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {authError || 'The side-event create flow is limited to admins and underbosses.'}
          </p>
        </div>
      </Layout>
    );
  }

  const capValue = Number(capInput);
  const capPending = !(Number.isFinite(capValue) && capValue > 0);

  return (
    <Layout>
      <Helmet><title>Create a Side Event | RSV.Pizza</title></Helmet>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="rounded-2xl p-6 sm:p-8 bg-theme-surface border border-theme-stroke">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <ShieldCheck size={20} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Create a Side Event</h1>
              <p className="text-sm text-theme-text-muted">
                Admin / underboss only. New side events are hidden from the public until you publish them.
              </p>
            </div>
          </div>

          {/* Step 1 — Details */}
          {!created && step === 1 && (
            <form onSubmit={handleProceedToReview} className="space-y-4">
              <IconInput
                icon={Tag}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Event name"
              />
              <IconInput
                icon={User}
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="Host name"
              />
              <IconInput
                icon={Mail}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Host email"
              />
              <IconInput
                icon={Send}
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="Host Telegram"
              />

              <LocationAutocomplete
                value={venue}
                onChange={(v) => { setVenue(v); setCityData(null); }}
                onTimezoneChange={setTimezone}
                onLocationSelected={() => { /* lat/lng captured via onCitySelected */ }}
                onCitySelected={(d) => { setCityData(d); setVenue(d.formattedName || d.cityName); }}
                placeholder="Venue / location (start typing, then pick from the list)"
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <IconInput
                  icon={Calendar}
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  placeholder="Date"
                />
                <IconInput
                  icon={Clock}
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="Start time"
                />
                <IconInput
                  icon={Clock}
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  placeholder="End time"
                />
              </div>

              <TimezonePickerInput value={timezone} onChange={setTimezone} />

              {createError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}

              <button
                type="submit"
                disabled={loadingReview}
                className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-semibold rounded-xl py-3 transition-colors"
              >
                {loadingReview ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {loadingReview ? 'Loading…' : 'Next: review & confirm'}
              </button>
            </form>
          )}

          {/* Step 2 — Review cap + confirm the agreement (nothing persisted yet) */}
          {!created && step === 2 && (
            <div className="space-y-8">
              <button
                type="button"
                onClick={() => { setStep(1); setCreateError(null); }}
                className="inline-flex items-center gap-1 text-sm text-red-400 hover:underline"
              >
                <ArrowLeft size={14} /> Back to details
              </button>

              <div className="text-sm text-theme-text-secondary">
                Creating <strong>{name.trim()}</strong> for{' '}
                <strong>{hostName.trim()}</strong> ({email.trim()}).
              </div>

              {/* pizza-only + reimbursement-model host messaging */}
              <section className="rounded-2xl p-5 bg-red-500/15 border border-red-500/30">
                <div className="flex items-center gap-2 font-bold text-lg">
                  <Pizza size={20} /> We reimburse pizza only
                </div>
                <p className="mt-2 text-sm text-theme-text-secondary">
                  This is a <strong>reimbursement model</strong>: the host pays for pizza first, then
                  PizzaDAO reimburses the pizza cost — it is not an upfront grant, and only pizza is covered.
                </p>
                <p className="mt-3 text-sm">
                  {capPending ? (
                    <>The approved amount is <strong>pending</strong>. You can still create the event —
                    the pizza reimbursement budget can be confirmed shortly.</>
                  ) : (
                    <>Approved to spend up to <strong>${capValue}</strong> on pizza.</>
                  )}
                </p>
              </section>

              {/* reimbursement cap — admin/UB-editable, no tiers */}
              <section>
                <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
                  <DollarSign size={18} /> Reimbursement cap
                </h2>
                <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 space-y-3">
                  <IconInput
                    icon={DollarSign}
                    type="number"
                    min={0}
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    placeholder="Approved reimbursement cap (USD)"
                  />
                  <p className="text-xs text-theme-text-muted">
                    Set the approved pizza reimbursement cap for this event. Amounts above the configured
                    ceiling are clamped on save. Leave at 0 to start pending.
                  </p>
                </div>
              </section>

              {/* Side-event agreement (data-driven) — must be confirmed before create */}
              <section>
                <h2 className="text-lg font-bold mb-1">Host Agreement</h2>
                <p className="text-sm text-theme-text-secondary mb-3">
                  Confirm every condition below before creating this event
                  {agreementVersion ? ` (${agreementVersion})` : ''}:
                </p>
                <div className="space-y-4">
                  {renderedClauses.map((c) => (
                    <div key={c.id} className="space-y-1">
                      <Checkbox
                        checked={!!acked[c.id]}
                        onChange={() => setAcked((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
                        label={c.heading ?? ''}
                        labelClassName="text-base font-semibold"
                      />
                      <div className="ml-7 text-sm text-theme-text-secondary">{renderClauseBody(c.text)}</div>
                    </div>
                  ))}
                  {renderedClauses.length === 0 && (
                    <p className="text-sm text-theme-text-muted">No active agreement configured.</p>
                  )}
                </div>
              </section>

              {createError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !allAcked}
                className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl py-3 transition-colors"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={18} />}
                {submitting ? 'Creating…' : 'Create side event'}
              </button>
              {!allAcked && renderedClauses.length > 0 && (
                <p className="text-xs text-theme-text-muted -mt-4">
                  Confirm every agreement condition above to enable creation.
                </p>
              )}
            </div>
          )}

          {created && (
            <div className="space-y-8">
              {/* Created confirmation */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
                  <CheckCircle size={18} /> Event created: {created.event.name}
                </div>
                <div className="text-sm text-theme-text-secondary flex flex-wrap items-center gap-3">
                  <Link to={created.hostPageUrl} className="inline-flex items-center gap-1 text-red-400 hover:underline">
                    Host dashboard <ExternalLink size={14} />
                  </Link>
                  <Link to={created.eventPageUrl} className="inline-flex items-center gap-1 text-red-400 hover:underline">
                    Event page (gated preview) <ExternalLink size={14} />
                  </Link>
                </div>
              </div>

              {/* Publish gates */}
              <section className="rounded-xl border border-theme-stroke bg-theme-surface p-4">
                <h2 className="text-lg font-bold mb-3">Publish</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    {publishStatus?.agreementVersionMatches
                      ? <CheckCircle size={16} className="text-emerald-400" />
                      : <AlertTriangle size={16} className="text-amber-500" />}
                    Host Agreement signed (current version)
                  </li>
                  <li className="flex items-center gap-2">
                    {publishStatus?.hasMerchAddress
                      ? <CheckCircle size={16} className="text-emerald-400" />
                      : <AlertTriangle size={16} className="text-amber-500" />}
                    Valid merch delivery address provided
                    {!publishStatus?.hasMerchAddress && (
                      <span className="text-theme-text-muted"> — add it in the host dashboard's kit/shipping section.</span>
                    )}
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={publishing || !publishStatus?.canPublish}
                  className="mt-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2.5 transition-colors"
                >
                  {publishing ? 'Publishing…' : 'Publish event (make public)'}
                </button>
                {!publishStatus?.canPublish && (
                  <p className="text-xs text-theme-text-muted mt-2">
                    Both gates must pass. Publishing is also enforced server-side.
                  </p>
                )}
              </section>

              {createError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
}
