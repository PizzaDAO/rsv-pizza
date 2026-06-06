import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users,
  MapPin,
  Lock,
  Loader2,
  CheckCircle,
  Circle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';
import { IconInput } from '../IconInput';
import { FindVenueModal } from '../checklist/FindVenueModal';
import { Gpp27StatusPanel } from './Gpp27StatusPanel';
import {
  GPP27_STEPS,
  stepUnlocked,
  manualDoneKey,
  type Gpp27Step,
  type Gpp27StepCtx,
} from './gpp27Steps';

/**
 * diavola-49271: GPP27 host dashboard — slice 3 (preview, flag-gated).
 *
 * Lives ALONGSIDE the existing GPPDashboardTab and is only rendered when the
 * `?dash=gpp27` opt-in flag is active (see HostPage.tsx). The live 2026
 * dashboard is untouched.
 *
 * Slice 1: guided flow where the host enters a TARGET attendance before the
 *   venue picker unlocks; venue step shows size-tier guidance.
 * Slice 2: persistence of target attendance + an "Expected attendance" section
 *   (live RSVP count with a host override), shown within ~2 weeks of the event.
 * Slice 3 (this): wraps the above into a full guided, ordered, dependency-aware
 *   checklist driven by the frontend-defined `gpp27Steps` config, plus a
 *   prominent "Next Up" call-to-action card. Manual steps (no derivable signal)
 *   are host-toggled and persisted in localStorage — frontend-only by design.
 */
