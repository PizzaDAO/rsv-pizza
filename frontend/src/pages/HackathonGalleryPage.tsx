import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Eye, FolderOpen, Hash, Loader2, Medal, Tag, Users } from 'lucide-react';
import { Layout } from '../components/Layout';
import { ChoicePills } from '../components/hackathon/shared';
import { getEventBySlug, type PublicEvent } from '../lib/api';
import { awardLabel, getGallery, type GalleryProject, type GalleryResponse } from '../lib/hackathonGalleryApi';
import { BRAND } from '../config/brand';
import { VoteButton, VotingBanner, useVoting, type VotingHandle } from '../components/hackathon/VoteControls';
import { voteTrackFor } from '../lib/hackathonVotingApi';

export function GalleryShell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <Layout>
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:py-10 min-w-0" data-testid={testId}>{children}</main>
    </Layout>
  );
}

export function GalleryMessage({ title, body, back }: { title: string; body?: string; back?: { to: string; label: string } }) {
  return (
    <div className="card p-6 sm:p-8 text-center max-w-md mx-auto" data-testid="gallery-message">
      <FolderOpen size={28} className="mx-auto text-theme-text-muted mb-3" />
      <p className="text-lg font-semibold text-theme-text">{title}</p>
      {body && <p className="text-sm text-theme-text-secondary mt-2">{body}</p>}
      {back && <Link to={back.to} className="inline-block mt-4 text-sm text-theme-accent underline">{back.label}</Link>}
    </div>
  );
}

export function PreviewBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-theme-stroke bg-theme-surface px-4 py-3 mb-4 text-sm text-theme-text-secondary" data-testid="gallery-preview-banner">
      <Eye size={16} className="mt-0.5 shrink-0 text-theme-accent" />
      <span>{text}</span>
    </div>
  );
}

export function AwardBadge({ label, amount }: { label: string; amount?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-full text-xs font-semibold border border-theme-accent text-theme-accent bg-theme-surface" data-testid="project-award">
      <Medal size={12} className="shrink-0" />
      <span className="truncate">{label}{amount ? ` · ${amount}` : ''}</span>
    </span>
  );
}

