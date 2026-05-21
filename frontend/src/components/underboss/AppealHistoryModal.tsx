import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { fetchReimbursementCapAppeals } from '../../lib/api';
import type { ReimbursementCapAppealRecord } from '../../types';

interface AppealHistoryModalProps {
  partyId: string;
  onClose: () => void;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * quattro-12847: Modal that lists the full history of reimbursement-cap
 * appeals on a single party (newest first), plus any underboss resolution
 * notes. Open from the underboss ReimbursementCapCell.
 */
export function AppealHistoryModal({ partyId, onClose }: AppealHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<ReimbursementCapAppealRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await fetchReimbursementCapAppeals(partyId);
        if (!cancelled) setAppeals(rows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load appeal history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-theme-card border border-theme-stroke rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-theme-text">Cap appeal history</h3>
            <p className="text-sm text-theme-text-muted mt-1">
              All host appeals of the reimbursement cap for this event.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-theme-text-faint hover:text-theme-text-secondary"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10 text-theme-text-muted">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">
            {error}
          </div>
        )}

        {!loading && !error && appeals.length === 0 && (
          <div className="text-center py-10 text-sm text-theme-text-muted">
            No appeals on this event yet.
          </div>
        )}

        {!loading && !error && appeals.length > 0 && (
          <ul className="space-y-3">
            {appeals.map((a) => {
              const reviewed = !!a.reviewedAt;
              return (
                <li
                  key={a.id}
                  className="rounded-lg border border-theme-stroke p-4 bg-theme-surface"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {reviewed ? (
                        <CheckCircle2 size={14} className="text-[#39d98a]" />
                      ) : (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
                      )}
                      <span className="text-xs text-theme-text-muted">
                        {formatTimestamp(a.createdAt)}
                      </span>
                    </div>
                    <span className="text-xs text-theme-text-faint">
                      {reviewed ? 'Reviewed' : 'Open'}
                    </span>
                  </div>
                  <div className="text-xs text-theme-text-muted mb-1">
                    From{' '}
                    <span className="text-theme-text">
                      {a.hostName || a.hostEmail || 'host'}
                    </span>
                    {a.hostName && a.hostEmail && (
                      <span className="text-theme-text-faint"> ({a.hostEmail})</span>
                    )}
                  </div>
                  <div className="text-sm text-theme-text whitespace-pre-wrap break-words">
                    {a.note}
                  </div>

                  {reviewed && (
                    <div className="mt-3 pt-3 border-t border-theme-stroke text-xs">
                      <div className="text-theme-text-muted">
                        Reviewed{a.reviewedAt ? ` ${formatTimestamp(a.reviewedAt)}` : ''}
                        {(a.reviewedByName || a.reviewedByEmail) && (
                          <>
                            {' '}by{' '}
                            <span className="text-theme-text">
                              {a.reviewedByName || a.reviewedByEmail}
                            </span>
                            {a.reviewedByName && a.reviewedByEmail && (
                              <span className="text-theme-text-faint"> ({a.reviewedByEmail})</span>
                            )}
                          </>
                        )}
                      </div>
                      {a.reviewedNote && (
                        <div className="mt-1 text-sm text-theme-text whitespace-pre-wrap break-words">
                          {a.reviewedNote}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