export const GPP27DashboardTab: React.FC = () => {
  const { t } = useTranslation('host');
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party, guests, mergeParty } = usePizza();

  // Local target attendance, seeded from the persisted target (falling back to
  // the existing estimate). Committed to the DB on blur.
  const [targetAttendance, setTargetAttendance] = useState<number | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);
  const [findVenueOpen, setFindVenueOpen] = useState(false);

  // Local expected-override input + save state.
  const [expectedInput, setExpectedInput] = useState('');
  const [savingExpected, setSavingExpected] = useState(false);

  // Manual step completion (localStorage-backed). Keyed by step id; seeded from
  // localStorage on party change. `manualVersion` bumps to force re-derivation.
  const [manualDone, setManualDone] = useState<Record<string, boolean>>({});

  // Ref to the target input so the `target` step's action can focus/scroll it.
  const targetInputRef = useRef<HTMLDivElement | null>(null);

  // Seed the local target from the persisted value (falling back to the
  // existing estimate) on mount / when the party changes.
  useEffect(() => {
    setTargetAttendance(party?.targetAttendance ?? party?.estimatedAttendance ?? null);
  }, [party?.id, party?.targetAttendance, party?.estimatedAttendance]);

  // Seed the expected-override input from the persisted override.
  useEffect(() => {
    setExpectedInput(party?.expectedAttendance != null ? String(party.expectedAttendance) : '');
  }, [party?.id, party?.expectedAttendance]);

  // Seed manual completion flags from localStorage when the party changes.
  useEffect(() => {
    if (!party?.id) {
      setManualDone({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const step of GPP27_STEPS) {
      if (!step.manual) continue;
      try {
        next[step.id] = localStorage.getItem(manualDoneKey(party.id, step.id)) === '1';
      } catch {
        next[step.id] = false;
      }
    }
    setManualDone(next);
  }, [party?.id]);

  // Days until the event — mirrors GPPDashboardTab's computation.
  const daysUntil = useMemo(() => {
    if (!party?.date) return null;
    const eventDate = new Date(party.date.slice(0, 10) + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = eventDate.getTime() - today.getTime();
    if (diff < 0) return null;
    return Math.round(diff / (1000 * 60 * 60 * 24));
  }, [party?.date]);

  const toggleManual = useCallback(
    (stepId: string) => {
      if (!party?.id) return;
      setManualDone((prev) => {
        const nextVal = !prev[stepId];
        try {
          if (nextVal) {
            localStorage.setItem(manualDoneKey(party.id, stepId), '1');
          } else {
            localStorage.removeItem(manualDoneKey(party.id, stepId));
          }
        } catch {
          /* localStorage unavailable — keep in-memory state only */
        }
        return { ...prev, [stepId]: nextVal };
      });
    },
    [party?.id],
  );

  const goToTab = useCallback(
    (tab: string) => {
      if (!inviteCode) return;
      if (tab === 'details') {
        navigate(`/host/${inviteCode}`);
      } else {
        navigate(`/host/${inviteCode}/${tab}`);
      }
    },
    [inviteCode, navigate],
  );

  const focusTarget = useCallback(() => {
    const node = targetInputRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = node.querySelector('input');
    if (input) input.focus();
  }, []);

  // Per-step click action. `manual` steps fall back to a toggle (handled in the
  // checklist row), but partners/budget also navigate to their tab.
  const runStepAction = useCallback(
    (step: Gpp27Step) => {
      switch (step.id) {
        case 'createEvent':
          goToTab('details');
          break;
        case 'target':
          focusTarget();
          break;
        case 'venue':
          setFindVenueOpen(true);
          break;
        case 'team':
          // Host team UI lives on the dashboard (HostsManager) in the 2026
          // dashboard; the standalone team surface here is the Settings tab.
          goToTab('details');
          break;
        case 'partners':
          goToTab('partners');
          break;
        case 'pizzeria':
          goToTab('apps');
          break;
        case 'budget':
          goToTab('budget');
          break;
        case 'funding':
          goToTab('payments');
          break;
        case 'socials':
          goToTab('promo');
          break;
        case 'throwParty':
          // No tab — purely a manual checkpoint.
          break;
        default:
          break;
      }
    },
    [goToTab, focusTarget],
  );

  if (!party) return null;

  const partyId = party.id;

  const commitTarget = async () => {
    const num =
      targetAttendance == null || !Number.isFinite(targetAttendance) || targetAttendance < 0
        ? null
        : Math.round(targetAttendance);
    // Skip the write if nothing changed.
    if ((party.targetAttendance ?? null) === num) return;
    setSavingTarget(true);
    setTargetSaved(false);
    const success = await updateParty(partyId, { target_attendance: num });
    setSavingTarget(false);
    if (success) {
      mergeParty({ targetAttendance: num });
      setTargetSaved(true);
    }
  };

  const venueUnlocked = targetAttendance != null && targetAttendance >= 0;

  // Tier guidance keyed off the target attendance.
  const guidanceKey =
    targetAttendance == null
      ? null
      : targetAttendance < 25
        ? 'gpp27.venueGuidanceSmall'
        : targetAttendance <= 60
          ? 'gpp27.venueGuidanceMedium'
          : 'gpp27.venueGuidanceLarge';

  const savedVenue = party.venueName || party.address || null;

  // Live RSVP count — a simple heuristic the host can override. Can be refined
  // later to filter by guest status (e.g. confirmed/approved only).
  const rsvpCount = guests?.length ?? 0;
  const expectedOverridden = party.expectedAttendance != null;
  const effectiveExpected = party.expectedAttendance ?? rsvpCount;
  const showExpected = daysUntil != null && daysUntil <= 14;

  const saveExpectedOverride = async (num: number | null) => {
    setSavingExpected(true);
    const success = await updateParty(partyId, { expected_attendance: num });
    setSavingExpected(false);
    if (success) {
      mergeParty({ expectedAttendance: num });
    }
  };

  const commitExpected = async () => {
    const trimmed = expectedInput.trim();
    const num = trimmed === '' ? null : Number(trimmed);
    if (num !== null && (!Number.isFinite(num) || num < 0)) return;
    const normalized = num === null ? null : Math.round(num);
    if ((party.expectedAttendance ?? null) === normalized) return;
    await saveExpectedOverride(normalized);
  };

  const resetExpectedToAuto = async () => {
    setExpectedInput('');
    await saveExpectedOverride(null);
  };

  // ---- Derive step state -------------------------------------------------
  const ctx: Gpp27StepCtx = { party, guests: guests ?? [], manualDone };

  const stepStates = GPP27_STEPS.map((step) => {
    const done = step.isDone(ctx);
    const unlocked = stepUnlocked(step, ctx);
    return { step, done, unlocked };
  });

  const doneCount = stepStates.filter((s) => s.done).length;
  const totalCount = stepStates.length;
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // First not-done, unlocked step is the "Next Up" CTA.
  const nextUp = stepStates.find((s) => !s.done && s.unlocked) ?? null;

  // Label of a step id, for the "Complete X first" locked hint.
  const labelOf = (id: string) => {
    const s = GPP27_STEPS.find((x) => x.id === id);
    return s ? t(s.labelKey) : id;
  };

  // Best available headcount for attendance-driven coaching: prefer the host's
  // expected override, then the target. Used for the pizza-count math.
  const headcount = party.expectedAttendance ?? party.targetAttendance ?? null;

  // Resolve a step's coach one-liner. Dynamic steps interpolate attendance:
  //   - venue: the size-tier guidance (matches the venue section banner).
  //   - pizzeria: ~1 large pizza per 3 guests, from the best headcount.
  // Static steps just translate their coachKey.
  const coachOf = (step: Gpp27Step): string | null => {
    if (!step.coachKey) return null;
    if (step.dynamicCoach) {
      if (step.id === 'venue') {
        if (headcount == null) return t('gpp27.coach.venue');
        return headcount < 25
          ? t('gpp27.venueGuidanceSmall')
          : headcount <= 60
            ? t('gpp27.venueGuidanceMedium')
            : t('gpp27.venueGuidanceLarge');
      }
      if (step.id === 'pizzeria') {
        if (headcount == null) return t('gpp27.coach.pizzeria_generic');
        return t('gpp27.coach.pizzeria', { count: Math.ceil(headcount / 3) });
      }
    }
    return t(step.coachKey);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-theme-text">
          GPP27 &mdash; {t('gpp27.setupTitle')} (preview)
        </h2>
      </div>

      {/* Consolidated approval + funding status (slice 4). Single source for
          the approval state the 2026 dashboard scatters across tiles/callouts. */}
      <Gpp27StatusPanel party={party} />

      {/* Next Up card */}
      {nextUp ? (
        <div className="card p-6 border border-[#ff393a]/40 bg-[#ff393a]/5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} className="text-[#ff393a] shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[#ff393a]">
              {t('gpp27.nextUp.title')}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-theme-text mb-1">
            {t(nextUp.step.labelKey)}
          </h3>
          {coachOf(nextUp.step) && (
            <p className="text-sm text-theme-text-muted mb-4">
              {coachOf(nextUp.step)}
            </p>
          )}
          <button
            type="button"
            onClick={() =>
              nextUp.step.manual ? toggleManual(nextUp.step.id) : runStepAction(nextUp.step)
            }
            className="btn-primary inline-flex items-center gap-2"
          >
            {nextUp.step.manual ? t('gpp27.markDone') : t(nextUp.step.labelKey)}
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <div className="card p-6 border border-green-500/30 bg-green-500/5 flex items-center gap-3">
          <CheckCircle size={22} className="text-green-500 shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-theme-text">
              {t('gpp27.nextUp.title')}
            </h3>
            <p className="text-sm text-green-400">{t('gpp27.nextUp.allDone')}</p>
          </div>
        </div>
      )}

      {/* Guided checklist */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-theme-text">{t('gpp27.setupTitle')}</h3>
          <span className="text-sm text-theme-text-muted">
            {doneCount}/{totalCount}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-theme-surface-hover rounded-full mb-6 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progressPct}%`,
              background: progressPct === 100 ? '#22c55e' : '#ff393a',
            }}
          />
        </div>

        <div className="space-y-1">
          {stepStates.map(({ step, done, unlocked }) => {
            const Icon = step.icon;
            const locked = !done && !unlocked;
            const lockedHint =
              locked && step.prereqs?.length
                ? t('gpp27.locked', { step: labelOf(step.prereqs[0]) })
                : null;
            const rowClickable = !locked;
            const handleRow = () => {
              if (locked) return;
              if (step.manual) {
                toggleManual(step.id);
              } else {
                runStepAction(step);
              }
            };
            return (
              <div
                key={step.id}
                onClick={rowClickable ? handleRow : undefined}
                onKeyDown={
                  rowClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRow();
                        }
                      }
                    : undefined
                }
                role={rowClickable ? 'button' : undefined}
                tabIndex={rowClickable ? 0 : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left group ${
                  locked ? 'opacity-50' : 'hover:bg-theme-surface cursor-pointer'
                }`}
              >
                {/* Completion affordance */}
                {step.manual && !locked ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleManual(step.id);
                    }}
                    aria-label={done ? t('gpp27.markNotDone') : t('gpp27.markDone')}
                    className="shrink-0 hover:opacity-70 transition-opacity"
                  >
                    {done ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <Circle size={18} className="text-theme-text-faint" />
                    )}
                  </button>
                ) : done ? (
                  <CheckCircle size={18} className="text-green-500 shrink-0" />
                ) : locked ? (
                  <Lock size={18} className="text-theme-text-faint shrink-0" />
                ) : (
                  <Circle size={18} className="text-theme-text-faint shrink-0" />
                )}

                <Icon
                  size={16}
                  className={done ? 'text-theme-text-muted shrink-0' : 'text-theme-text-secondary shrink-0'}
                />
                <div className="min-w-0">
                  <span
                    className={`text-sm ${done ? 'text-theme-text-muted line-through' : 'text-theme-text'}`}
                  >
                    {t(step.labelKey)}
                  </span>
                  {/* slice 4: inline per-step coaching one-liner. Hidden once the
                      step is done (the strikethrough label is enough) and when
                      locked (the locked hint takes priority). */}
                  {!done && !locked && coachOf(step) && (
                    <p className="text-xs text-theme-text-muted mt-0.5">
                      {coachOf(step)}
                    </p>
                  )}
                </div>

                {lockedHint && (
                  <span className="text-xs text-theme-text-faint ml-2 inline-flex items-center gap-1">
                    <Lock size={11} className="shrink-0" />
                    {lockedHint}
                  </span>
                )}

                {!locked && (
                  <span className="ml-auto text-xs text-theme-text-faint group-hover:text-theme-text-muted transition-colors">
                    {step.manual ? (done ? t('gpp27.markNotDone') : t('gpp27.markDone')) : 'Go →'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Target attendance input — the `target` step focuses/scrolls here. */}
      <div ref={targetInputRef} className="card p-6">
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-theme-text-secondary shrink-0" />
          <h3 className="text-lg font-semibold text-theme-text">{t('gpp27.targetStepTitle')}</h3>
        </div>
        <IconInput
          icon={Users}
          type="number"
          min={0}
          inputMode="numeric"
          placeholder={t('gpp27.targetPlaceholder')}
          value={targetAttendance == null ? '' : targetAttendance}
          disabled={savingTarget}
          onChange={(e) => {
            const raw = e.target.value;
            setTargetSaved(false);
            setTargetAttendance(raw === '' ? null : Number(raw));
          }}
          onBlur={commitTarget}
        />
        <div className="flex items-center gap-2 mt-2">
          <p className="text-xs text-theme-text-muted">{t('gpp27.targetHelper')}</p>
          {savingTarget && <Loader2 size={12} className="animate-spin text-theme-text-muted" />}
          {targetSaved && !savingTarget && (
            <span className="text-xs text-emerald-400">{t('gpp27.targetSaved')}</span>
          )}
        </div>
      </div>

      {/* Venue tier guidance — surfaced once a target is set. */}
      <div className={`card p-6 ${venueUnlocked ? '' : 'opacity-60'}`}>
        <div className="flex items-center gap-2 mb-3">
          <MapPin size={18} className="text-theme-text-secondary shrink-0" />
          <h3 className="text-lg font-semibold text-theme-text">{t('gpp27.venueStepTitle')}</h3>
        </div>

        {!venueUnlocked ? (
          <div className="flex items-center gap-2 text-sm text-theme-text-muted">
            <Lock size={16} className="shrink-0" />
            <span>{t('gpp27.venueLockedHint')}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Tier guidance banner */}
            {guidanceKey && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-theme-surface border border-theme-stroke">
                <MapPin size={16} className="shrink-0 mt-0.5 text-theme-text-secondary" />
                <p className="text-sm text-theme-text">{t(guidanceKey)}</p>
              </div>
            )}

            {savedVenue ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-theme-text-muted">{t('gpp27.savedVenue')}</div>
                  <div className="text-sm font-medium text-theme-text">{savedVenue}</div>
                </div>
                <button type="button" onClick={() => setFindVenueOpen(true)} className="btn-secondary">
                  {t('gpp27.changeVenue')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setFindVenueOpen(true)} className="btn-primary">
                {t('gpp27.chooseVenue')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expected attendance — only within ~2 weeks of the event. */}
      {showExpected && (
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Users size={18} className="text-theme-text-secondary shrink-0" />
            <h3 className="text-lg font-semibold text-theme-text">
              {t('gpp27.expectedStepTitle')}
            </h3>
          </div>

          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-bold text-theme-text">{effectiveExpected}</span>
            <span className="text-xs text-theme-text-muted">
              {expectedOverridden ? t('gpp27.expectedOverridden') : t('gpp27.expectedAuto')}
            </span>
          </div>

          <IconInput
            icon={Users}
            type="number"
            min={0}
            inputMode="numeric"
            placeholder={t('gpp27.expectedPlaceholder')}
            value={expectedInput}
            disabled={savingExpected}
            onChange={(e) => setExpectedInput(e.target.value)}
            onBlur={commitExpected}
          />

          <div className="flex items-center gap-3 mt-2">
            <p className="text-xs text-theme-text-muted">{t('gpp27.expectedHelper')}</p>
            {savingExpected && (
              <Loader2 size={12} className="animate-spin text-theme-text-muted shrink-0" />
            )}
          </div>

          {expectedOverridden && (
            <button
              type="button"
              onClick={resetExpectedToAuto}
              disabled={savingExpected}
              className="btn-secondary mt-3"
            >
              {t('gpp27.expectedResetAuto')}
            </button>
          )}
        </div>
      )}

      <FindVenueModal open={findVenueOpen} onClose={() => setFindVenueOpen(false)} />
    </div>
  );
};
