import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Clock, Loader2, Lock, Medal, PlayCircle, StopCircle, Users, Vote } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { ChoicePills, ErrorBanner, Hint, SectionCard } from './shared';
import { isoToLocalInput, localInputToIso } from '../../lib/hackathonApi';
import {
  VOTING_STATUS_LABEL,
  hackathonVotingHostApi as api,
  type HostVoting,
  type TallyRow,
  type VotingEligibility,
  type VotingScope,
  type VotingSettingsInput,
} from '../../lib/hackathonVotingApi';

const POLL_MS = 60_000;

interface Form {
  enabled: boolean;
  scope: VotingScope;
  eligibility: VotingEligibility;
  opensAt: string;
  closesAt: string;
}

const toForm = (d: HostVoting): Form => ({
  enabled: d.settings.enabled,
  scope: d.settings.scope,
  eligibility: d.settings.eligibility,
  opensAt: isoToLocalInput(d.settings.opensAt),
  closesAt: isoToLocalInput(d.settings.closesAt),
});

/** Why voters can't see projects yet (voting needs a visible gallery). */
export function galleryWarning(d: Pick<HostVoting, 'galleryOpen' | 'galleryVisibility'>): string | null {
  if (d.galleryOpen) return null;
  if (d.galleryVisibility === 'hidden') return 'The project gallery is hidden, so nobody can vote. Set the gallery to show after the deadline in Setup.';
  if (d.galleryVisibility === 'after_reveal') return 'The gallery opens when you reveal the results, so voting only starts after that. To vote before the reveal, set the gallery to show after the deadline in Setup.';
  return 'The gallery opens at the submission deadline. Votes are accepted from then on.';
}

