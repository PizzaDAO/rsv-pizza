import { useEffect, useMemo, useState } from 'react';
import { Hash, Medal, Tag, Trophy, Users } from 'lucide-react';
import {
  awardLabel,
  resolveDisplayMode,
  type DisplayHackathonData,
  type HackathonDisplayConfig,
} from '../../lib/hackathonGalleryApi';

/** Readable foreground for the host's background colour (displays default to black). */
export function foregroundFor(bg: string): { fg: string; muted: string; faint: string; dark: boolean } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((bg || '').trim());
  let hex = m ? m[1] : '000000';
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const dark = lum < 0.4;
  return dark
    ? { fg: '#ffffff', muted: 'rgba(255,255,255,0.72)', faint: 'rgba(255,255,255,0.18)', dark }
    : { fg: '#0e0e10', muted: 'rgba(14,14,16,0.68)', faint: 'rgba(14,14,16,0.14)', dark };
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Rotating index over `count` items, every `seconds`. Resets when the list changes size. */
function useRotation(count: number, seconds: number) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (count <= 1) return;
    const t = setInterval(() => setI((x) => (x + 1) % count), Math.max(3, seconds) * 1000);
    return () => clearInterval(t);
  }, [count, seconds]);
  return count ? i % count : 0;
}

function Qr({ url, label, fg }: { url: string; label: string; fg: string }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(url)}`;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="hk-display-qr">
      <div className="bg-white p-3 rounded-2xl"><img src={src} alt="" width={160} height={160} /></div>
      <p className="text-xl font-medium text-center max-w-[220px]" style={{ color: fg }}>{label}</p>
    </div>
  );
}

function Unit({ v, label, fg, muted }: { v: number; label: string; fg: string; muted: string }) {
  return (
    <div className="text-center min-w-[9vw]">
      <div className="font-mono font-bold leading-none tabular-nums" style={{ color: fg, fontSize: 'clamp(3rem, 9vw, 11rem)' }}>{String(v).padStart(2, '0')}</div>
      <div className="uppercase tracking-[0.2em] mt-3" style={{ color: muted, fontSize: 'clamp(0.9rem, 1.4vw, 1.6rem)' }}>{label}</div>
    </div>
  );
}

function Countdown({ data, fg, muted }: { data: DisplayHackathonData; fg: string; muted: string }) {
  const now = useNow(1000);
  const opens = data.submissionsOpenAt ? new Date(data.submissionsOpenAt).getTime() : null;
  const deadline = data.submissionDeadline ? new Date(data.submissionDeadline).getTime() : null;
  const beforeOpen = opens !== null && now < opens;
  const target = beforeOpen ? opens : deadline;
  const diff = target !== null ? target - now : null;

  let heading: string;
  let sub: string | null = null;
  if (diff !== null && diff > 0) heading = beforeOpen ? 'Submissions open in' : 'Submissions close in';
  else if (deadline !== null) {
    heading = 'Submissions are closed';
    sub = data.resultsRevealedAt ? 'The winners have been announced' : 'Judging is under way. Winners soon!';
  } else {
    heading = 'Hack on!';
    sub = 'Submit your project from the event page';
  }

  const d = diff && diff > 0 ? diff : 0;
  const days = Math.floor(d / 86_400_000);
  const hours = Math.floor((d / 3_600_000) % 24);
  const mins = Math.floor((d / 60_000) % 60);
  const secs = Math.floor((d / 1000) % 60);

  return (
    <div className="flex flex-col items-center gap-10 text-center" data-testid="hk-display-countdown">
      <div className="flex items-center gap-4" style={{ color: muted }}>
        <Trophy className="text-theme-accent" style={{ width: '3vw', height: '3vw' }} />
        <p className="font-semibold uppercase tracking-[0.25em]" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.4rem)' }}>Hackathon</p>
      </div>
      <h1 className="font-bold leading-tight" style={{ color: fg, fontSize: 'clamp(2.2rem, 5vw, 6rem)' }}>{heading}</h1>
      {d > 0 && (
        <div className="flex items-start gap-[3vw]">
          {days > 0 && <Unit v={days} label="days" fg={fg} muted={muted} />}
          <Unit v={hours} label="hours" fg={fg} muted={muted} />
          <Unit v={mins} label="min" fg={fg} muted={muted} />
          <Unit v={secs} label="sec" fg={fg} muted={muted} />
        </div>
      )}
      {sub && <p style={{ color: muted, fontSize: 'clamp(1.4rem, 2.6vw, 3rem)' }}>{sub}</p>}
    </div>
  );
}

function Empty({ text, fg, muted }: { text: string; fg: string; muted: string }) {
  return (
    <div className="text-center flex flex-col items-center gap-6" data-testid="hk-display-empty">
      <Trophy className="text-theme-accent" style={{ width: '5vw', height: '5vw' }} />
      <p className="font-semibold" style={{ color: fg, fontSize: 'clamp(2rem, 4vw, 4.5rem)' }}>{text}</p>
      <p style={{ color: muted, fontSize: 'clamp(1.2rem, 2vw, 2.2rem)' }}>Hang tight.</p>
    </div>
  );
}

function Showcase({ data, seconds, fg, muted, faint }: { data: DisplayHackathonData; seconds: number; fg: string; muted: string; faint: string }) {
  const i = useRotation(data.projects.length, seconds);
  const p = data.projects[i];
  const trackName = (id: string) => data.tracks.find((t) => t.id === id)?.name;
  if (!p) return null;
  return (
    <div className="w-full h-full flex flex-col px-[4vw] pt-[9vh] pb-[5vh] gap-[3vh]" data-testid="hk-display-gallery">
      <div className="flex-1 min-h-0 grid grid-cols-[1.25fr_1fr] gap-[3.5vw] items-center">
        <div className="w-full aspect-video max-h-full rounded-3xl overflow-hidden flex items-center justify-center" style={{ background: faint }}>
          {p.cover ? (
            <img key={p.cover} src={p.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="font-bold" style={{ color: muted, fontSize: '12vw' }}>{p.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-[2.5vh]">
          {p.awards.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {p.awards.map((a, k) => (
                <span key={k} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-theme-accent text-theme-accent font-semibold" style={{ fontSize: 'clamp(1rem, 1.5vw, 1.8rem)' }}>
                  <Medal style={{ width: '1.4vw', height: '1.4vw' }} /> {awardLabel(a)}
                </span>
              ))}
            </div>
          )}
          <h2 className="font-bold leading-tight break-words" style={{ color: fg, fontSize: 'clamp(2.4rem, 4.6vw, 6rem)' }}>{p.name}</h2>
          {p.tagline && <p className="leading-snug break-words" style={{ color: muted, fontSize: 'clamp(1.4rem, 2.3vw, 3rem)' }}>{p.tagline}</p>}
          <div className="flex flex-wrap gap-x-8 gap-y-3" style={{ color: muted, fontSize: 'clamp(1.1rem, 1.6vw, 2rem)' }}>
            {p.teamName && <span className="inline-flex items-center gap-2"><Users style={{ width: '1.6vw', height: '1.6vw' }} />{p.teamName}</span>}
            {p.trackIds.map(trackName).filter(Boolean).map((n) => (
              <span key={n} className="inline-flex items-center gap-2"><Tag style={{ width: '1.6vw', height: '1.6vw' }} />{n}</span>
            ))}
            {p.tableNumber && <span className="inline-flex items-center gap-2"><Hash style={{ width: '1.6vw', height: '1.6vw' }} />Table {p.tableNumber}</span>}
          </div>
        </div>
      </div>
      {data.projects.length > 1 && (
        <div className="flex items-center justify-center gap-4" style={{ color: muted, fontSize: 'clamp(1rem, 1.3vw, 1.6rem)' }}>
          <span className="tabular-nums">{i + 1} / {data.projects.length}</span>
          <div className="w-[30vw] h-1.5 rounded-full overflow-hidden" style={{ background: faint }}>
            <div className="h-full bg-theme-accent transition-all" style={{ width: `${((i + 1) / data.projects.length) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

const WINNERS_PER_PAGE = 6;

function Winners({ data, seconds, fg, muted, faint }: { data: DisplayHackathonData; seconds: number; fg: string; muted: string; faint: string }) {
  const pages = Math.max(1, Math.ceil(data.winners.length / WINNERS_PER_PAGE));
  const page = useRotation(pages, seconds);
  const shown = data.winners.slice(page * WINNERS_PER_PAGE, (page + 1) * WINNERS_PER_PAGE);
  const cols = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : 3;
  return (
    <div className="w-full h-full flex flex-col px-[4vw] pt-[9vh] pb-[5vh] gap-[4vh]" data-testid="hk-display-winners">
      <div className="flex items-center justify-center gap-4">
        <Trophy className="text-theme-accent" style={{ width: '4vw', height: '4vw' }} />
        <h1 className="font-bold" style={{ color: fg, fontSize: 'clamp(2.4rem, 4.5vw, 5.5rem)' }}>Winners</h1>
      </div>
      <div className="flex-1 min-h-0 grid gap-[2vw] content-center" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map((w, k) => (
          <div key={`${page}-${k}`} className="rounded-3xl p-[2vw] flex gap-[1.5vw] items-center min-w-0" style={{ background: faint }} data-testid="hk-display-winner">
            {w.cover && cols > 1 && <img src={w.cover} alt="" className="w-[9vw] h-[9vw] rounded-2xl object-cover shrink-0" />}
            <div className="min-w-0">
              <p className="text-theme-accent font-semibold uppercase tracking-wide break-words" style={{ fontSize: 'clamp(1rem, 1.5vw, 1.9rem)' }}>
                {awardLabel(w)}{w.prizeAmount ? ` · ${w.prizeAmount}` : ''}
              </p>
              <p className="font-bold leading-tight break-words mt-1" style={{ color: fg, fontSize: cols === 1 ? 'clamp(2.4rem, 5vw, 6rem)' : 'clamp(1.6rem, 2.6vw, 3.4rem)' }}>{w.projectName}</p>
              {w.teamName && <p className="break-words mt-1" style={{ color: muted, fontSize: 'clamp(1.1rem, 1.6vw, 2rem)' }}>{w.teamName}</p>}
            </div>
          </div>
        ))}
      </div>
      {pages > 1 && <p className="text-center tabular-nums" style={{ color: muted, fontSize: 'clamp(1rem, 1.3vw, 1.6rem)' }}>{page + 1} / {pages}</p>}
    </div>
  );
}

