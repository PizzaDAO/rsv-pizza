import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import {
  Shield, ShieldCheck, Loader2, MapPin, User, Mail, Send, DollarSign,
  Pizza, CheckCircle, ExternalLink, AlertTriangle, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { GPPClouds } from '../components/GPPClouds';
import { IconInput } from '../components/IconInput';
import { Checkbox } from '../components/Checkbox';
import { LocationAutocomplete, CityData } from '../components/LocationAutocomplete';
import {
  fetchAdminMe, fetchUnderbossMe,
  createGpp27Event, fetchGpp27BudgetSuggestion,
  fetchGpp27Agreement,
  fetchGpp27PublishStatus, publishGpp27Event,
  type Gpp27CreateEventResponse, type Gpp27BudgetSuggestion,
  type Gpp27AgreementClause, type Gpp27PublishStatus,
} from '../lib/api';

const themeClass = 'gpp-theme';
const backgroundStyle = { background: 'linear-gradient(180deg, #7EC8E3 0%, #B6E4F7 100%)' } as React.CSSProperties;

// Canonical merged timeline copy — kept identical to agreement clause 2.
const TIMELINE_COPY =
  'Reimbursement typically takes ~7 days after you submit your receipt + photos; up to 2 weeks after May 22 to be fully processed.';

// White text on the colored GPP callouts must dodge the `.gpp-theme .text-white`
// override (index.css) — use the arbitrary-value class text-[#ffffff].
const WHITE = 'text-[#ffffff]';

// --- Agreement clause body rendering (polenta-58540) -----------------------
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

export function GPP27CreatePage() {
  // --- All hooks declared ABOVE any conditional return (rules-of-hooks). ---
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Create form. tortellini-58539: a 2-step wizard — step 1 collects details,
  // step 2 reviews budget + confirms the agreement, and ONLY the step-2 confirm
  // persists the party. `step` toggles 1 | 2 (no router change).
  const [step, setStep] = useState<1 | 2>(1);
  const [city, setCity] = useState('');
  const [hostName, setHostName] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [timezone, setTimezone] = useState<string | null>(null);
  const [cityData, setCityData] = useState<CityData | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<Gpp27CreateEventResponse | null>(null);

  // Budget (pre-fetched in step 1, reviewed/edited in step 2 before create)
  const [budget, setBudget] = useState<Gpp27BudgetSuggestion | null>(null);
  const [capInput, setCapInput] = useState<string>('');

  // Agreement (pre-fetched in step 1, confirmed in step 2 before create)
  const [agreementVersion, setAgreementVersion] = useState<string | null>(null);
  const [clauses, setClauses] = useState<Gpp27AgreementClause[]>([]);
  const [acked, setAcked] = useState<Record<string, boolean>>({});

  // Publish gates
  const [publishStatus, setPublishStatus] = useState<Gpp27PublishStatus | null>(null);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    document.body.classList.add('gpp-theme-active');
    return () => { document.body.classList.remove('gpp-theme-active'); };
  }, []);

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

  // The per-head tier amount for the created city (for {tier amount} interpolation).
  const tierAmount = budget ? budget.perHeadRate : null;

  // Interpolate `{tier amount}` into clause bodies from the city's tier rate.
  const renderedClauses = useMemo(() => {
    return clauses.map((c) => ({
      ...c,
      text: tierAmount != null
        ? c.body.replace(/\{tier amount\}/g, `$${tierAmount}`)
        : c.body.replace(/\{tier amount\}/g, 'the per-person rate for your city'),
    }));
  }, [clauses, tierAmount]);

  const allAcked = renderedClauses.length > 0 && renderedClauses.every((c) => acked[c.id]);

  // Step 1 → 2: validate the details, then fetch the budget suggestion +
  // agreement clauses (NO party row exists yet — budget-suggestion takes only a
  // city, agreement is auth-scoped). Nothing is persisted here.
  async function handleProceedToReview(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!city.trim() || !hostName.trim() || !email.trim() || !telegram.trim()) {
      setCreateError('City, host name, email, and Telegram are required.');
      return;
    }
    setLoadingReview(true);
    try {
      const [b, a] = await Promise.all([
        fetchGpp27BudgetSuggestion(city.trim()),
        fetchGpp27Agreement(),
      ]);
      setBudget(b);
      setCapInput(String(b.suggestedCapUsd));
      setAgreementVersion(a.version);
      setClauses(a.clauses);
      setAcked({});
      setStep(2);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to load the budget + agreement. Please try again.');
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
      const resp = await createGpp27Event({
        city: city.trim(),
        hostName: hostName.trim(),
        email: email.trim(),
        telegram: telegram.trim(),
        timezone: timezone || undefined,
        reimbursementCapUsd: Number(capInput) || 0,
        agreementVersion,
        acceptedClauseIds: Object.keys(acked).filter((id) => acked[id]),
        ...(cityData && {
          country: cityData.country,
          countryCode: cityData.countryCode,
          cityFormattedName: cityData.formattedName,
          cityLat: cityData.lat,
          cityLng: cityData.lng,
        }),
      });
      setCreated(resp);

      // Load publish status for the freshly-created party.
      const ps = await fetchGpp27PublishStatus(resp.event.id).catch(() => null);
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
      await publishGpp27Event(created.event.id);
      const ps = await fetchGpp27PublishStatus(created.event.id);
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
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!authorized || authError) {
    return (
      <div className={`min-h-screen ${themeClass}`} style={backgroundStyle}>
        <Header />
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <Shield size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {authError || 'The GPP27 create flow is limited to admins and underbosses.'}
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const capValue = Number(capInput);
  const capPending = budget == null || !(Number.isFinite(capValue) && capValue > 0);

  return (
    <div className={`min-h-screen ${themeClass} relative overflow-hidden`} style={backgroundStyle}>
      <GPPClouds />
      <Helmet><title>Create GPP 2027 | RSV.Pizza</title></Helmet>
      <Header />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(240, 240, 240, 0.95)' }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
              <ShieldCheck size={20} className="text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Create a 2027 Global Pizza Party</h1>
              <p className="text-sm text-theme-text-muted">
                Admin / underboss only. New 2027 events are hidden from the public until you publish them.
              </p>
            </div>
          </div>

          {/* Step 1 — Details */}
          {!created && step === 1 && (
            <form onSubmit={handleProceedToReview} className="space-y-4">
              <LocationAutocomplete
                value={city}
                onChange={(v) => { setCity(v); setCityData(null); setTimezone(null); }}
                onTimezoneChange={setTimezone}
                onCitySelected={(d) => { setCityData(d); setCity(d.cityName); }}
                placeholder="City (start typing, then pick from the list)"
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

              {createError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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

          {/* Step 2 — Review budget + confirm the agreement (nothing persisted yet) */}
          {!created && step === 2 && (
            <div className="space-y-8">
              <button
                type="button"
                onClick={() => { setStep(1); setCreateError(null); }}
                className="inline-flex items-center gap-1 text-sm text-red-600 hover:underline"
              >
                <ArrowLeft size={14} /> Back to details
              </button>

              <div className="text-sm text-gray-700">
                Creating <strong>Global Pizza Party {city.trim()}</strong> for{' '}
                <strong>{hostName.trim()}</strong> ({email.trim()}).
              </div>

              {/* pizza-only + reimbursement-model host messaging */}
              <section className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #E52828 0%, #CC2020 100%)' }}>
                <div className={`flex items-center gap-2 font-bold text-lg ${WHITE}`}>
                  <Pizza size={20} /> We reimburse pizza only
                </div>
                <p className={`mt-2 text-sm ${WHITE} opacity-95`}>
                  This is a <strong>reimbursement model</strong>: the host pays for pizza first, then
                  PizzaDAO reimburses the pizza cost — it is not an upfront grant, and only pizza is covered.
                </p>
                <p className={`mt-3 text-sm ${WHITE}`}>
                  {capPending ? (
                    <>The approved amount is <strong>pending</strong>. You can still create the event —
                    the pizza reimbursement budget can be confirmed shortly.</>
                  ) : (
                    <>Approved to spend up to <strong>${capValue}</strong> on pizza
                    (max ${budget?.ceilingUsd ?? 625} per event).</>
                  )}
                </p>
                <p className={`mt-3 text-xs ${WHITE} opacity-90`}>{TIMELINE_COPY}</p>
              </section>

              {/* budget approval — transparent inputs + editable cap */}
              <section>
                <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
                  <DollarSign size={18} /> Budget approval
                </h2>
                {budget ? (
                  <div className="rounded-xl border border-theme-stroke bg-white p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
                      <div>Last year (2026) attendance</div>
                      <div className="text-right font-medium">{budget.lastYearEstimatedAttendance ?? '—'}</div>
                      <div>Current RSVPs</div>
                      <div className="text-right font-medium">{budget.currentRsvpCount}</div>
                      <div>City tier</div>
                      <div className="text-right font-medium">Tier {budget.tier} (${budget.perHeadRate}/person)</div>
                      <div>Expected attendance</div>
                      <div className="text-right font-medium">{budget.expectedAttendance}</div>
                      <div>Suggested cap</div>
                      <div className="text-right font-medium">
                        ${budget.suggestedCapUsd}
                        {budget.rawSuggestedCapUsd > budget.ceilingUsd && (
                          <span className="text-amber-600"> (clamped to ${budget.ceilingUsd})</span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Formula: tier rate × max(last-year attendance, 0.40 × current RSVPs), clamped to ${budget.ceilingUsd}.
                      {budget.lastYearEstimatedAttendance == null && ' New city — no 2026 event, so the suggestion starts at $0. Enter an amount manually.'}
                    </p>
                    <IconInput
                      icon={DollarSign}
                      type="number"
                      min={0}
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      placeholder="Approved reimbursement cap (USD)"
                    />
                    {capValue > (budget.ceilingUsd ?? 625) && (
                      <p className="text-xs text-amber-700">
                        Amounts above ${budget.ceilingUsd} will be clamped to ${budget.ceilingUsd} on save.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Budget suggestion unavailable.</p>
                )}
              </section>

              {/* City Host Agreement (data-driven) — must be confirmed before create */}
              <section>
                <h2 className="text-lg font-bold mb-1">City Host Agreement</h2>
                <p className="text-sm text-gray-600 mb-3">
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
                        labelClassName="text-base font-semibold text-gray-900"
                      />
                      <div className="ml-7 text-sm text-gray-800">{renderClauseBody(c.text)}</div>
                    </div>
                  ))}
                  {renderedClauses.length === 0 && (
                    <p className="text-sm text-gray-500">No active agreement configured.</p>
                  )}
                </div>
              </section>

              {createError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
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
                {submitting ? 'Creating…' : 'Create 2027 event'}
              </button>
              {!allAcked && renderedClauses.length > 0 && (
                <p className="text-xs text-gray-500 -mt-4">
                  Confirm every City Host Agreement condition above to enable creation.
                </p>
              )}
            </div>
          )}

          {created && (
            <div className="space-y-8">
              {/* Created confirmation */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 text-emerald-700 font-semibold mb-1">
                  <CheckCircle size={18} /> Event created: {created.event.name}
                </div>
                <div className="text-sm text-gray-700 flex flex-wrap items-center gap-3">
                  <Link to={created.hostPageUrl} className="inline-flex items-center gap-1 text-red-600 hover:underline">
                    Host dashboard <ExternalLink size={14} />
                  </Link>
                  <Link to={created.eventPageUrl} className="inline-flex items-center gap-1 text-red-600 hover:underline">
                    Event page (gated preview) <ExternalLink size={14} />
                  </Link>
                </div>
              </div>

              {/* Publish gates */}
              <section className="rounded-xl border border-theme-stroke bg-white p-4">
                <h2 className="text-lg font-bold mb-3">Publish</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    {publishStatus?.agreementVersionMatches
                      ? <CheckCircle size={16} className="text-emerald-600" />
                      : <AlertTriangle size={16} className="text-amber-500" />}
                    City Host Agreement signed (current version)
                  </li>
                  <li className="flex items-center gap-2">
                    {publishStatus?.hasMerchAddress
                      ? <CheckCircle size={16} className="text-emerald-600" />
                      : <AlertTriangle size={16} className="text-amber-500" />}
                    Valid merch delivery address provided
                    {!publishStatus?.hasMerchAddress && (
                      <span className="text-gray-500"> — add it in the host dashboard's kit/shipping section.</span>
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
                  <p className="text-xs text-gray-500 mt-2">
                    Both gates must pass. Publishing is also enforced server-side.
                  </p>
                )}
              </section>

              {createError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {createError}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
