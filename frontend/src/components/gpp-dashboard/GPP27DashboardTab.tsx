import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, MapPin, Lock, Loader2 } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { updateParty } from '../../lib/supabase';
import { IconInput } from '../IconInput';
import { FindVenueModal } from '../checklist/FindVenueModal';

/**
 * diavola-49271: GPP27 host dashboard — slice 2 (preview, flag-gated).
 *
 * Lives ALONGSIDE the existing GPPDashboardTab and is only rendered when the
 * `?dash=gpp27` opt-in flag is active (see HostPage.tsx). The live 2026
 * dashboard is untouched.
 *
 * Slice 1 feature: a guided flow where the host must enter a TARGET attendance
 * number before the venue picker unlocks, and the venue step shows size-tier
 * guidance based on that number.
 *
 * Slice 2 adds:
 *   - Persistence of the target attendance to `parties.target_attendance`.
 *   - An "Expected attendance" section, driven by the live RSVP count, with a
 *     host override persisted to `parties.expected_attendance` (null = auto).
 *     Only shown within ~2 weeks of the event.
 */
export const GPP27DashboardTab: React.FC = () => {
  const { t } = useTranslation('host');
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

  // Seed the local target from the persisted value (falling back to the
  // existing estimate) on mount / when the party changes.
  useEffect(() => {
    setTargetAttendance(party?.targetAttendance ?? party?.estimatedAttendance ?? null);
  }, [party?.id, party?.targetAttendance, party?.estimatedAttendance]);

  // Seed the expected-override input from the persisted override.
  useEffect(() => {
    setExpectedInput(party?.expectedAttendance != null ? String(party.expectedAttendance) : '');
  }, [party?.id, party?.expectedAttendance]);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-theme-text">
          GPP27 &mdash; {t('gpp27.setupTitle')} (preview)
        </h2>
      </div>

      {/* Step 1: Target attendance */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-theme-surface text-xs font-semibold text-theme-text">
            1
          </span>
          <h3 className="text-lg font-semibold text-theme-text">
            {t('gpp27.targetStepTitle')}
          </h3>
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
          <p className="text-xs text-theme-text-muted">
            {t('gpp27.targetHelper')}
          </p>
          {savingTarget && (
            <Loader2 size={12} className="animate-spin text-theme-text-muted" />
          )}
          {targetSaved && !savingTarget && (
            <span className="text-xs text-emerald-400">{t('gpp27.targetSaved')}</span>
          )}
        </div>
      </div>

      {/* Step 2: Venue — locked until a target is entered */}
      <div className={`card p-6 ${venueUnlocked ? '' : 'opacity-60'}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-theme-surface text-xs font-semibold text-theme-text">
            2
          </span>
          <h3 className="text-lg font-semibold text-theme-text">
            {t('gpp27.venueStepTitle')}
          </h3>
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
                  <div className="text-xs text-theme-text-muted">
                    {t('gpp27.savedVenue')}
                  </div>
                  <div className="text-sm font-medium text-theme-text">
                    {savedVenue}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFindVenueOpen(true)}
                  className="btn-secondary"
                >
                  {t('gpp27.changeVenue')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setFindVenueOpen(true)}
                className="btn-primary"
              >
                {t('gpp27.chooseVenue')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Step 3: Expected attendance — only within ~2 weeks of the event */}
      {showExpected && (
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-theme-surface text-xs font-semibold text-theme-text">
              3
            </span>
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

      <FindVenueModal
        open={findVenueOpen}
        onClose={() => setFindVenueOpen(false)}
      />
    </div>
  );
};
