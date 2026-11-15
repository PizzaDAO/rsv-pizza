import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ExternalLink, Github, Globe, Hash, Loader2, Presentation, Tag, Users, Video } from 'lucide-react';
import { markdownRemarkPlugins } from '../lib/safeMarkdown';
import { MarkdownBoundary } from '../components/ErrorBoundary';
import { STATUS_LABEL } from '../lib/hackathonApi';
import { awardLabel, getProject, linkHost, videoEmbedUrl, type ProjectResponse } from '../lib/hackathonGalleryApi';
import { BRAND } from '../config/brand';
import { AwardBadge, CardVotes, GalleryMessage, GalleryShell, PreviewBanner, closedCopy, useGalleryEvent } from './HackathonGalleryPage';
import { VotingBanner, useVoting } from '../components/hackathon/VoteControls';

const REL = 'noopener noreferrer nofollow ugc';

function LinkChip({ href, icon: Icon, label }: { href: string; icon: typeof Globe; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel={REL}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-theme-stroke bg-theme-surface text-sm text-theme-text hover:border-theme-stroke-hover min-h-[44px] max-w-full"
      data-testid="project-link"
    >
      <Icon size={16} className="shrink-0 text-theme-text-muted" />
      <span className="font-medium shrink-0">{label}</span>
      <span className="text-theme-text-muted truncate min-w-0">{linkHost(href)}</span>
      <ExternalLink size={12} className="shrink-0 text-theme-text-muted" />
    </a>
  );
}

/**
 * Public project page (plans/hackathon-platform.md §8, PR 6): /:slug/projects/:projectSlug.
 * The server only returns it when the viewer may see it (open gallery + submitted, or a preview
 * for the host / the project's own team); anything else is a 404 here too.
 */