function TallyList({ rows, suggested }: { rows: TallyRow[]; suggested: Set<string> }) {
  if (!rows.length) return <p className="text-sm text-theme-text-muted">No submitted projects.</p>;
  return (
    <ul className="divide-y divide-theme-stroke" data-testid="voting-tally">
      {rows.map((r) => (
        <li key={r.submissionId} className="flex items-center gap-3 py-2.5 min-h-[44px]">
          <span className={`w-10 shrink-0 text-center text-sm font-bold tabular-nums ${r.rank === 1 ? 'text-theme-accent' : 'text-theme-text-secondary'}`}>
            {r.rank === null ? '-' : `${r.tied ? '=' : '#'}${r.rank}`}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-theme-text truncate">{r.name}</span>
            <span className="block text-xs text-theme-text-muted truncate">{r.teamName ?? ''}</span>
          </span>
          {suggested.has(r.submissionId) && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-theme-accent shrink-0"><Medal size={12} /> People&apos;s Choice pick</span>
          )}
          <span className="text-sm font-semibold text-theme-text tabular-nums shrink-0">{r.votes} vote{r.votes === 1 ? '' : 's'}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Host "Voting" section (plans/hackathon-platform.md §3, PR 7): settings, open / close, the
 * live vote count (never per-project counts while open: the server doesn't send them), votes
 * per network for abuse review, and after close the tally + People's Choice suggestion.
 */
export function VotingSection({ partyId, onOpenWinners, onOpenSetup }: {
  partyId: string;
  onOpenWinners: () => void;
  onOpenSetup: () => void;
}) {
  const [data, setData] = useState<HostVoting | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string>('overall');

  const apply = useCallback((d: HostVoting, resetForm: boolean) => {
    setData(d);
    if (resetForm) { setForm(toForm(d)); setDirty(false); }
  }, []);

  const load = useCallback(async (resetForm: boolean) => {
    try {
      apply(await api.get(partyId), resetForm);
    } catch (e: any) {
      setError(e?.message || 'Could not load voting');
    }
  }, [partyId, apply]);

  useEffect(() => { void load(true); }, [load]);

  // The vote count: poll while visible (no realtime), never clobbering an unsaved form.
  const status = data?.settings.status;
  useEffect(() => {
    if (status !== 'open' && status !== 'scheduled') return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(false); }, POLL_MS);
    return () => clearInterval(t);
  }, [status, load]);

  const run = async (key: string, fn: () => Promise<HostVoting>) => {
    setBusy(key);
    setError(null);
    try {
      apply(await fn(), true);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  if (!data || !form) {
    return (
      <div className="card p-6 flex items-center justify-center py-12">
        {error ? <ErrorBanner message={error} /> : <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />}
      </div>
    );
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };
  const opensIso = localInputToIso(form.opensAt);
  const closesIso = localInputToIso(form.closesAt);
  const dateError = opensIso && closesIso && new Date(closesIso) <= new Date(opensIso) ? 'Voting must close after it opens.' : null;
  const hasVotes = data.totals.votes > 0;
  const save = () => {
    const body: VotingSettingsInput = { enabled: form.enabled, eligibility: form.eligibility, opensAt: opensIso, closesAt: closesIso };
    if (!hasVotes) body.scope = form.scope;
    void run('save', () => api.update(partyId, body));
  };
  const st = data.settings.status;
  const warning = data.settings.enabled || st === 'closed' ? galleryWarning(data) : null;
  const pc = data.peoplesChoicePrizes;
  const r = data.results;
  const rows = r ? (view === 'overall' ? r.overall : r.byTrack.find((t) => t.trackId === view)?.rows ?? []) : [];
  const suggested = new Set(r ? Object.values(r.suggestions).flat() : []);
  const trackOpts = [{ value: 'overall', label: 'Overall' }, ...data.tracks.map((t) => ({ value: t.id, label: t.name }))];

  return (
    <div className="space-y-4" data-testid="hackathon-voting-section">
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <SectionCard
        title="People's Choice voting"
        subtitle="Attendees vote for their favorite project on the gallery. One vote each; they can change it until voting closes."
        action={
          <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${st === 'open' ? 'border-theme-accent text-theme-accent' : 'border-theme-stroke text-theme-text-secondary'}`} data-testid="voting-status">
            <Vote size={12} /> {VOTING_STATUS_LABEL[st]}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-theme-stroke bg-theme-surface px-4 py-3">
            <p className="text-2xl font-bold text-theme-text tabular-nums" data-testid="voting-total">{data.totals.votes}</p>
            <p className="text-xs text-theme-text-muted">vote{data.totals.votes === 1 ? '' : 's'} cast</p>
          </div>
          <div className="rounded-xl border border-theme-stroke bg-theme-surface px-4 py-3">
            <p className="text-2xl font-bold text-theme-text tabular-nums">{data.totals.voters}</p>
            <p className="text-xs text-theme-text-muted">voter{data.totals.voters === 1 ? '' : 's'}</p>
          </div>
        </div>
        {st !== 'closed' && (
          <p className="flex items-start gap-2 text-sm text-theme-text-secondary mt-3">
            <Lock size={14} className="mt-0.5 shrink-0" />
            Results stay hidden from everyone, you included, until voting closes.
          </p>
        )}
        {warning && (
          <p className="flex items-start gap-2 text-sm text-theme-text-secondary mt-3" data-testid="voting-gallery-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-theme-accent" />
            <span>{warning} {data.galleryVisibility !== 'after_deadline' && <button type="button" className="underline" onClick={onOpenSetup}>Open Setup</button>}</span>
          </p>
        )}
        {pc.length === 0 && (
          <Hint>Votes decide a prize only if you add one with the People&apos;s Choice kind in Tracks &amp; Prizes.</Hint>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {st !== 'open' && (
            <button type="button" className="btn-primary inline-flex items-center gap-2 text-sm" disabled={!!busy}
              onClick={() => {
                if (st === 'closed' && !confirm('Re-open voting? Results are hidden again until you close it.')) return;
                void run('open', () => api.open(partyId));
              }}
              data-testid="voting-open">
              {busy === 'open' ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
              {st === 'closed' ? 'Re-open voting' : 'Open voting now'}
            </button>
          )}
          {(st === 'open' || st === 'scheduled') && (
            <button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" disabled={!!busy}
              onClick={() => { if (confirm('Close voting now? Votes are final after this and the results become visible to you.')) void run('close', () => api.close(partyId)); }}
              data-testid="voting-close">
              {busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : <StopCircle size={14} />}
              Close voting now
            </button>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Settings" subtitle="Times are in your local time zone. Leave the times empty to open and close by hand.">
        <div className="space-y-4">
          <div>
            <Checkbox checked={form.enabled} onChange={() => set('enabled', !form.enabled)} label="Voting on" />
            <Hint>Off hides the vote buttons. A closed vote keeps its results.</Hint>
          </div>
          <div>
            <ChoicePills<VotingEligibility>
              ariaLabel="Who can vote"
              value={form.eligibility}
              onChange={(v) => set('eligibility', v)}
              options={[{ value: 'checked_in', label: 'Checked-in attendees' }, { value: 'registered', label: 'Approved RSVPs' }]}
            />
            <Hint>Voters log in with the email they RSVP&apos;d with. Nobody can vote for their own team.</Hint>
          </div>
          <div>
            <ChoicePills<VotingScope>
              ariaLabel="Votes per person"
              value={form.scope}
              onChange={(v) => { if (!hasVotes) set('scope', v); }}
              options={[{ value: 'event', label: 'One vote per person' }, { value: 'track', label: 'One vote per track' }]}
            />
            <Hint>{hasVotes ? 'Locked: votes have been cast.' : 'Per track: each person gets one vote in every track.'}</Hint>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <IconInput icon={CalendarClock} type="datetime-local" aria-label="Voting opens" placeholder="Voting opens"
                value={form.opensAt} onChange={(e) => set('opensAt', e.target.value)} />
              <Hint>Voting opens (empty = when you open it)</Hint>
            </div>
            <div>
              <IconInput icon={Clock} type="datetime-local" aria-label="Voting closes" placeholder="Voting closes"
                value={form.closesAt} onChange={(e) => set('closesAt', e.target.value)} />
              <Hint>Voting closes (empty = when you close it)</Hint>
            </div>
          </div>
          {dateError && <p className="text-xs text-theme-error">{dateError}</p>}
          <div className="flex justify-end">
            <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={!dirty || !!busy || !!dateError} onClick={save} data-testid="voting-save">
              {busy === 'save' && <Loader2 size={14} className="animate-spin" />} Save voting settings
            </button>
          </div>
        </div>
      </SectionCard>

      {r ? (
        <SectionCard title="Results" subtitle={`${r.countedVotes} counted vote${r.countedVotes === 1 ? '' : 's'}. Votes for withdrawn or disqualified projects and for a voter's own team don't count.`}>
          {data.tracks.length > 0 && (
            <div className="mb-3"><ChoicePills ariaLabel="Results view" value={view} onChange={setView} options={trackOpts} /></div>
          )}
          <TallyList rows={rows} suggested={suggested} />
          {pc.length > 0 && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-theme-stroke bg-theme-surface px-4 py-3">
              <Medal size={18} className="shrink-0 text-theme-accent" />
              <p className="text-sm text-theme-text-secondary flex-1">
                {pc.map((p) => {
                  const ids = r.suggestions[p.id] ?? [];
                  const names = ids.map((id) => r.overall.find((x) => x.submissionId === id)?.name).filter(Boolean);
                  return `${p.name}: ${names.length ? names.join(', ') : 'no votes yet'}`;
                }).join(' · ')}
                . Award it in Winners &amp; Payouts.
              </p>
              <button type="button" className="btn-secondary text-sm shrink-0" onClick={onOpenWinners}>Open Winners</button>
            </div>
          )}
        </SectionCard>
      ) : null}

      <SectionCard title="Votes per network" subtitle="For spotting vote farming. Venue Wi-Fi puts many honest voters on one network, so this is a hint, not proof.">
        {data.ip.buckets.length === 0 ? (
          <p className="text-sm text-theme-text-muted">No votes yet.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="voting-ip-buckets">
            {data.ip.buckets.map((b) => (
              <li key={b.label} className="flex items-center gap-3 text-sm">
                <Users size={14} className="text-theme-text-muted shrink-0" />
                <span className="font-mono text-xs text-theme-text-secondary">Network {b.label}</span>
                <span className="ml-auto tabular-nums text-theme-text">{b.votes}</span>
              </li>
            ))}
          </ul>
        )}
        <Hint>
          {data.ip.bucketCount} network{data.ip.bucketCount === 1 ? '' : 's'}. IP addresses are never stored, only a one-way hash.
        </Hint>
      </SectionCard>
    </div>
  );
}
