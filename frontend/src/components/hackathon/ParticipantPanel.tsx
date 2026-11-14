import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users, UserPlus, KeyRound, Copy, Check, Crown, X, LogOut, RefreshCw, Pencil, Send, Undo2, Loader2, Rocket, Github, Video, Presentation, Globe,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { LoginModal } from '../LoginModal';
import { IconInput } from '../IconInput';
import { ErrorBanner, Hint } from './shared';
import { SubmissionForm } from './SubmissionForm';
import { TeamResults } from './TeamResults';
import {
  STATUS_LABEL,
  eligibilityMessage,
  hackathonParticipantApi as api,
  type HackathonMe,
  type MyHackathonTeam,
  type PublicHackathon,
  type SubmissionInput,
  type SubmissionStatus,
} from '../../lib/hackathonApi';

const POLL_MS = 60_000;

/** `?hackJoin=CODE` on the event URL opens the join form prefilled (the invite link). */
export const JOIN_PARAM = 'hackJoin';

export function inviteLink(code: string, href = typeof window !== 'undefined' ? window.location.href : ''): string {
  try {
    const u = new URL(href);
    u.search = '';
    u.hash = '';
    u.searchParams.set(JOIN_PARAM, code);
    return u.toString();
  } catch {
    return `?${JOIN_PARAM}=${code}`;
  }
}

