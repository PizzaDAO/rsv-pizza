import React, { useEffect, useMemo, useState } from 'react';
import { Party, Guest } from '../../types';
import { useGuestsRealtime } from '../../hooks/useGuestsRealtime';
import * as db from '../../lib/supabase';
import { dbGuestToGuest } from '../../contexts/PizzaContext';
import { StatusHeader } from './StatusHeader';
import { CheckInPanel } from './CheckInPanel';
import { AnnouncePanel } from './AnnouncePanel';
import { AnnouncementHistory } from './AnnouncementHistory';
import { LogisticsCard } from './LogisticsCard';
import { PizzaStatusCard } from './PizzaStatusCard';
import { MusicNowPlayingCard } from './MusicNowPlayingCard';
import { ChecklistTodayCard } from './ChecklistTodayCard';
import { PhotoQuickCaptureCard } from './PhotoQuickCaptureCard';
import { BriefingCard } from './BriefingCard';
import { SignedPizzaBoxCard } from './SignedPizzaBoxCard';
import { PizzaBoxStackCard } from './PizzaBoxStackCard';
import { BroadcastJoinCard } from './BroadcastJoinCard';
import { StandWithCryptoCard } from './StandWithCryptoCard';

interface DayOfDashboardProps {
  party: Party;
  layout: 'desktop' | 'mobile';
}

/**
 * Day-of host dashboard — same component on both the desktop tab and the
 * /run/:inviteCode mobile route. Realtime guest subscription is host-only
 * (calabrese-58204).
 */
export const DayOfDashboard: React.FC<DayOfDashboardProps> = ({ party, layout }) => {
  // ---- HOOKS (all above any early return) -------------------------------
  const [guests, setGuests] = useState<Guest[]>(party.guests || []);
  const [annHistoryKey, setAnnHistoryKey] = useState(0);

  // Reload guests from server-of-record. Used after one-tap check-in or
  // walk-in capture, in addition to the realtime subscription.
  const refreshGuests = React.useCallback(async () => {
    const dbGuests = await db.getGuestsByPartyId(party.id);
    setGuests((dbGuests || []).map(dbGuestToGuest));
  }, [party.id]);

  useEffect(() => {
    refreshGuests();
  }, [refreshGuests]);

  useGuestsRealtime(party.id, setGuests);

  // Briefing window: between 50 and 90 minutes after event start.
  const briefingWindowActive = useMemo(() => {
    if (!party.date) return false;
    const start = new Date(party.date).getTime();
    const now = Date.now();
    return now >= start + 50 * 60_000 && now <= start + 90 * 60_000;
  }, [party.date]);

  const isGpp = party.eventType === 'gpp';

  // Mobile layout: stacked single-column with sticky bottom Walk-in/Announce
  // tabs. For v1 we keep it simple — same cards stacked, briefing on top in
  // the auto-promote window.
  const isMobile = layout === 'mobile';

  const briefingFirst = isGpp && briefingWindowActive;

  // genoa-44102: Two-column layout on desktop — important day-of actions on
  // the left, supporting/reference info on the right. Mobile stays single-
  // column stacked with the same left-then-right priority order.
  const leftColumn = (
    <>
      <PizzaStatusCard party={party} guests={guests} />
      {isGpp && <BroadcastJoinCard partyId={party.id} layout={layout} />}
      <CheckInPanel party={party} guests={guests} onGuestUpdated={refreshGuests} />
      <AnnouncePanel
        partyId={party.id}
        onSent={() => setAnnHistoryKey((k) => k + 1)}
      />
      {/* StandWithCryptoCard self-gates on party.eventTags containing 'swc' */}
      <StandWithCryptoCard party={party} />
    </>
  );

  const rightColumn = (
    <>
      <MusicNowPlayingCard
        partyId={party.id}
        inviteCode={party.inviteCode}
        hideOpenTabLink={isMobile}
      />
      {isGpp && !briefingFirst && <BriefingCard party={party} />}
      <ChecklistTodayCard
        partyId={party.id}
        inviteCode={party.inviteCode}
        hideOpenTabLink={isMobile}
      />
      <PhotoQuickCaptureCard party={party} />
      {isGpp && <SignedPizzaBoxCard party={party} />}
      {isGpp && <PizzaBoxStackCard party={party} />}
      <AnnouncementHistory partyId={party.id} refreshKey={annHistoryKey} />
      <LogisticsCard party={party} />
    </>
  );

  return (
    <div
      className={
        isMobile
          ? 'space-y-4 pb-8'
          : 'grid grid-cols-1 lg:grid-cols-2 gap-4'
      }
    >
      {briefingFirst && (
        <div className={isMobile ? '' : 'lg:col-span-2'}>
          <BriefingCard party={party} highlighted />
        </div>
      )}

      {/* StatusHeader pulse first — countdown + checked-in is the live signal. */}
      <div className={isMobile ? '' : 'lg:col-span-2'}>
        <StatusHeader party={party} guests={guests} />
      </div>

      {isMobile ? (
        <>
          {leftColumn}
          {rightColumn}
        </>
      ) : (
        <>
          <div className="space-y-4">{leftColumn}</div>
          <div className="space-y-4">{rightColumn}</div>
        </>
      )}
    </div>
  );
};
