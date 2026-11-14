import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronDown, ChevronUp, Gavel, MessageSquare, MessageSquareHeart, PlayCircle, StopCircle, Hash } from 'lucide-react';
import { ErrorBanner, SectionCard, ChoicePills } from './shared';
import {
  hackathonJudgingHostApi as api,
  type HostHackathon,
  type LeaderboardResponse,
  type LeaderboardRow,
} from '../../lib/hackathonApi';

const POLL_MS = 60_000;

const fmt = (n: number | null) => (n === null ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(1));

function Row({ row, data }: { row: LeaderboardRow; data: LeaderboardResponse }) {
  const [open, setOpen] = useState(false);
  const p = data.projects[row.submissionId];
  if (!p) return null;
  const trackNames = data.tracks.filter((t) => p.trackIds.includes(t.id)).map((t) => t.name);
  return (
    <li className="py-3" data-testid="hackathon-leaderboard-row">
      <button type="button" className="w-full flex items-center gap-3 text-left min-h-[44px]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`w-10 shrink-0 text-center text-sm font-bold tabular-nums ${row.rank === 1 ? 'text-theme-accent' : 'text-theme-text-secondary'}`}>
          {row.rank === null ? '-' : `${row.tied ? '=' : ''}${row.rank}`}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-theme-text truncate">{p.name}</p>
          <p className="text-xs text-theme-text-muted truncate">
            {[p.teamName, p.tableNumber && `Table ${p.tableNumber}`, trackNames.join(', ')].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-theme-text tabular-nums">{fmt(row.average)}</p>
          <p className="text-xs text-theme-text-muted whitespace-nowrap">
            {row.scoreCount === 0 ? 'No scores' : `${row.scoreCount} score${row.scoreCount === 1 ? '' : 's'}`}
            {row.scoreCount > 1 && ` · ${fmt(row.min)}-${fmt(row.max)}`}
          </p>
        </div>
        {open ? <ChevronUp size={16} className="text-theme-text-muted shrink-0" /> : <ChevronDown size={16} className="text-theme-text-muted shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 sm:pl-12 space-y-3">
          {data.criteria.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {data.criteria.map((c) => (
                <div key={c.id} className="rounded-lg border border-theme-stroke bg-theme-surface px-3 py-2">
                  <p className="text-xs text-theme-text-muted truncate">{c.name}</p>
                  <p className="text-sm font-semibold text-theme-text tabular-nums">{fmt(row.criterionAverages[c.id] ?? null)}<span className="text-xs text-theme-text-muted font-normal"> / {c.maxScore}</span></p>
                </div>
              ))}
            </div>
          )}
          {p.scores.length === 0 ? (
            <p className="text-sm text-theme-text-muted">No judge has scored this project yet.</p>
          ) : (
            <ul className="space-y-2">
              {p.scores.map((s) => (
                <li key={s.judgeId} className={`rounded-xl border border-theme-stroke p-3 ${s.counted ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-theme-text min-w-0 break-words flex items-center gap-1.5">
                      <Gavel size={14} className="text-theme-text-muted shrink-0" /> {s.judgeName || s.judgeEmail || 'Judge'}
                      {!s.counted && <span className="text-xs text-theme-text-muted font-normal">(removed, not counted)</span>}
                    </p>
                    <p className="text-sm font-bold text-theme-text tabular-nums shrink-0">{fmt(s.total)}</p>
                  </div>
                  <p className="text-xs text-theme-text-muted mt-1 break-words">
                    {data.criteria.map((c) => `${c.name} ${s.criterionScores[c.id] ?? '-'}/${c.maxScore}`).join(' · ')}
                  </p>
                  {s.privateComment && (
                    <p className="text-sm text-theme-text-secondary mt-2 flex items-start gap-1.5 break-words whitespace-pre-wrap"><MessageSquare size={14} className="mt-0.5 shrink-0" /> {s.privateComment}</p>
                  )}
                  {s.teamFeedback && (
                    <p className="text-sm text-theme-text-secondary mt-1 flex items-start gap-1.5 break-words whitespace-pre-wrap" title="Shown to the team after results are revealed">
                      <MessageSquareHeart size={14} className="mt-0.5 shrink-0" /> {s.teamFeedback}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Host leaderboard (plans/hackathon-platform.md §8, PR 4): overall / per track, judge progress. */
export function LeaderboardSection({ partyId, hackathon, onJudgingChanged }: {
  partyId: string;
  hackathon: HostHackathon;
  onJudgingChanged: (h: HostHackathon) => void;
}) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string>('overall');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.leaderboard(partyId));
    } catch (e: any) {
      setError(e?.message || 'Could not load the leaderboard');
    }
  }, [partyId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (view === 'overall') return data.overall;
    return data.byTrack.find((t) => t.trackId === view)?.rows ?? [];
  }, [data, view]);

  const status = hackathon.judgingStatus;
  const toggle = async () => {
    const next = status === 'open' ? 'closed' : 'open';
    if (next === 'closed' && !confirm('Close judging? Judges will no longer be able to change their scores. You can reopen it later.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.setJudging(partyId, next);
      if (res.hackathon) onJudgingChanged(res.hackathon);
      void load();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const active = data?.judges.filter((j) => j.status === 'active') ?? [];
  const totalScores = data ? Object.values(data.projects).reduce((n, p) => n + p.scores.filter((s) => s.counted).length, 0) : 0;

  return (
    <div className="space-y-4" data-testid="hackathon-leaderboard-section">
      <SectionCard
        title="Leaderboard"
        subtitle={data ? `${data.overall.length} project${data.overall.length === 1 ? '' : 's'} · ${totalScores} score${totalScores === 1 ? '' : 's'}. Average of judges' totals, out of 100; ties are shown as ties.` : 'Loading...'}
        action={
          <button type="button" disabled={busy || (status !== 'open' && hackathon.criteria.length === 0) || (status === 'closed' && !!hackathon.resultsRevealedAt)} onClick={() => void toggle()}
            title={status === 'closed' && hackathon.resultsRevealedAt ? 'Results are revealed. Hide them in Winners & Payouts to reopen judging.' : undefined}
            className={`${status === 'open' ? 'btn-secondary' : 'btn-primary'} text-sm inline-flex items-center gap-2 shrink-0`}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : status === 'open' ? <StopCircle size={14} /> : <PlayCircle size={14} />}
            {status === 'open' ? 'Close judging' : status === 'closed' ? 'Reopen' : 'Open judging'}
          </button>
        }
      >
        {hackathon.tracks.length > 0 && (
          <ChoicePills<string>
            ariaLabel="Leaderboard view"
            value={view}
            onChange={setView}
            options={[{ value: 'overall', label: 'Overall' }, ...hackathon.tracks.map((t) => ({ value: t.id, label: t.name }))]}
          />
        )}
        <div className="mt-2"><ErrorBanner message={error} onClose={() => setError(null)} /></div>
        {!data ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-theme-text-muted py-6 text-center">
            {data.overall.length === 0 ? 'No submitted projects yet.' : 'No projects in this track.'}
          </p>
        ) : (
          <ul className="divide-y divide-theme-stroke mt-2">
            {rows.map((r) => <Row key={r.submissionId} row={r} data={data} />)}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Judge progress" subtitle="Projects scored out of the projects in each judge's tracks.">
        {!data ? null : data.judges.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No judges yet. Add them in the Judging section.</p>
        ) : (
          <ul className="divide-y divide-theme-stroke" data-testid="hackathon-judge-progress">
            {data.judges.map((j) => {
              const pct = j.assigned ? Math.round((100 * j.scored) / j.assigned) : 0;
              const tracks = j.trackIds.length ? hackathon.tracks.filter((t) => j.trackIds.includes(t.id)).map((t) => t.name).join(', ') : 'All tracks';
              return (
                <li key={j.id} className={`py-3 ${j.status === 'removed' ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-theme-text break-words">{j.name || j.email}</p>
                      <p className="text-xs text-theme-text-muted break-words">
                        {j.name ? `${j.email} · ` : ''}{j.status === 'removed' ? 'Removed' : tracks}{!j.linked && j.status === 'active' ? " · hasn't opened the link yet" : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-theme-text tabular-nums shrink-0">{j.scored}/{j.assigned}</p>
                  </div>
                  <div className="h-1.5 mt-2 rounded-full bg-theme-surface border border-theme-stroke overflow-hidden">
                    <div className={`h-full ${pct === 100 ? 'bg-theme-success' : 'bg-theme-accent'}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {data && active.length > 0 && (
          <p className="text-xs text-theme-text-muted mt-3 flex items-center gap-1.5"><Hash size={12} /> {active.filter((j) => j.assigned > 0 && j.scored >= j.assigned).length} of {active.length} judges done.</p>
        )}
      </SectionCard>
    </div>
  );
}