/** Resolve /:slug (invite code, custom URL or alias) to the event, following alias redirects. */
export function useGalleryEvent(slug: string | undefined, suffix: (newSlug: string) => string) {
  const navigate = useNavigate();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setEvent(null);
    setMissing(false);
    getEventBySlug(slug)
      .then((r) => {
        if (cancelled) return;
        if (r && 'redirect' in r) navigate(suffix(r.slug), { replace: true });
        else if (!r) setMissing(true);
        else setEvent(r);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
    // suffix is a pure path builder; slug drives the lookup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, navigate]);
  return { event, missing };
}

export function closedCopy(g: Pick<GalleryResponse, 'opensAfter'> & { reason?: GalleryResponse['reason'] }): string {
  if (g.reason === 'login') return "Log in with the email you RSVP'd with to see projects.";
  if (g.opensAfter === 'deadline') return 'Projects show up here once submissions close.';
  if (g.opensAfter === 'reveal') return 'Projects show up here once the winners are announced.';
  return "The host hasn't published the project gallery.";
}

/** People's Choice vote button(s) under a card (PR 7): one per track when the scope is ambiguous. */
export function CardVotes({ v, p, filterTrackId, trackName }: { v: VotingHandle; p: Pick<GalleryProject, 'slug' | 'trackIds'>; filterTrackId: string | null; trackName: (id: string) => string | null }) {
  const scope = v.state?.voting?.scope ?? 'event';
  const t = voteTrackFor(scope, p.trackIds, filterTrackId);
  if (t !== undefined) return <VoteButton v={v} projectSlug={p.slug} trackId={t} label={scope === 'track' && t ? trackName(t) ?? undefined : undefined} compact />;
  return (
    <>
      {p.trackIds.map((id) => <VoteButton key={id} v={v} projectSlug={p.slug} trackId={id} label={trackName(id) ?? undefined} compact />)}
    </>
  );
}

function ProjectCard({ p, to, trackName, footer }: { p: GalleryProject; to: string; trackName: (id: string) => string | null; footer?: React.ReactNode }) {
  return (
    <li className="min-w-0 flex flex-col gap-2">
      <Link
        to={to}
        className="group flex flex-col h-full rounded-xl border border-theme-stroke bg-theme-surface overflow-hidden hover:border-theme-stroke-hover transition-colors"
        data-testid="gallery-card"
      >
        <div className="aspect-video bg-theme-surface-hover overflow-hidden">
          {p.cover ? (
            <img src={p.cover} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl font-semibold text-theme-text-muted">
              {p.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col gap-2 flex-1 min-w-0">
          {p.awards.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{p.awards.map((a, i) => <AwardBadge key={i} label={awardLabel(a)} />)}</div>
          )}
          <p className="text-base font-semibold text-theme-text break-words">{p.name}</p>
          {p.tagline && <p className="text-sm text-theme-text-secondary break-words line-clamp-2">{p.tagline}</p>}
          <div className="mt-auto pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-text-muted">
            {p.teamName && <span className="inline-flex items-center gap-1 min-w-0"><Users size={12} className="shrink-0" /><span className="truncate">{p.teamName}</span></span>}
            {p.trackIds.map((id) => trackName(id)).filter(Boolean).map((n) => (
              <span key={n} className="inline-flex items-center gap-1"><Tag size={12} />{n}</span>
            ))}
            {p.tableNumber && <span className="inline-flex items-center gap-1"><Hash size={12} />Table {p.tableNumber}</span>}
          </div>
        </div>
      </Link>
      {footer && <div className="flex flex-wrap gap-2 empty:hidden">{footer}</div>}
    </li>
  );
}

/**
 * Public project gallery (plans/hackathon-platform.md §8, PR 6): /:slug/projects. Visible per the
 * host's gallery setting (the server decides); hosts get a preview banner before it's public.
 */
export function HackathonGalleryPage() {
  const { slug } = useParams<{ slug: string }>();
  const { event, missing } = useGalleryEvent(slug, (s) => `/${s}/projects`);
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [error, setError] = useState(false);
  const [track, setTrack] = useState<string>('all');
  const voting = useVoting(event?.id);

  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    setData(null);
    setError(false);
    getGallery(event.id)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [event]);

  const trackNames = useMemo(() => new Map((data?.tracks ?? []).map((t) => [t.id, t.name])), [data]);
  const shown = useMemo(
    () => (data?.projects ?? []).filter((p) => track === 'all' || p.trackIds.includes(track)),
    [data, track],
  );

  const eventPath = `/${slug ?? ''}`;
  const title = event ? `Projects · ${event.name}` : 'Projects';

  return (
    <GalleryShell testId="hackathon-gallery-page">
      <Helmet>
        <title>{`${title} | ${BRAND.name}`}</title>
        {event && <meta name="description" content={`Hackathon projects from ${event.name}`} />}
      </Helmet>

      {missing ? (
        <GalleryMessage title="Event not found" body="Check the link and try again." />
      ) : !event || (!data && !error) ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" /></div>
      ) : error ? (
        <GalleryMessage title="Couldn't load the projects" body="Please refresh the page." back={{ to: eventPath, label: 'Back to the event' }} />
      ) : !data!.available ? (
        <GalleryMessage title="Projects aren't public yet" body={closedCopy(data!)} back={{ to: eventPath, label: 'Back to the event' }} />
      ) : (
        <>
          <Link to={eventPath} className="inline-flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text mb-4 min-h-[44px]">
            <ArrowLeft size={16} /> {event.name}
          </Link>
          {data!.preview && <PreviewBanner text={`Host preview: the public can't see this gallery yet. ${closedCopy(data!)}`} />}
          <VotingBanner v={voting} />
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-theme-text break-words">Projects</h1>
              <p className="text-sm text-theme-text-secondary mt-1">
                {data!.projects.length} project{data!.projects.length === 1 ? '' : 's'}
                {data!.resultsRevealedAt ? ' · winners announced' : ''}
              </p>
            </div>
          </div>
          {data!.tracks.length > 1 && (
            <div className="mb-5">
              <ChoicePills
                ariaLabel="Filter by track"
                value={track}
                onChange={setTrack}
                options={[{ value: 'all', label: 'All tracks' }, ...data!.tracks.map((t) => ({ value: t.id, label: t.name }))]}
              />
            </div>
          )}
          {shown.length === 0 ? (
            <GalleryMessage title={data!.projects.length ? 'No projects in this track' : 'No projects yet'} />
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="gallery-grid">
              {shown.map((p) => (
                <ProjectCard
                  key={p.slug}
                  p={p}
                  to={`/${slug}/projects/${p.slug}`}
                  trackName={(id) => trackNames.get(id) ?? null}
                  footer={<CardVotes v={voting} p={p} filterTrackId={track === 'all' ? null : track} trackName={(id) => trackNames.get(id) ?? null} />}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </GalleryShell>
  );
}
