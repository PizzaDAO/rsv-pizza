import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Gavel, Loader2, LogIn, CheckCircle2, Circle, EyeOff, Hash } from 'lucide-react';
import { Layout } from '../components/Layout';
import { LoginModal } from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { getEventBySlug, type PublicEvent } from '../lib/api';
import {
  hackathonJudgeApi,
  type JudgeQueueResponse,
  type JudgeSubmissionResponse,
  type ScoreInput,
} from '../lib/hackathonApi';
import { ChoicePills, ErrorBanner } from '../components/hackathon/shared';
import { JudgeScoring } from '../components/hackathon/JudgeScoring';

const POLL_MS = 60_000;

const STATUS_LABEL = { not_started: 'Not open yet', open: 'Judging open', closed: 'Judging closed' } as const;

/**
 * Judge page (plans/hackathon-platform.md §8, PR 4): /judge/:inviteCode (the party's invite code
 * or custom URL). Login gate -> queue (unscored first) -> scoring panel. Mobile-first: on phones
 * the queue and the scoring panel are separate screens; on desktop they sit side by side.
 * Access is the server's call: an active judge of this hackathon by login email.
 */
export function JudgePage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();

  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [data, setData] = useState<JudgeQueueResponse | null>(null);
  const [accessError, setAccessError] = useState<{ code: string; message: string } | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JudgeSubmissionResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [trackFilter, setTrackFilter] = useState<string>('all');

  // Resolve the event (invite code or custom URL), like the DJ page.
  useEffect(() => {
    if (!inviteCode) return;
    let cancelled = false;
    (async () => {
      const r = await getEventBySlug(inviteCode).catch(() => null);
      if (cancelled) return;
      if (r && 'redirect' in r) { navigate(`/judge/${r.slug}`, { replace: true }); return; }
      if (!r) setEventError('Event not found. Check the judge link with the host.');
      else setEvent(r);
    })();
    return () => { cancelled = true; };
  }, [inviteCode, navigate]);

  const partyId = event?.id ?? null;

  const loadQueue = useCallback(async (quiet = false) => {
    if (!partyId || !user) return;
    if (!quiet) setLoadingQueue(true);
    try {
      const res = await hackathonJudgeApi.queue(partyId);
      setData(res);
      setAccessError(null);
    } catch (e: any) {
      if (e?.code === 'NOT_A_JUDGE' || e?.code === 'JUDGE_REMOVED' || e?.code === 'NOT_FOUND') {
        setAccessError({ code: e.code, message: e.message });
        setData(null);
      } else if (!quiet) {
        setError(e?.message || 'Could not load your projects');
      }
    } finally {
      if (!quiet) setLoadingQueue(false);
    }
  }, [partyId, user]);

  useEffect(() => {
    if (!partyId || !user) return;
    void loadQueue();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void loadQueue(true); }, POLL_MS);
    const onFocus = () => void loadQueue(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [partyId, user, loadQueue]);

  // The selected project id, readable from async callbacks (a save that resolves after the
  // judge moved on must not overwrite the new project's panel).
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  useEffect(() => {
    // Drop the previous project's detail first: its scores must never sit on screen (with
    // Save enabled) under a different selected project while the new one loads.
    setDetail(null);
    if (!partyId || !selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    setError(null);
    hackathonJudgeApi.submission(partyId, selectedId)
      .then((r) => { if (!cancelled) setDetail(r); })
      .catch((e: any) => { if (!cancelled) { setError(e?.message || 'Could not load the project'); setSelectedId(null); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [partyId, selectedId]);

  const shown = useMemo(() => {
    const q = data?.queue ?? [];
    return trackFilter === 'all' ? q : q.filter((s) => s.trackIds.includes(trackFilter));
  }, [data, trackFilter]);

  const nextUnscored = useMemo(() => shown.find((s) => !s.scored && s.id !== selectedId) ?? null, [shown, selectedId]);

  /** Saves to the project the form was rendered for (never to whatever is selected now). */
  const save = useCallback(async (submissionId: string, body: ScoreInput): Promise<boolean> => {
    if (!partyId || submissionId !== selectedRef.current) return false;
    setSaving(true);
    setError(null);
    try {
      const res = await hackathonJudgeApi.score(partyId, submissionId, body);
      if (res.submission.id === selectedRef.current) setDetail(res);
      void loadQueue(true);
      return true;
    } catch (e: any) {
      setError(e?.message || 'Could not save your score');
      if (e?.code === 'JUDGING_CLOSED' || e?.code === 'JUDGING_NOT_OPEN') void loadQueue(true);
      return false;
    } finally {
      setSaving(false);
    }
  }, [partyId, loadQueue]);

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) window.scrollTo({ top: 0 });
  };

  // ------------------------------------------------------------ render

  const shell = (children: React.ReactNode) => (
    <Layout>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:py-10" data-testid="judge-page">{children}</main>
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
    </Layout>
  );

  const gate = (title: string, body: React.ReactNode, action?: React.ReactNode) => shell(
    <div className="card p-6 sm:p-8 text-center max-w-md mx-auto" data-testid="judge-gate">
      <Gavel className="w-10 h-10 mx-auto mb-3 text-theme-accent" />
      <h1 className="text-xl font-semibold text-theme-text">{title}</h1>
      <div className="text-sm text-theme-text-secondary mt-2">{body}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>,
  );

  if (eventError) return gate('Judge link not found', eventError);
  if (!event || authLoading) return shell(<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" /></div>);

  if (!user) {
    return gate(
      `Judge ${event.name}`,
      'Log in with the email the host added you with to see your projects.',
      <button type="button" className="btn-primary inline-flex items-center gap-2 min-h-[44px]" onClick={() => setShowLogin(true)}><LogIn size={16} /> Log in to judge</button>,
    );
  }

  if (accessError) {
    return gate(
      accessError.code === 'NOT_FOUND' ? 'No hackathon here' : accessError.code === 'JUDGE_REMOVED' ? 'Judging access removed' : "You're not a judge for this event",
      <>
        <p>{accessError.message}</p>
        {accessError.code === 'NOT_A_JUDGE' && <p className="mt-2 text-theme-text-muted">Logged in as {user.email}.</p>}
      </>,
      accessError.code === 'NOT_A_JUDGE'
        ? <button type="button" className="btn-secondary min-h-[44px]" onClick={() => { signOut(); setShowLogin(true); }}>Use a different email</button>
        : undefined,
    );
  }

  if (!data) {
    return shell(
      <div className="space-y-4">
        <ErrorBanner message={error} onClose={() => setError(null)} />
        <div className="flex justify-center py-16">{loadingQueue && <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />}</div>
      </div>,
    );
  }

  // Only ever render the detail of the project that is selected right now.
  const current = detail && selectedId && detail.submission.id === selectedId ? detail : null;
  const pct = data.progress.total ? Math.round((100 * data.progress.scored) / data.progress.total) : 0;
  const trackName = (id: string) => data.tracks.find((t) => t.id === id)?.name;

  const queuePanel = (
    <div className={`${selectedId ? 'hidden lg:block' : ''} space-y-3`} data-testid="judge-queue">
      {data.tracks.length > 1 && (
        <ChoicePills<string>
          ariaLabel="Track"
          value={trackFilter}
          onChange={setTrackFilter}
          options={[{ value: 'all', label: 'All tracks' }, ...data.tracks.map((t) => ({ value: t.id, label: t.name }))]}
        />
      )}
      {shown.length === 0 ? (
        <div className="card p-6 text-center text-sm text-theme-text-muted">
          {data.queue.length === 0 ? 'No submitted projects yet. This page refreshes on its own.' : 'No projects in this track.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((s) => {
            const active = s.id === selectedId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => select(s.id)}
                  aria-current={active ? 'true' : undefined}
                  data-testid="judge-queue-item"
                  className={`w-full text-left card p-3 flex items-center gap-3 min-h-[64px] border transition-colors ${active ? 'border-theme-accent' : 'border-transparent hover:border-theme-stroke-hover'}`}
                >
                  {s.cover?.url
                    ? <img src={s.cover.url} alt="" className="w-14 h-14 rounded-lg object-cover border border-theme-stroke shrink-0" />
                    : <div className="w-14 h-14 rounded-lg bg-theme-surface border border-theme-stroke shrink-0 flex items-center justify-center text-theme-text-faint"><Gavel size={18} /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-theme-text truncate">{s.name}</p>
                    {s.tagline && <p className="text-xs text-theme-text-secondary truncate">{s.tagline}</p>}
                    <p className="text-xs text-theme-text-muted truncate">
                      {[s.tableNumber && `Table ${s.tableNumber}`, s.teamName, s.trackIds.map(trackName).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {s.scored ? (
                    <span className="shrink-0 text-right">
                      <CheckCircle2 size={18} className="text-theme-success inline" aria-label="Scored" />
                      <span className="block text-xs text-theme-text-secondary tabular-nums">{s.myTotal === null ? '' : Math.round(s.myTotal)}</span>
                    </span>
                  ) : (
                    <Circle size={18} className="text-theme-text-faint shrink-0" aria-label="Not scored" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return shell(
    <div className="space-y-4">
      <div className="card p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-theme-text-muted font-semibold">Judging</p>
            <h1 className="text-lg sm:text-xl font-semibold text-theme-text break-words">{event.name}</h1>
            {data.judge.name && <p className="text-sm text-theme-text-secondary">Hi {data.judge.name}</p>}
          </div>
          <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            data.judgingStatus === 'open' ? 'border-theme-success text-theme-success' : 'border-theme-stroke text-theme-text-muted'
          }`} data-testid="judge-status">{STATUS_LABEL[data.judgingStatus]}</span>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-theme-text-secondary mb-1">
            <span>{data.progress.scored} of {data.progress.total} scored</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-theme-surface border border-theme-stroke overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-theme-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
        {data.blindJudging && (
          <p className="text-xs text-theme-text-muted mt-3 flex items-center gap-1.5"><EyeOff size={14} /> Blind judging: team names are hidden and links unlock after you score.</p>
        )}
        {data.judge.trackIds.length > 0 && (
          <p className="text-xs text-theme-text-muted mt-1 flex items-center gap-1.5"><Hash size={12} /> Your tracks: {data.tracks.map((t) => t.name).join(', ')}</p>
        )}
      </div>

      {!selectedId && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">
        {queuePanel}
        <div className={selectedId ? '' : 'hidden lg:block'}>
          {selectedId && !current ? (
            <div className="card p-6 flex justify-center" data-testid="judge-detail-loading">{detailLoading && <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />}</div>
          ) : current ? (
            <JudgeScoring
              key={current.submission.id}
              submission={current.submission}
              criteria={data.criteria}
              tracks={data.tracks}
              judgingStatus={data.judgingStatus}
              saving={saving}
              error={error}
              onDismissError={() => setError(null)}
              onSave={save}
              onBack={() => select(null)}
              onNext={nextUnscored ? () => select(nextUnscored.id) : null}
            />
          ) : (
            <div className="card p-6 text-center text-sm text-theme-text-muted">Pick a project to score it.</div>
          )}
        </div>
      </div>
    </div>,
  );
}

export default JudgePage;
