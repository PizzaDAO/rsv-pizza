import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Trophy, Check, X as XIcon, RotateCcw } from 'lucide-react';
import {
  getUnderbossSuperlatives,
  markSuperlative,
  UnderbossSuperlativeGroup,
  UnderbossSuperlativeRow,
} from '../../lib/api';
import { ReceiptLightbox } from '../payments-shared/ReceiptLightbox';

/**
 * panzerotti-58931 Phase 2.1: admin "Best Of" judging queue. Mirrors the
 * FakeDetectionTable admin tab pattern. Submissions are grouped by superlative
 * key; each shows as a photo card. Clicking a card opens a ReceiptLightbox with
 * an editorPane holding Mark winner / Reject / Reset buttons.
 */

const STATUS_BADGE: Record<string, string> = {
  winner: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-white/10 text-theme-text-muted border-theme-stroke',
};

export function SuperlativesTab() {
  const [groups, setGroups] = useState<UnderbossSuperlativeGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local status overrides + per-row pending state, keyed by submission id.
  const [statusOverride, setStatusOverride] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  // Lightbox state: which group is open + which index within its submissions.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getUnderbossSuperlatives();
      setGroups(data.groups);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const effectiveStatus = useCallback(
    (row: UnderbossSuperlativeRow): string => statusOverride[row.id] ?? row.status,
    [statusOverride]
  );

  const runAction = useCallback(
    async (id: string, status: 'winner' | 'rejected' | 'pending') => {
      const prev = statusOverride[id];
      setPending((p) => ({ ...p, [id]: true }));
      setStatusOverride((s) => ({ ...s, [id]: status }));
      try {
        await markSuperlative(id, status);
      } catch {
        // Roll back the optimistic override on failure.
        setStatusOverride((s) => {
          const n = { ...s };
          if (prev !== undefined) n[id] = prev;
          else delete n[id];
          return n;
        });
      } finally {
        setPending((p) => ({ ...p, [id]: false }));
      }
    },
    [statusOverride]
  );

  const openGroup = useMemo(
    () => groups.find((g) => g.superlativeKey === openKey) || null,
    [groups, openKey]
  );

  const lightboxImages = useMemo(
    () =>
      (openGroup?.submissions || []).map((s) => ({
        url: s.photoUrl,
        fileName: `${s.guestName} — ${s.partyName}`,
      })),
    [openGroup]
  );

  const currentRow: UnderbossSuperlativeRow | null =
    openGroup && openGroup.submissions[openIndex] ? openGroup.submissions[openIndex] : null;

  const editorPane = currentRow ? (
    <div className="flex flex-col gap-4 p-5 text-gray-900">
      <div>
        <p className="text-lg font-bold">{currentRow.guestName}</p>
        <p className="text-sm text-gray-600">{currentRow.partyName}</p>
        <p className="text-sm text-gray-400">
          {[currentRow.city, currentRow.country].filter(Boolean).join(', ')}
        </p>
        {currentRow.numericValue !== null && (
          <p className="mt-1 text-sm text-gray-600">
            Value: <span className="font-semibold">{currentRow.numericValue}</span>
          </p>
        )}
      </div>

      <div>
        <span
          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            STATUS_BADGE[effectiveStatus(currentRow)] ?? STATUS_BADGE.pending
          }`}
        >
          {effectiveStatus(currentRow)}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          disabled={!!pending[currentRow.id]}
          onClick={() => runAction(currentRow.id, 'winner')}
          className="flex items-center justify-center gap-2 rounded-lg bg-yellow-500 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-yellow-400 disabled:opacity-50"
        >
          {pending[currentRow.id] ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trophy className="h-4 w-4" />
          )}
          Mark winner
        </button>
        <button
          disabled={!!pending[currentRow.id]}
          onClick={() => runAction(currentRow.id, 'rejected')}
          className="flex items-center justify-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
        >
          <XIcon className="h-4 w-4" />
          Reject
        </button>
        <button
          disabled={!!pending[currentRow.id]}
          onClick={() => runAction(currentRow.id, 'pending')}
          className="flex items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </div>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-red-400">{error}</p>;
  }

  if (groups.length === 0) {
    return <p className="py-8 text-center text-sm text-theme-text-muted">No Best Of submissions yet.</p>;
  }

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <div key={group.superlativeKey}>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-theme-text">
            <Trophy className="h-5 w-5 text-yellow-400" />
            {group.label}
            <span className="text-sm font-normal text-theme-text-muted">
              ({group.submissions.length})
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {group.submissions.map((s, idx) => {
              const status = effectiveStatus(s);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setOpenKey(group.superlativeKey);
                    setOpenIndex(idx);
                  }}
                  className="group relative overflow-hidden rounded-xl border border-theme-stroke bg-theme-surface text-left transition-colors hover:border-theme-text-muted"
                >
                  <div className="aspect-square w-full overflow-hidden bg-black/20">
                    <img
                      src={s.photoUrl}
                      alt={`${s.guestName} — ${group.label}`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                  {status === 'winner' && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-yellow-500 p-1 text-gray-900">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {status === 'rejected' && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-red-500 p-1 text-white">
                      <XIcon className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-theme-text">{s.guestName}</p>
                    <p className="truncate text-xs text-theme-text-muted">
                      {[s.city, s.country].filter(Boolean).join(', ') || s.partyName}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {openGroup && (
        <ReceiptLightbox
          isOpen
          images={lightboxImages}
          initialIndex={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenKey(null)}
          editorPane={editorPane}
        />
      )}
    </div>
  );
}
