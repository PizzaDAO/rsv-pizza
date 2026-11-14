import { useCallback, useEffect, useState } from 'react';
import { Check, Heart, Loader2, Vote } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { LoginModal } from '../LoginModal';
import { hackathonVotingApi, myVoteIn, votingHeadline, type VoterState } from '../../lib/hackathonVotingApi';

/**
 * People's Choice voting on the gallery and project pages (plans/hackathon-platform.md §3,
 * PR 7). Everything is server-enforced (login, eligibility, window, gallery, self-votes, one
 * vote per scope); the UI mirrors GET /hackathon/voting and never sees vote counts.
 */
export function useVoting(partyId: string | undefined) {
  const { user } = useAuth();
  const [state, setState] = useState<VoterState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  const load = useCallback(async () => {
    if (!partyId) return;
    try {
      setState(await hackathonVotingApi.state(partyId));
    } catch {
      setState(null); // voting is optional chrome on these pages: fail quiet
    }
  }, [partyId]);

  // Reload on login / logout.
  useEffect(() => { void load(); }, [load, user?.id]);

  const toggle = useCallback(async (projectSlug: string, trackId: string | null) => {
    if (!partyId) return;
    const mine = myVoteIn(state?.me?.votes, trackId);
    setBusyKey(`${projectSlug}:${trackId ?? ''}`);
    setError(null);
    try {
      setState(mine?.projectSlug === projectSlug
        ? await hackathonVotingApi.retract(partyId, trackId)
        : await hackathonVotingApi.vote(partyId, projectSlug, trackId));
    } catch (e: any) {
      setError(e?.message || 'Could not save your vote');
      void load();
    } finally {
      setBusyKey(null);
    }
  }, [partyId, state, load]);

  return { state, toggle, busyKey, error, clearError: () => setError(null), showLogin, setShowLogin };
}

export type VotingHandle = ReturnType<typeof useVoting>;

/** True when vote buttons should render at all (voting open on a visible gallery). */
export function votingLive(s: VoterState | null): boolean {
  return !!s?.voting && s.voting.status === 'open' && s.galleryOpen;
}

/** Status line + "log in" / why-you-can't-vote, above the gallery or on a project page. */
export function VotingBanner({ v }: { v: VotingHandle }) {
  const s = v.state;
  const headline = votingHeadline(s?.voting ?? null);
  if (!s?.voting || !headline) return null;
  // Scheduled / open but the gallery isn't public yet: nothing votable to show.
  if (s.voting.status !== 'closed' && !s.galleryOpen) return null;
  const me = s.me;
  const live = votingLive(s);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-theme-stroke bg-theme-surface px-4 py-3 mb-4" data-testid="voting-banner">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <Vote size={18} className="mt-0.5 shrink-0 text-theme-accent" />
        <div className="min-w-0 text-sm">
          <p className="text-theme-text">{headline}</p>
          {live && me?.loggedIn && !me.eligible && me.message && <p className="text-theme-text-muted mt-0.5" data-testid="voting-ineligible">{me.message}</p>}
          {live && me?.eligible && me.votes.length > 0 && (
            <p className="text-theme-text-muted mt-0.5">You&apos;ve voted. Tap your pick again to take your vote back.</p>
          )}
          {v.error && <p className="text-theme-error mt-0.5" role="alert">{v.error}</p>}
        </div>
      </div>
      {live && me && !me.loggedIn && (
        <button type="button" className="btn-primary text-sm shrink-0 min-h-[44px]" onClick={() => v.setShowLogin(true)} data-testid="voting-login">
          Log in to vote
        </button>
      )}
      {v.showLogin && <LoginModal isOpen={v.showLogin} onClose={() => v.setShowLogin(false)} />}
    </div>
  );
}

/**
 * The vote button for one project in one scope (trackId null = event-wide). Hidden unless the
 * caller can vote; "Your team" on their own project.
 */
export function VoteButton({ v, projectSlug, trackId, label, compact }: {
  v: VotingHandle;
  projectSlug: string;
  trackId: string | null;
  /** e.g. the track name in track scope */
  label?: string;
  compact?: boolean;
}) {
  const s = v.state;
  if (!votingLive(s) || !s?.me?.loggedIn || !s.me.eligible) return null;
  if (s.me.ownProjectSlugs.includes(projectSlug)) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-theme-text-muted px-1 min-h-[36px]" data-testid="vote-own">Your team&apos;s project</span>;
  }
  const mine = myVoteIn(s.me.votes, trackId);
  const voted = mine?.projectSlug === projectSlug;
  const busy = v.busyKey === `${projectSlug}:${trackId ?? ''}`;
  const text = voted ? `Your vote${label ? ` · ${label}` : ''}` : mine ? `Switch vote${label ? ` · ${label}` : ''}` : `Vote${label ? ` · ${label}` : ''}`;
  return (
    <button
      type="button"
      aria-pressed={voted}
      disabled={!!v.busyKey}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void v.toggle(projectSlug, trackId); }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border text-sm font-medium transition-colors ${compact ? 'px-3 min-h-[36px]' : 'px-4 min-h-[44px]'} ${
        voted
          ? 'border-theme-accent bg-theme-accent text-white'
          : 'border-theme-stroke text-theme-text hover:border-theme-accent hover:text-theme-accent bg-theme-surface'
      }`}
      data-testid="vote-button"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : voted ? <Check size={14} /> : <Heart size={14} />}
      <span className="truncate">{text}</span>
    </button>
  );
}
