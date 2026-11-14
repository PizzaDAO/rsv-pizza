import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy, Loader2, Eye, EyeOff, CheckCircle2, Circle, Lock } from 'lucide-react';
import { hackathonHostApi, hackathonJudgingHostApi, type HostHackathon, type HackathonSettingsInput } from '../../lib/hackathonApi';
import { ErrorBanner } from './shared';
import { SetupSection } from './SetupSection';
import { TracksPrizesSection } from './TracksPrizesSection';
import { JudgingSection } from './JudgingSection';
import { TeamsSubmissionsSection } from './TeamsSubmissionsSection';
import { LeaderboardSection } from './LeaderboardSection';
import { WinnersSection } from './WinnersSection';
import { VotingSection } from './VotingSection';

export type HackathonSection = 'setup' | 'tracks' | 'judging' | 'submissions' | 'leaderboard' | 'voting' | 'winners';
const SECTIONS: Array<{ id: HackathonSection; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'tracks', label: 'Tracks & Prizes' },
  { id: 'judging', label: 'Judging' },
  { id: 'submissions', label: 'Teams & Submissions' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'voting', label: 'Voting' },
  { id: 'winners', label: 'Winners & Payouts' },
];

export function HackathonTab({ partyId, inviteCode }: { partyId: string; inviteCode?: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: HackathonSection = SECTIONS.some((s) => s.id === raw) ? (raw as HackathonSection) : 'setup';

  const [hackathon, setHackathon] = useState<HostHackathon | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // false = the backend says this caller can't manage it (e.g. a co-host without the tab who
  // reached /host/:code/hackathon directly): show a no-access state, never Enable.
  const [canManage, setCanManage] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hackathonHostApi.get(partyId);
      setCanManage(res.canManage === true);
      setHackathon(res.canManage ? res.hackathon : null);
    } catch (e: any) {
      setError(e?.message || 'Could not load the hackathon');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => { void load(); }, [load]);

  /** Runs a write that returns the fresh host shape; true on success. */
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = (await fn()) as { hackathon?: HostHackathon | null };
      if (res && 'hackathon' in res) setHackathon(res.hackathon ?? null);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const setSection = (id: HackathonSection) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'setup') next.delete('section');
    else next.set('section', id);
    setSearchParams(next, { replace: true });
  };

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="card p-6 sm:p-8 text-center" data-testid="hackathon-no-access">
        <Lock className="w-10 h-10 mx-auto mb-3 text-theme-text-muted" />
        <h2 className="text-lg font-semibold text-theme-text">You don't have access to this tab</h2>
        <p className="text-sm text-theme-text-secondary mt-2">Ask the event host to give you access to the Hackathon tab.</p>
      </div>
    );
  }

  if (!hackathon || !hackathon.enabled) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <div className="card p-6 sm:p-8 text-center" data-testid="hackathon-enable-card">
          <Trophy className="w-12 h-12 mx-auto mb-3 text-theme-text-muted" />
          <h2 className="text-xl font-semibold text-theme-text">
            {hackathon ? 'The hackathon is disabled' : 'Run a hackathon at this event'}
          </h2>
          <p className="text-sm text-theme-text-secondary mt-2 max-w-md mx-auto">
            {hackathon
              ? "It's hidden from the event page. Your tracks, prizes, rubric and judges are kept."
              : 'Set up tracks, prizes, rules and a judging rubric. Teams submit projects here, judges score them, and you pick the winners.'}
          </p>
          <button type="button" className="btn-primary mt-5 inline-flex items-center gap-2" disabled={busy}
            onClick={() => void run(() => hackathonHostApi.enable(partyId))}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {hackathon ? 'Re-enable hackathon' : 'Enable hackathon'}
          </button>
        </div>
      </div>
    );
  }

  const published = !!hackathon.publishedAt;
  const ready = [
    { label: 'At least one track', done: hackathon.tracks.length > 0 },
    { label: 'At least one prize', done: hackathon.prizes.length > 0 },
    { label: 'Submission deadline set', done: !!hackathon.submissionDeadline },
    { label: 'Rubric has a criterion', done: hackathon.criteria.length > 0 },
    { label: 'At least one judge', done: hackathon.judges.some((j) => j.status === 'active') },
  ];

  const saveSettings = (body: HackathonSettingsInput) => run(() => hackathonHostApi.updateSettings(partyId, body));
  const disable = () => {
    if (confirm('Disable the hackathon? It will be hidden from the event page. Your setup is kept and you can re-enable it.')) {
      void run(() => hackathonHostApi.disable(partyId));
    }
  };

  return (
    <div className="space-y-4" data-testid="hackathon-tab">
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-theme-surface border border-theme-stroke flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-theme-accent" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-theme-text">Hackathon</h2>
              <p className="text-sm text-theme-text-secondary">
                {published ? 'Published: tracks, prizes and rules show on the event page.' : 'Draft: only hosts can see it.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => hackathonHostApi.updateSettings(partyId, { published: !published }))}
            className={`${published ? 'btn-secondary' : 'btn-primary'} flex items-center justify-center gap-2 shrink-0`}
          >
            {published ? <EyeOff size={16} /> : <Eye size={16} />}
            {published ? 'Unpublish' : 'Publish to event page'}
          </button>
        </div>

        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {ready.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-sm">
              {r.done
                ? <CheckCircle2 size={16} className="text-theme-success shrink-0" />
                : <Circle size={16} className="text-theme-text-faint shrink-0" />}
              <span className={r.done ? 'text-theme-text' : 'text-theme-text-muted'}>{r.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex gap-2 overflow-x-auto -mx-1 px-1" role="tablist" aria-label="Hackathon sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              data-testid={`hackathon-section-${s.id}`}
              onClick={() => setSection(s.id)}
              className={`px-4 py-2 rounded-full text-sm whitespace-nowrap border transition-colors min-h-[40px] ${
                section === s.id
                  ? 'bg-theme-text text-theme-bg border-theme-text font-medium'
                  : 'border-theme-stroke text-theme-text-secondary hover:text-theme-text'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner message={error} onClose={() => setError(null)} />

      {section === 'setup' && (
        <SetupSection hackathon={hackathon} saving={busy} onSave={saveSettings} onDisable={disable} />
      )}
      {section === 'tracks' && (
        <TracksPrizesSection
          hackathon={hackathon}
          busy={busy}
          run={run}
          api={{
            addTrack: (b) => hackathonHostApi.addTrack(partyId, b),
            updateTrack: (id, b) => hackathonHostApi.updateTrack(partyId, id, b),
            deleteTrack: (id) => hackathonHostApi.deleteTrack(partyId, id),
            addPrize: (b) => hackathonHostApi.addPrize(partyId, b),
            updatePrize: (id, b) => hackathonHostApi.updatePrize(partyId, id, b),
            deletePrize: (id) => hackathonHostApi.deletePrize(partyId, id),
          }}
        />
      )}
      {section === 'judging' && (
        <JudgingSection
          hackathon={hackathon}
          busy={busy}
          run={run}
          inviteCode={inviteCode}
          onViewLeaderboard={() => setSection('leaderboard')}
          api={{
            setJudging: (status) => hackathonJudgingHostApi.setJudging(partyId, status),
            addCriterion: (b) => hackathonHostApi.addCriterion(partyId, b),
            updateCriterion: (id, b) => hackathonHostApi.updateCriterion(partyId, id, b),
            deleteCriterion: (id) => hackathonHostApi.deleteCriterion(partyId, id),
            addJudge: (b) => hackathonHostApi.addJudge(partyId, b),
            updateJudge: (id, b) => hackathonHostApi.updateJudge(partyId, id, b),
            deleteJudge: (id) => hackathonHostApi.deleteJudge(partyId, id),
          }}
        />
      )}
      {section === 'submissions' && <TeamsSubmissionsSection partyId={partyId} hackathon={hackathon} />}
      {section === 'leaderboard' && <LeaderboardSection partyId={partyId} hackathon={hackathon} onJudgingChanged={(h) => setHackathon(h)} />}
      {section === 'voting' && (
        <VotingSection partyId={partyId} onOpenWinners={() => setSection('winners')} onOpenSetup={() => setSection('setup')} />
      )}
      {section === 'winners' && (
        <WinnersSection
          partyId={partyId}
          hackathon={hackathon}
          onHackathonChanged={(h) => setHackathon(h)}
          onOpenLeaderboard={() => setSection('leaderboard')}
        />
      )}
    </div>
  );
}

export default HackathonTab;
