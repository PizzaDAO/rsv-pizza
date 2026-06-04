import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, MapPin, Lock } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { IconInput } from '../IconInput';
import { FindVenueModal } from '../checklist/FindVenueModal';

/**
 * diavola-49271: GPP27 host dashboard — slice 1 (preview, flag-gated).
 *
 * Lives ALONGSIDE the existing GPPDashboardTab and is only rendered when the
 * `?dash=gpp27` opt-in flag is active (see HostPage.tsx). The live 2026
 * dashboard is untouched.
 *
 * Slice 1 feature: a guided flow where the host must enter a TARGET attendance
 * number before the venue picker unlocks, and the venue step shows size-tier
 * guidance based on that number. Target attendance is held in LOCAL state only
 * (DB persistence is a later slice).
 */
export const GPP27DashboardTab: React.FC = () => {
  const { t } = useTranslation('host');
  const { party } = usePizza();

  // Local-only target attendance. Seeded from the party's estimate as a
  // sensible default, but never persisted in this slice.
  const [targetAttendance, setTargetAttendance] = useState<number | null>(null);
  const [findVenueOpen, setFindVenueOpen] = useState(false);

  // Seed the local target from the existing estimate once on mount / when the
  // party id changes. Purely a default — edits stay local.
  useEffect(() => {
    setTargetAttendance(party?.estimatedAttendance ?? null);
  }, [party?.id, party?.estimatedAttendance]);

  if (!party) return null;

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
          onChange={(e) => {
            const raw = e.target.value;
            setTargetAttendance(raw === '' ? null : Number(raw));
          }}
        />
        <p className="text-xs text-theme-text-muted mt-2">
          {t('gpp27.targetHelper')}
        </p>
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

      <FindVenueModal
        open={findVenueOpen}
        onClose={() => setFindVenueOpen(false)}
      />
    </div>
  );
};