/**
 * `hackathon` TV display (plans/hackathon-platform.md §8, PR 6). Modes: countdown to the
 * deadline, rotating project showcase (once the gallery is public), winners (after the reveal);
 * `auto` picks the latest one that has something to show. Public data only; the page polls
 * every 30 s (DisplayPage). Colours follow the display background, accents the brand theme.
 */
export function HackathonDisplay({
  config,
  data,
  backgroundColor,
  rotationInterval,
  galleryUrl,
  eventUrl,
}: {
  config: HackathonDisplayConfig;
  data: DisplayHackathonData | null | undefined;
  backgroundColor: string;
  rotationInterval: number;
  galleryUrl: string;
  eventUrl: string;
}) {
  const colors = useMemo(() => foregroundFor(backgroundColor), [backgroundColor]);
  const { fg, muted, faint } = colors;
  if (!data) return <Empty text="The hackathon isn't public yet" fg={fg} muted={muted} />;

  const mode = resolveDisplayMode(config.mode, data);
  const showQr = config.showQr !== false;
  const qr = data.galleryOpen ? { url: galleryUrl, label: 'Browse all projects' } : { url: eventUrl, label: 'Join the hackathon' };

  let body: React.ReactNode;
  if (mode === 'winners') {
    body = data.resultsRevealedAt && data.winners.length
      ? <Winners data={data} seconds={rotationInterval} fg={fg} muted={muted} faint={faint} />
      : <Empty text="Winners will be announced soon" fg={fg} muted={muted} />;
  } else if (mode === 'gallery') {
    body = data.galleryOpen && data.projects.length
      ? <Showcase data={data} seconds={rotationInterval} fg={fg} muted={muted} faint={faint} />
      : <Empty text={data.galleryOpen ? 'No projects yet' : 'Projects appear here soon'} fg={fg} muted={muted} />;
  } else {
    body = <Countdown data={data} fg={fg} muted={muted} />;
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center" data-testid="hk-display" data-mode={mode}>
      {body}
      {showQr && mode !== 'gallery' && (
        <div className="absolute bottom-[4vh] right-[3vw]"><Qr url={qr.url} label={qr.label} fg={muted} /></div>
      )}
    </div>
  );
}