export function HackathonProjectPage() {
  const { slug, projectSlug } = useParams<{ slug: string; projectSlug: string }>();
  const { event, missing } = useGalleryEvent(slug, (s) => `/${s}/projects/${projectSlug ?? ''}`);
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [shot, setShot] = useState(0);
  const voting = useVoting(event?.id);

  useEffect(() => {
    if (!event || !projectSlug) return;
    let cancelled = false;
    setData(null);
    setNotFound(false);
    setShot(0);
    getProject(event.id, projectSlug)
      .then((r) => { if (!cancelled) setData(r); })
      .catch(() => { if (!cancelled) setNotFound(true); });
    return () => { cancelled = true; };
  }, [event, projectSlug]);

  const galleryPath = `/${slug ?? ''}/projects`;
  const p = data?.project;
  const embed = videoEmbedUrl(p?.links.demoVideoUrl ?? null);
  const images = p ? [...(p.cover ? [p.cover] : []), ...p.screenshots] : [];
  const trackName = (id: string) => data?.tracks.find((t) => t.id === id)?.name ?? null;

  return (
    <GalleryShell testId="hackathon-project-page">
      <Helmet>
        <title>{`${p ? p.name : 'Project'}${event ? ` · ${event.name}` : ''} | ${BRAND.name}`}</title>
        {p?.tagline && <meta name="description" content={p.tagline} />}
      </Helmet>

      {missing ? (
        <GalleryMessage title="Event not found" body="Check the link and try again." />
      ) : notFound ? (
        <GalleryMessage title="Project not found" body="It may not be public yet." back={{ to: galleryPath, label: 'All projects' }} />
      ) : !p ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" /></div>
      ) : (
        <article className="max-w-4xl mx-auto min-w-0">
          <Link to={galleryPath} className="inline-flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text mb-4 min-h-[44px]">
            <ArrowLeft size={16} /> All projects
          </Link>

          {data!.preview && (
            <PreviewBanner
              text={`Preview${p.status ? ` (${STATUS_LABEL[p.status] ?? p.status})` : ''}: the public can't see this page yet.${
                p.status === 'submitted' ? ` ${closedCopy(data!)}` : ' Only submitted projects appear in the gallery.'
              }`}
            />
          )}

          {p.awards.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">{p.awards.map((a, i) => <AwardBadge key={i} label={awardLabel(a)} amount={a.prizeAmount} />)}</div>
          )}
          <h1 className="text-2xl sm:text-4xl font-bold text-theme-text break-words">{p.name}</h1>
          {p.tagline && <p className="text-base sm:text-lg text-theme-text-secondary mt-2 break-words">{p.tagline}</p>}

          {!data!.preview && (
            <div className="mt-4" data-testid="project-voting">
              <VotingBanner v={voting} />
              <div className="flex flex-wrap gap-2 -mt-1 empty:hidden">
                <CardVotes v={voting} p={p} filterTrackId={null} trackName={trackName} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm text-theme-text-muted">
            {p.teamName && <span className="inline-flex items-center gap-1.5 min-w-0"><Users size={14} className="shrink-0" /><span className="break-words">{p.teamName}</span></span>}
            {p.trackIds.map(trackName).filter(Boolean).map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5"><Tag size={14} />{n}</span>
            ))}
            {p.tableNumber && <span className="inline-flex items-center gap-1.5"><Hash size={14} />Table {p.tableNumber}</span>}
          </div>

          {images.length > 0 && (
            <div className="mt-6" data-testid="project-images">
              <div className="aspect-video rounded-xl overflow-hidden border border-theme-stroke bg-theme-surface">
                <img src={images[Math.min(shot, images.length - 1)]} alt={`${p.name} screenshot`} className="w-full h-full object-contain" />
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {images.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setShot(i)}
                      aria-label={`Show image ${i + 1}`}
                      aria-pressed={i === shot}
                      className={`shrink-0 w-24 h-14 rounded-lg overflow-hidden border-2 ${i === shot ? 'border-theme-accent' : 'border-theme-stroke'}`}
                    >
                      <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {(p.links.repoUrl || p.links.demoVideoUrl || p.links.deckUrl || p.links.liveUrl) && (
            <div className="flex flex-wrap gap-2 mt-6">
              {p.links.liveUrl && <LinkChip href={p.links.liveUrl} icon={Globe} label="Live" />}
              {p.links.repoUrl && <LinkChip href={p.links.repoUrl} icon={Github} label="Code" />}
              {p.links.demoVideoUrl && !embed && <LinkChip href={p.links.demoVideoUrl} icon={Video} label="Demo" />}
              {p.links.deckUrl && <LinkChip href={p.links.deckUrl} icon={Presentation} label="Deck" />}
            </div>
          )}

          {embed && (
            <div className="mt-6 aspect-video rounded-xl overflow-hidden border border-theme-stroke bg-black">
              <iframe
                src={embed}
                title={`${p.name} demo video`}
                className="w-full h-full"
                allow="encrypted-media; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                loading="lazy"
              />
            </div>
          )}

          {p.description && (
            <div className="mt-6 text-sm sm:text-base text-theme-text-secondary prose prose-invert max-w-none break-words [overflow-wrap:anywhere]" data-testid="project-description">
              <MarkdownBoundary text={p.description}>
                <ReactMarkdown
                  remarkPlugins={markdownRemarkPlugins}
                  components={{
                    a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel={REL} className="underline" />,
                    // No remote images in project text (tracking pixels); show the alt text instead.
                    img: ({ node: _n, alt }) => <span>{alt}</span>,
                    p: ({ node: _n, ...props }) => <p {...props} className="mb-3 last:mb-0" />,
                    ul: ({ node: _n, ...props }) => <ul {...props} className="list-disc list-inside mb-3 space-y-1" />,
                    ol: ({ node: _n, ...props }) => <ol {...props} className="list-decimal list-inside mb-3 space-y-1" />,
                  }}
                >
                  {p.description}
                </ReactMarkdown>
              </MarkdownBoundary>
            </div>
          )}

          {p.members.length > 0 && (
            <div className="mt-8">
              <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Team</p>
              <ul className="flex flex-wrap gap-3">
                {p.members.map((m, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-2 rounded-full border border-theme-stroke bg-theme-surface min-w-0">
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-theme-surface-hover flex items-center justify-center text-xs font-semibold text-theme-text-secondary shrink-0">
                        {m.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm text-theme-text truncate">{m.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </GalleryShell>
  );
}
