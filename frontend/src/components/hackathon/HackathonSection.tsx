import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Trophy, Clock, Users, Tag, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { markdownRemarkPlugins } from '../../lib/safeMarkdown';
import { MarkdownBoundary } from '../ErrorBoundary';
import { getHackathon, prizeAmount, type PublicHackathon, type HackathonPrize } from '../../lib/hackathonApi';
import { ParticipantPanel } from './ParticipantPanel';

/** "2d 4h left" / "3h 12m left" / null when past. */
export function timeLeft(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  return `${h}h ${m % 60}m left`;
}

function formatWhen(iso: string, timezone?: string | null) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      ...(timezone ? { timeZone: timezone, timeZoneName: 'short' } : {}),
    });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function PrizeRow({ p }: { p: HackathonPrize }) {
  const amount = prizeAmount(p);
  return (
    <li className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-theme-text break-words min-w-0">
        {p.name}
        {p.quantity > 1 && <span className="text-theme-text-muted"> ×{p.quantity}</span>}
        {p.kind === 'peoples_choice' && !/people/i.test(p.name) && <span className="text-theme-text-muted"> · People's choice</span>}
      </span>
      {amount && <span className="text-theme-text font-semibold shrink-0">{amount}</span>}
    </li>
  );
}

/**
 * Public, read-only hackathon info on the event page (plans/hackathon-platform.md §8, PR 2).
 * Rendered only when the event payload says a published hackathon exists. The participant
 * panel (teams, project, PR 3) sits right under the deadline / team-size chips.
 */
export function HackathonSection({ partyId, timezone, initial }: { partyId: string; timezone?: string | null; initial?: PublicHackathon | null }) {
  const [hackathon, setHackathon] = useState<PublicHackathon | null>(initial ?? null);
  const [showRules, setShowRules] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    getHackathon(partyId)
      .then((res) => { if (!cancelled) setHackathon(res.hackathon as PublicHackathon | null); })
      .catch(() => { /* section just stays hidden */ });
    return () => { cancelled = true; };
  }, [partyId, initial]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!hackathon) return null;

  const left = timeLeft(hackathon.submissionDeadline, now);
  const deadlinePassed = !!hackathon.submissionDeadline && !left;
  const overall = hackathon.prizes.filter((p) => !p.trackId);
  const teamText = hackathon.teamMinSize === hackathon.teamMaxSize
    ? `Teams of ${hackathon.teamMaxSize}`
    : hackathon.teamMinSize <= 1
      ? `Solo or teams up to ${hackathon.teamMaxSize}`
      : `Teams of ${hackathon.teamMinSize}-${hackathon.teamMaxSize}`;

  return (
    <section className="border-t border-theme-stroke pt-6 mt-6" data-testid="hackathon-section" aria-labelledby="hackathon-heading">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={20} className="text-theme-accent" />
        <h2 id="hackathon-heading" className="text-lg font-semibold text-theme-text">Hackathon</h2>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {hackathon.submissionDeadline && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-theme-stroke bg-theme-surface text-sm text-theme-text">
            <Clock size={14} className="text-theme-text-muted" />
            {deadlinePassed ? 'Submissions closed' : `Submit by ${formatWhen(hackathon.submissionDeadline, timezone)}`}
          </span>
        )}
        {left && (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-theme-stroke bg-theme-surface text-sm text-theme-accent font-medium">
            {left}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-theme-stroke bg-theme-surface text-sm text-theme-text">
          <Users size={14} className="text-theme-text-muted" />
          {teamText}
        </span>
        {hackathon.eligibility === 'checked_in' && (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-theme-stroke bg-theme-surface text-sm text-theme-text-secondary">
            Check in at the event to submit
          </span>
        )}
      </div>

      <ParticipantPanel partyId={partyId} hackathon={hackathon} />

      {overall.length > 0 && (
        <div className="rounded-xl border border-theme-stroke bg-theme-surface p-4 mb-3">
          <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Prizes</p>
          <ul className="space-y-1.5">{overall.map((p) => <PrizeRow key={p.id} p={p} />)}</ul>
        </div>
      )}

      {hackathon.tracks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {hackathon.tracks.map((t) => {
            const prizes = hackathon.prizes.filter((p) => p.trackId === t.id);
            return (
              <div key={t.id} className="rounded-xl border border-theme-stroke bg-theme-surface p-4 min-w-0">
                <p className="text-sm font-semibold text-theme-text flex items-center gap-1.5 break-words">
                  <Tag size={14} className="text-theme-text-muted shrink-0" />{t.name}
                </p>
                {t.sponsorName && <p className="text-xs text-theme-text-muted mt-0.5">Sponsored by {t.sponsorName}</p>}
                {t.description && <p className="text-sm text-theme-text-secondary mt-1.5 break-words">{t.description}</p>}
                {prizes.length > 0 && <ul className="space-y-1 mt-2 pt-2 border-t border-theme-stroke">{prizes.map((p) => <PrizeRow key={p.id} p={p} />)}</ul>}
              </div>
            );
          })}
        </div>
      )}

      {hackathon.criteria.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-theme-text-secondary mb-3">
          <ListChecks size={16} className="text-theme-text-muted mt-0.5 shrink-0" />
          <span>Judged on {hackathon.criteria.map((c) => c.name).join(', ')}</span>
        </div>
      )}

      {hackathon.rules && (
        <div className="rounded-xl border border-theme-stroke">
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            aria-expanded={showRules}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-theme-text min-h-[44px]"
          >
            Rules
            {showRules ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showRules && (
            <div className="px-4 pb-4 text-sm text-theme-text-secondary prose prose-invert max-w-none break-words [overflow-wrap:anywhere]">
              <MarkdownBoundary text={hackathon.rules}>
                <ReactMarkdown
                  remarkPlugins={markdownRemarkPlugins}
                  components={{
                    a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow ugc" className="underline" />,
                    p: ({ node: _n, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                    ul: ({ node: _n, ...props }) => <ul {...props} className="list-disc list-inside mb-2 space-y-1" />,
                    ol: ({ node: _n, ...props }) => <ol {...props} className="list-decimal list-inside mb-2 space-y-1" />,
                  }}
                >
                  {hackathon.rules}
                </ReactMarkdown>
              </MarkdownBoundary>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
