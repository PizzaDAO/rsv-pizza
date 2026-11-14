import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Check, ExternalLink } from 'lucide-react';
import { usePizza } from '../../contexts/PizzaContext';
import { updateUnderbossStatus, listPayouts } from '../../lib/api';
import { Payout } from '../../types';
import { HostResources } from './HostResources';
import { HostChecklistCard } from '../checklist/HostChecklistCard';
import { hostTabPath } from '../checklist/checklistActions';
import { DashboardKPIs } from './DashboardKPIs';
import { PayoutStatusPill } from '../payments-shared/PayoutStatusPill';

export const GPPDashboardTab: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { party, guests, loadParty } = usePizza();
  const [saving, setSaving] = useState(false);
  // polpetta-49102: surface latest payouts on the dashboard so hosts don't
  // need to switch to the Payments tab to confirm a prepayment landed.
  const [recentPayouts, setRecentPayouts] = useState<Payout[]>([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);

  // polpetta-49102: load latest payouts for the Payments section. Newest-first
  // ordering comes from the backend; we slice the top 5 for the dashboard.
  useEffect(() => {
    if (!party?.id) return;
    let cancelled = false;
    setPayoutsLoading(true);
    listPayouts(party.id)
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...rows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setRecentPayouts(sorted.slice(0, 5));
        setPayoutsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRecentPayouts([]);
        setPayoutsLoading(false);
      });
    return () => { cancelled = true; };
  }, [party?.id]);

  const goToTab = (tab: string) => {
    if (inviteCode) navigate(hostTabPath(inviteCode, tab));
  };

  // Days until event
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

  return (
    <div className="space-y-6">
      {/* quattro-71244: gamified KPI block (LeaderboardPill + Milestone strip +
          ReportKPIs read-only with goals/deltas/pulse). Supersedes the legacy
          "Invited / RSVPs / Days Until / Pending Approval" 4-tile mini-grid. */}
      <DashboardKPIs party={party} guests={guests} />

      {/* Status tiles — kept separate from the KPI block because they're
          status callouts, not stats. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-theme-text">
            {daysUntil !== null ? daysUntil : '—'}
          </div>
          <div className="text-xs text-theme-text-muted">Days Until Event</div>
        </div>
        {party.underbossStatus === 'approved' && (
          <div className="card p-4 text-center border border-green-500/30">
            <div className="flex items-center justify-center gap-1.5 text-green-400">
              <Check size={20} />
              <span className="text-sm font-medium">Approved</span>
            </div>
            <div className="text-xs text-theme-text-muted mt-1">Event Status</div>
          </div>
        )}
        {/* arugula-38633 (cap-everywhere) / marzano-49102 (gate by 'go'):
            surface the effective reimbursement cap on the dashboard so hosts
            see it at a glance. The dollar value is hidden until the party has
            the 'go' event_tag — without 'go' the tile falls through to the
            "Under review" state. Clicking jumps to the Payments tab. */}
        {(() => {
          const hasGo = Array.isArray(party.eventTags) && party.eventTags.includes('go');
          const showCap = hasGo && party.effectiveReimbursementCapUsd != null;
          return (
            <button
              type="button"
              onClick={() => goToTab('payments')}
              className="card p-4 text-center hover:bg-theme-surface-hover transition-colors cursor-pointer"
              title={showCap
                ? 'Reimbursement cap — click to open the Payments tab'
                : 'Your underboss is reviewing your event — click to open the Payments tab'}
            >
              {showCap ? (
                <>
                  <div className="text-2xl font-bold text-theme-text">
                    ${Number(party.effectiveReimbursementCapUsd).toLocaleString()}
                  </div>
                  <div className="text-xs text-theme-text-muted">Reimbursement cap</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium text-amber-400">Under review</div>
                  <div className="text-xs text-theme-text-muted mt-1">Reimbursement cap</div>
                </>
              )}
            </button>
          );
        })()}
      </div>

      {/* Rejected status callout */}
      {party.underbossStatus === 'rejected' && (
        <div className="card p-6 border border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-theme-text mb-4">
            We can't support your event financially this year, but we're happy to list your event on the site!
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await updateUnderbossStatus(party.id, 'listed');
                  if (party?.inviteCode) await loadParty(party.inviteCode);
                } catch (err) {
                  console.error('Failed to update status:', err);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              List My Event Without Funding
            </button>
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  await updateUnderbossStatus(party.id, 'hidden');
                  if (party?.inviteCode) await loadParty(party.inviteCode);
                } catch (err) {
                  console.error('Failed to update status:', err);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="btn-secondary flex items-center gap-2"
            >
              Maybe Next Year
            </button>
          </div>
        </div>
      )}

      {/* Hidden status callout */}
      {party.underbossStatus === 'hidden' && (
        <div className="card p-6 border border-theme-stroke">
          <p className="text-sm text-theme-text-muted">
            Your event is currently not listed on the site.
          </p>
        </div>
      )}

      {/* Listed status callout */}
      {party.underbossStatus === 'listed' && (
        <div className="card p-6 border border-green-500/30 bg-green-500/5">
          <p className="text-sm text-green-400">
            Your event is listed as a Community event on the site. These are self funded events that will not be funded by PizzaDAO.
          </p>
        </div>
      )}

      {/* polpetta-49102: Payments section — latest 5 payouts surfaced on the
          dashboard so hosts can see prepayment / receipt state at a glance
          without switching to the Payments tab. Uses the same data source
          (GET /api/parties/:partyId/payouts, arugula-38633) and the shared
          PayoutStatusPill so colors stay in sync with the full tab. */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-lg font-semibold text-theme-text">Payments</h3>
          <button
            type="button"
            onClick={() => goToTab('payments')}
            className="text-xs text-theme-text-muted hover:text-theme-text transition-colors"
          >
            See all &rarr; Payments tab
          </button>
        </div>
        <p className="text-xs text-theme-text-muted mb-4">
          Latest receipts and prepayments for this event
        </p>

        {payoutsLoading ? (
          <div className="space-y-2">
            <div className="animate-pulse h-12 bg-theme-surface rounded-lg" />
            <div className="animate-pulse h-12 bg-theme-surface rounded-lg" />
            <div className="animate-pulse h-12 bg-theme-surface rounded-lg" />
          </div>
        ) : recentPayouts.length === 0 ? (
          <p className="text-sm text-theme-text-muted py-4">
            No payments yet. Submit a receipt or wait for a prepayment.
          </p>
        ) : (
          <div className="space-y-1">
            {recentPayouts.map((payout) => {
              const rel = relativeTime(new Date(payout.createdAt));
              const abs = new Date(payout.createdAt).toLocaleString();
              return (
                <div
                  key={payout.id}
                  onClick={() => goToTab('payments')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      goToTab('payments');
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-theme-surface transition-colors cursor-pointer"
                >
                  <PayoutStatusPill status={payout.status} />
                  <span className="text-sm font-medium text-theme-text">
                    ${Number(payout.finalAmountUsd).toFixed(2)}
                  </span>
                  <span
                    className="text-xs text-theme-text-muted"
                    title={abs}
                  >
                    {rel}
                  </span>
                  {payout.status === 'paid' && payout.transactionHash && (
                    <a
                      href={`https://basescan.org/tx/${payout.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto inline-flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text transition-colors"
                    >
                      view on Basescan
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Checklist progress (shared with brand-series dashboards) */}
      <HostChecklistCard variant="gpp" />

      {/* Host Resources */}
      <HostResources />
    </div>
  );
};

/**
 * polpetta-49102: small "x minutes / hours / days ago" formatter.
 * Mirrors the helper in PayoutRow.tsx (kept local to avoid widening a
 * shared module's surface for one consumer).
 */
function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
