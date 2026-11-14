import { Link } from 'react-router-dom';
import { Medal, Tag } from 'lucide-react';
import { ordinal, type PublicWinner } from '../../lib/hackathonApi';

/**
 * Public winners on the event page (plans/hackathon-platform.md §8, PR 5). Only rendered after
 * the host reveals results; the API never sends recipients or payout data.
 */
export function WinnersStrip({ winners, quantities, projectHref }: {
  winners: PublicWinner[];
  quantities?: Record<string, number>;
  /** PR 6: link each winner to its project page (only passed while the gallery is open). */
  projectHref?: (projectSlug: string) => string;
}) {
  if (!winners.length) return null;
  return (
    <div className="mb-4" data-testid="hackathon-winners">
      <p className="text-sm font-semibold text-theme-text flex items-center gap-2 mb-2">
        <Medal size={16} className="text-theme-accent" /> Winners
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {winners.map((w, i) => {
          const multi = (quantities?.[w.prizeId] ?? 1) > 1;
          return (
            <li key={`${w.prizeId}-${i}`} className="rounded-xl border border-theme-stroke bg-theme-surface p-4 min-w-0" data-testid="hackathon-winner">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs uppercase tracking-wide text-theme-accent font-semibold break-words min-w-0">
                  {w.prizeName}{multi && w.place ? ` · ${ordinal(w.place)}` : ''}
                </p>
                {w.prizeAmount && <span className="text-sm font-semibold text-theme-text shrink-0">{w.prizeAmount}</span>}
              </div>
              <p className="text-base font-semibold text-theme-text mt-1 break-words">
                {projectHref && w.projectSlug ? <Link to={projectHref(w.projectSlug)} className="hover:underline">{w.projectName}</Link> : w.projectName}
              </p>
              {w.projectTagline && <p className="text-sm text-theme-text-secondary break-words">{w.projectTagline}</p>}
              <p className="text-xs text-theme-text-muted mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {w.teamName && <span className="break-words">{w.teamName}</span>}
                {w.trackName && <span className="inline-flex items-center gap-1"><Tag size={12} /> {w.trackName}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
