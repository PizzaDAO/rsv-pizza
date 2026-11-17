import React, { useCallback, useEffect, useState } from 'react';
import { History as HistoryIcon, Loader2, RotateCcw, X } from 'lucide-react';
import {
  fetchBrandHistory, revertBrandSettings, describeApiError,
  type BrandHistoryRow, type BrandSettings,
} from '../../lib/brandAdminApi';

const FIELD_LABELS: Record<string, string> = {
  brandName: 'Brand name', displayName: 'Display name', tagline: 'Tagline', metaDescription: 'Meta description',
  supportEmail: 'Support email', description: 'Series description', nameTemplate: 'Event name template',
  hideGuests: 'Hide guest lists', photosEnabled: 'Photos enabled', photosPublic: 'Photos public',
  eventDate: 'Event date', eventStartTime: 'Start time', eventEndTime: 'End time',
  emailFromName: 'Email sender name', emailReplyTo: 'Reply-to email', themeTokens: 'Theme',
  logoUrl: 'Logo', logoLightUrl: 'Logo for light backgrounds', faviconUrl: 'Favicon', ogImageUrl: 'Social share image',
  flyerArt: 'Flyer art',
};
/** Fields whose raw value is never printed (objects, and image URLs which have no revert). */
const SUMMARY_ONLY = new Set(['themeTokens', 'flyerArt', 'logoUrl', 'logoLightUrl', 'faviconUrl', 'ogImageUrl']);

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  if (typeof v === 'number') return String(v);
  return 'updated';
}

/** One readable line per changed field. Objects (theme, flyer art) and image URLs are only named. */
export function summarizeChanges(changes: BrandHistoryRow['changes']): string[] {
  const out: string[] = [];
  for (const [k, c] of Object.entries(changes)) {
    const label = FIELD_LABELS[k];
    if (!label) continue; // e.g. revertedAuditId bookkeeping
    if (SUMMARY_ONLY.has(k)) {
      const gone = c?.new === null || c?.new === undefined;
      out.push(k === 'themeTokens' ? (gone ? 'Theme reset to the default' : 'Theme changed') : gone ? `${label} removed` : `${label} changed`);
    } else {
      out.push(`${label}: ${show(c?.old)} → ${show(c?.new)}`);
    }
  }
  return out;
}

const ACTION_LABEL: Record<string, string> = {
  'settings.update': 'Settings changed',
  revert: 'Reverted a change',
  'asset.update': 'Image uploaded',
  'asset.remove': 'Image removed',
};

interface Props {
  seriesId: string;
  onReverted: (s: BrandSettings) => void;
}

export const HistoryPanel: React.FC<Props> = ({ seriesId, onReverted }) => {
  const [rows, setRows] = useState<BrandHistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<BrandHistoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setRows((await fetchBrandHistory(seriesId)).history);
    } catch (e) {
      setLoadError(describeApiError(e));
    }
  }, [seriesId]);
  useEffect(() => { setRows(null); void load(); }, [load]);

  const revert = async () => {
    if (!target) return;
    setBusy(true);
    setModalError(null);
    try {
      const res = await revertBrandSettings(seriesId, target.id);
      onReverted(res.settings);
      setTarget(null);
      setMessage(res.changed.length ? 'Reverted. Your site picks it up within about a minute.' : 'Already matches that earlier state, so nothing changed.');
      await load();
    } catch (e) {
      setModalError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#E52828]" role="alert">{loadError}</p>
        <button type="button" className="btn-secondary text-sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!rows) return <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading history…</div>;

  return (
    <div className="space-y-4" data-testid="history-panel">
      <p className="text-sm text-theme-text-muted">
        The latest changes to your brand settings. You can go back to how a setting looked before any settings change.
        Image uploads and removals are listed but can't be reverted here.
      </p>
      {message && <p className="text-sm text-theme-text-muted" role="status">{message}</p>}
      <ul className="space-y-2">
        {rows.map((r) => {
          const lines = summarizeChanges(r.changes);
          const revertible = r.action === 'settings.update';
          return (
            <li key={r.id} className="px-3 py-3 rounded-lg bg-theme-surface space-y-1" data-testid="history-row" data-action={r.action}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-theme-text">{ACTION_LABEL[r.action] ?? 'Change'}</div>
                  <div className="text-xs text-theme-text-muted break-words">{new Date(r.createdAt).toLocaleString()} · {r.actorEmail}</div>
                </div>
                {revertible && (
                  <button type="button" className="btn-secondary text-xs !px-3 !py-2 inline-flex items-center gap-1 shrink-0" onClick={() => { setModalError(null); setTarget(r); }}>
                    <RotateCcw size={13} />Revert
                  </button>
                )}
              </div>
              <ul className="text-xs text-theme-text-secondary space-y-0.5 break-words">
                {lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="flex items-center gap-2 text-sm text-theme-text-muted"><HistoryIcon size={16} />No changes yet.</li>
        )}
      </ul>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setTarget(null)} data-testid="revert-modal">
          <div role="dialog" aria-modal="true" aria-label="Revert settings" className="card w-full max-w-md p-5 space-y-3 relative" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Close" className="absolute top-3 right-3 text-theme-text-muted hover:text-theme-text" disabled={busy} onClick={() => setTarget(null)}><X size={18} /></button>
            <h2 className="text-lg font-bold text-theme-text pr-6">Revert to before this change?</h2>
            <p className="text-sm text-theme-text-muted">
              Your settings go back to how they were before this change ({new Date(target.createdAt).toLocaleString()}). Anything changed since then
              in the same fields is replaced. Images are not affected.
            </p>
            <ul className="text-xs text-theme-text-secondary space-y-0.5 break-words">
              {summarizeChanges(target.changes).map((l) => <li key={l}>{l}</li>)}
            </ul>
            {modalError && <p className="text-sm text-[#E52828]" role="alert">{modalError}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={busy} onClick={revert}>{busy ? 'Reverting…' : 'Revert'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