const STATUS_CLASS: Record<SubmissionStatus, string> = {
  draft: 'border-theme-stroke text-theme-text-secondary',
  submitted: 'border-theme-success text-theme-success',
  withdrawn: 'border-theme-stroke text-theme-text-muted',
  disqualified: 'border-theme-error text-theme-error',
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium ${STATUS_CLASS[status]}`} data-testid="hackathon-status">
      {STATUS_LABEL[status]}
    </span>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) return <img src={url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />;
  return (
    <span className="w-8 h-8 rounded-full bg-theme-surface border border-theme-stroke flex items-center justify-center text-sm font-medium text-theme-text shrink-0" aria-hidden>
      {(name.trim()[0] || '?').toUpperCase()}
    </span>
  );
}

/**
 * Participant CTA + team + project editor on the event page (plans/hackathon-platform.md §8,
 * PR 3). States: log in -> not eligible (why) -> create / join a team -> team card + project.
 * Everything is server-enforced; the UI just mirrors /hackathon/me.
 */
export function ParticipantPanel({ partyId, hackathon }: { partyId: string; hackathon: PublicHackathon }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const joinParam = searchParams.get(JOIN_PARAM);

  const [me, setMe] = useState<HackathonMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [mode, setMode] = useState<'idle' | 'create' | 'join'>(joinParam ? 'join' : 'idle');
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState(joinParam ?? '');
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setMe(await api.me(partyId));
    } catch (e: any) {
      setError(e?.message || 'Could not load your hackathon status');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  // Reload on login/logout.
  useEffect(() => { void load(); }, [load, user?.id]);

  // Teammates joining / editing: poll only while a team is shown, the tab is visible, and the
  // deadline hasn't passed (nothing changes after it). Not while this form is open (our own
  // saves already refresh it). Catch up once when the tab becomes visible again.
  const shouldPoll = !!me?.team && !me.deadlinePassed && !editing;
  useEffect(() => {
    if (!shouldPoll) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [shouldPoll, load]);

  const setTeam = (team: MyHackathonTeam | null) => setMe((m) => (m ? { ...m, team } : m));

  const run = useCallback(async (fn: () => Promise<{ team: MyHackathonTeam | null }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setTeam(res.team);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearJoinParam = () => {
    if (!joinParam) return;
    const next = new URLSearchParams(searchParams);
    next.delete(JOIN_PARAM);
    setSearchParams(next, { replace: true });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 mb-3 flex items-center gap-2 text-sm text-theme-text-muted">
        <Loader2 size={16} className="animate-spin" /> Loading your hackathon status...
      </div>
    );
  }
  if (!me) return <ErrorBanner message={error} />;

  const team = me.team;
  const closed = me.deadlinePassed;

  // ------------------------------------------------------------ no team yet
  // After the reveal there's nothing left to join: the winners strip says it all.
  if (!team && hackathon.resultsRevealedAt) return null;
  if (!team) {
    let body: ReactNode;
    if (!me.loggedIn) {
      body = (
        <>
          <p className="text-sm text-theme-text-secondary">{eligibilityMessage('login')}</p>
          <button type="button" className="btn-primary mt-3" onClick={() => setShowLogin(true)} data-testid="hackathon-login">
            Log in to join
          </button>
        </>
      );
    } else if (closed) {
      body = <p className="text-sm text-theme-text-secondary">Submissions are closed, so new teams can't form.</p>;
    } else if (!me.eligibility.eligible) {
      body = <p className="text-sm text-theme-text-secondary" data-testid="hackathon-ineligible">{eligibilityMessage(me.eligibility.reason)}</p>;
    } else {
      body = (
        <>
          <p className="text-sm text-theme-text-secondary">
            Start a team and invite teammates with a link, or join a team with its invite code.
          </p>
          {mode === 'idle' && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setMode('create')} data-testid="hackathon-create-team">
                <UserPlus size={16} /> Create a team
              </button>
              <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setMode('join')}>
                <KeyRound size={16} /> Join with a code
              </button>
            </div>
          )}
          {mode === 'create' && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => { e.preventDefault(); void run(() => api.createTeam(partyId, teamName)).then((ok) => ok && setMode('idle')); }}
            >
              <IconInput icon={Users} value={teamName} maxLength={80} placeholder="Team name" onChange={(e) => setTeamName(e.target.value)} autoFocus />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy || !teamName.trim()}>
                  {busy && <Loader2 size={16} className="animate-spin" />} Create team
                </button>
                <button type="button" className="btn-secondary" onClick={() => setMode('idle')}>Cancel</button>
              </div>
            </form>
          )}
          {mode === 'join' && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => api.joinTeam(partyId, code)).then((ok) => { if (ok) { setMode('idle'); clearJoinParam(); } });
              }}
            >
              <IconInput icon={KeyRound} value={code} maxLength={32} placeholder="Invite code from your captain" onChange={(e) => setCode(e.target.value)} autoFocus={!joinParam} />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy || !code.trim()}>
                  {busy && <Loader2 size={16} className="animate-spin" />} Join team
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setMode('idle'); clearJoinParam(); }}>Cancel</button>
              </div>
            </form>
          )}
        </>
      );
    }
    return (
      <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 mb-3" data-testid="hackathon-participant">
        <p className="text-sm font-semibold text-theme-text flex items-center gap-2 mb-1.5"><Rocket size={16} className="text-theme-accent" /> Join the hackathon</p>
        {joinParam && me.loggedIn && me.eligibility.eligible && !closed && <Hint>You were invited to a team. Check the code and join.</Hint>}
        {body}
        <div className="mt-3"><ErrorBanner message={error} onClose={() => setError(null)} /></div>
        <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      </div>
    );
  }

  // ------------------------------------------------------------ on a team
  const myMember = team.members.find((m) => m.isMe);
  const isCaptain = myMember?.role === 'captain';
  const sub = team.submission;
  const locked = closed || sub?.status === 'disqualified';
  const link = inviteLink(team.inviteCode);
  const full = team.memberCount >= hackathon.teamMaxSize;
  const tooSmall = team.memberCount < hackathon.teamMinSize;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(`Copy this link: ${link}`);
    }
  };

  const save = (body: SubmissionInput) => run(() => api.saveSubmission(partyId, team.id, body));
  const upload = (file: File, kind: 'cover' | 'screenshot') => run(() => api.uploadImage(partyId, team.id, file, kind));
  const removeImage = (path: string) => run(() => api.removeImage(partyId, team.id, path));

  const links = sub
    ? ([
        [Github, 'Repo', sub.repoUrl],
        [Video, 'Demo', sub.demoVideoUrl],
        [Presentation, 'Deck', sub.deckUrl],
        [Globe, 'Live', sub.liveUrl],
      ] as const).filter(([, , u]) => !!u)
    : [];

  return (
    <div className="space-y-3 mb-3" data-testid="hackathon-participant">
      {/* Results (after the host reveals them) */}
      {me.results && <TeamResults results={me.results} />}

      {/* Team */}
      <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4" data-testid="hackathon-team">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-theme-text-muted">Your team</p>
            {renaming !== null ? (
              <form
                className="mt-1 flex gap-2"
                onSubmit={(e) => { e.preventDefault(); void run(() => api.renameTeam(partyId, team.id, renaming)).then((ok) => ok && setRenaming(null)); }}
              >
                <div className="flex-1 min-w-0"><IconInput icon={Users} value={renaming} maxLength={80} placeholder="Team name" onChange={(e) => setRenaming(e.target.value)} autoFocus /></div>
                <button type="submit" className="btn-primary" disabled={busy || !renaming.trim()}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            ) : (
              <p className="text-base font-semibold text-theme-text break-words flex items-center gap-2">
                {team.name}
                {isCaptain && !closed && (
                  <button type="button" aria-label="Rename team" className="text-theme-text-muted hover:text-theme-text p-1" onClick={() => setRenaming(team.name)}>
                    <Pencil size={14} />
                  </button>
                )}
              </p>
            )}
          </div>
          <span className="text-sm text-theme-text-muted shrink-0">{team.memberCount}/{hackathon.teamMaxSize}</span>
        </div>

        <ul className="mt-3 space-y-2">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 min-w-0">
              <Avatar name={m.name} url={m.avatarUrl} />
              <span className="text-sm text-theme-text truncate">{m.name}{m.isMe && <span className="text-theme-text-muted"> (you)</span>}</span>
              {m.role === 'captain' && <Crown size={14} className="text-theme-accent shrink-0" aria-label="Captain" />}
              {isCaptain && !m.isMe && !closed && (
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  className="ml-auto text-theme-text-muted hover:text-theme-error p-1.5"
                  disabled={busy}
                  onClick={() => { if (confirm(`Remove ${m.name} from the team?`)) void run(() => api.removeMember(partyId, team.id, m.id)); }}
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {!closed && (
          <div className="mt-4 pt-3 border-t border-theme-stroke">
            {full ? (
              <p className="text-sm text-theme-text-secondary">Your team is full.</p>
            ) : (
              <>
                <p className="text-sm text-theme-text-secondary mb-2">Invite teammates (they need an approved RSVP):</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <code className="flex-1 min-w-0 truncate rounded-lg border border-theme-stroke bg-theme-input px-3 py-2 text-xs text-theme-text" data-testid="hackathon-invite-link">{link}</code>
                  <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 shrink-0" onClick={() => void copy()}>
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <Hint>Code: <span className="font-mono">{team.inviteCode}</span></Hint>
              </>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {isCaptain && (
                <button type="button" className="text-xs text-theme-text-muted hover:text-theme-text inline-flex items-center gap-1 py-1" disabled={busy}
                  onClick={() => { if (confirm('Make a new invite link? The old one stops working.')) void run(() => api.regenerateCode(partyId, team.id)); }}>
                  <RefreshCw size={12} /> New invite link
                </button>
              )}
              <button type="button" className="text-xs text-theme-text-muted hover:text-theme-error inline-flex items-center gap-1 py-1" disabled={busy}
                onClick={() => {
                  const last = team.memberCount === 1;
                  const msg = last ? 'Leave and delete this team? Your draft project is deleted too.' : 'Leave this team?';
                  if (confirm(msg)) void run(() => api.leaveTeam(partyId, team.id));
                }}>
                <LogOut size={12} /> Leave team
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Project */}
      <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4" data-testid="hackathon-project">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs uppercase tracking-wide text-theme-text-muted">Your project</p>
          {sub && <StatusBadge status={sub.status} />}
        </div>

        {sub?.status === 'disqualified' && (
          <p className="text-sm text-theme-error mb-2">Disqualified{sub.disqualifiedReason ? `: ${sub.disqualifiedReason}` : ''}. Contact the host if you think this is a mistake.</p>
        )}

        {editing && !locked ? (
          <SubmissionForm
            submission={sub}
            tracks={hackathon.tracks}
            maxTracks={hackathon.maxTracksPerSubmission}
            busy={busy}
            onSave={save}
            onUpload={upload}
            onRemoveImage={removeImage}
            onCancel={() => setEditing(false)}
          />
        ) : sub ? (
          <div className="space-y-2">
            {sub.cover?.url && <img src={sub.cover.url} alt="" className="w-full max-h-48 object-cover rounded-lg border border-theme-stroke" />}
            <p className="text-base font-semibold text-theme-text break-words">{sub.name}</p>
            {sub.tagline && <p className="text-sm text-theme-text-secondary break-words">{sub.tagline}</p>}
            {sub.trackIds.length > 0 && (
              <p className="text-xs text-theme-text-muted">
                {hackathon.tracks.filter((t) => sub.trackIds.includes(t.id)).map((t) => t.name).join(', ')}
              </p>
            )}
            {links.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {links.map(([Icon, label, u]) => (
                  <a key={label} href={u!} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-sm text-theme-accent inline-flex items-center gap-1 underline">
                    <Icon size={14} /> {label}
                  </a>
                ))}
              </div>
            )}
            {sub.screenshots.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sub.screenshots.map((s, i) => s.url && <img key={s.path} src={s.url} alt={`Screenshot ${i + 1}`} className="h-16 w-24 object-cover rounded-md border border-theme-stroke shrink-0" />)}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-theme-text-secondary">{closed ? 'Your team did not start a project before the deadline.' : 'No project yet. Start a draft; you can edit it until the deadline.'}</p>
        )}

        {!editing && !locked && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className={`${sub ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-2`} onClick={() => setEditing(true)} data-testid="hackathon-edit-project">
              <Pencil size={16} /> {sub ? 'Edit project' : 'Start your project'}
            </button>
            {sub && sub.status !== 'submitted' && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                disabled={busy || tooSmall}
                onClick={() => void run(() => api.submit(partyId, team.id))}
                data-testid="hackathon-submit"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Submit project
              </button>
            )}
            {sub?.status === 'submitted' && (
              <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy}
                onClick={() => { if (confirm('Withdraw your project? You can submit it again before the deadline.')) void run(() => api.withdraw(partyId, team.id)); }}>
                <Undo2 size={16} /> Withdraw
              </button>
            )}
          </div>
        )}
        {!locked && tooSmall && sub && sub.status !== 'submitted' && (
          <Hint>Your team needs at least {hackathon.teamMinSize} members to submit.</Hint>
        )}
        {!locked && sub?.status === 'submitted' && <Hint>Submitted. You can keep editing until the deadline.</Hint>}
        {closed && sub && sub.status !== 'disqualified' && <Hint>The deadline has passed, so the project is read-only.</Hint>}
      </div>

      <ErrorBanner message={error} onClose={() => setError(null)} />
    </div>
  );
}
