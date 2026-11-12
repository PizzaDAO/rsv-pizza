import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  fetchHostTrustSettings,
  saveHostTrustSetting,
  type HostTrustAuditRow,
  type HostTrustSetting,
} from '../../lib/hostTrustApi';

const looser = (s: HostTrustSetting, to: number) =>
  s.stricterOnly && s.looserWhen != null && (s.looserWhen === 'higher' ? to > s.value : to < s.value);

/**
 * Super admin: host-trust settings (gates, score weights, the report switch).
 * Gates and weights are stricter-only: they can be tightened here, loosened back toward the shipped
 * default only with a note, and never past the default. Every change is audited.
 */
export const HostTrustSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<HostTrustSetting[] | null>(null);
  const [audit, setAudit] = useState<HostTrustAuditRow[]>([]);
  const [readFailed, setReadFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchHostTrustSettings();
      setSettings(r.settings);
      setAudit(r.audit);
      setReadFailed(r.readFailed);
      setDrafts({});
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not load host-trust settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const areas = useMemo(() => {
    const m = new Map<string, HostTrustSetting[]>();
    for (const s of settings ?? []) m.set(s.area, [...(m.get(s.area) ?? []), s]);
    return Array.from(m.entries());
  }, [settings]);

  if (!settings) {
    return <div className="card p-6 text-theme-text-muted">{message ?? 'Loading host-trust settings'}</div>;
  }

  const save = async (s: HostTrustSetting) => {
    const draft = drafts[s.key];
    if (draft === undefined || draft.trim() === '') return;
    setBusy(s.key);
    setMessage(null);
    try {
      await saveHostTrustSetting(s.key, Number(draft), notes[s.key]);
      setMessage(`Saved "${s.label}"`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-center gap-2">
        <ShieldCheck size={20} className="text-theme-accent" />
        <h2 className="text-lg font-semibold text-theme-text">Host trust settings</h2>
      </div>
      <p className="text-sm text-theme-text-secondary">
        These only drive the read-only Hosts report for now. Nothing here changes a budget, a payout or what hosts see.
        Gates and weights can only be tightened: loosening back toward the default needs a note, and nothing goes past the default.
      </p>
      {readFailed && (
        <p className="text-sm text-red-600">The settings could not be read; strict fallback values are shown. Do not save until this clears.</p>
      )}
      {message && <p className="text-sm text-theme-text">{message}</p>}

      {areas.map(([area, items]) => (
        <section key={area} className="space-y-3">
          <h3 className="font-medium text-theme-text">{area}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((s) => {
              const draft = drafts[s.key];
              const draftNum = draft === undefined || draft.trim() === '' ? null : Number(draft);
              const dirty = draftNum != null && draftNum !== s.value;
              const needsNote = dirty && draftNum != null && looser(s, draftNum);
              const unit = s.unit ? ` ${s.unit}` : '';
              return (
                <div key={s.key} className="rounded-xl border border-theme-stroke p-3 space-y-2">
                  <div className="text-sm font-medium text-theme-text">{s.label}</div>
                  <div className="text-xs text-theme-text-muted">{s.help}</div>
                  <div className="text-xs text-theme-text-muted">
                    Now {s.value}{unit} ({s.source}); default {s.default}{unit}; allowed {s.min} to {s.max}
                  </div>
                  <IconInput
                    type="number"
                    min={s.min}
                    max={s.max}
                    placeholder={`New value (${s.min} to ${s.max})`}
                    value={draft ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                  />
                  {needsNote && (
                    <IconInput
                      placeholder="Note (required to loosen)"
                      value={notes[s.key] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [s.key]: e.target.value })}
                    />
                  )}
                  <button
                    type="button"
                    disabled={!dirty || busy === s.key || readFailed || (needsNote && !(notes[s.key] ?? '').trim())}
                    onClick={() => void save(s)}
                    className="px-4 py-1.5 bg-[#E52828] text-white rounded-lg text-sm disabled:opacity-40"
                  >
                    {busy === s.key ? <Loader2 size={14} className="animate-spin inline" /> : 'Save'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h3 className="font-medium text-theme-text">Recent changes</h3>
        {audit.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No changes yet.</p>
        ) : (
          <ul className="text-xs text-theme-text-secondary space-y-1 max-h-60 overflow-auto">
            {audit.map((a, i) => (
              <li key={`${a.key}-${a.createdAt}-${i}`}>
                {new Date(a.createdAt).toLocaleString()} · {a.actorEmail} · {a.key.replace('host_trust.', '')}: {a.oldValue} to {a.newValue}
                {a.note ? ` (${a.note})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
