import React from 'react';
import { Tv } from 'lucide-react';

/**
 * prosciutto-78201: Day-of prompt for hosts to put the global PizzaDAO
 * livestream on a TV or projector at their venue. Universal (not GPP-gated)
 * — even non-GPP events may want to display the broader PizzaDAO stream
 * for the vibes; if a host has no screen they'll just ignore the card.
 *
 * Placeholder state: the real stream URL is TBD. Until it lands, render
 * the same "Coming soon" disabled styling as BroadcastJoinCard so hosts
 * recognise the pattern. Snax will swap in the URL later.
 */
export const StreamOnScreenCard: React.FC = () => {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Tv size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">
          Put the stream on screen
        </h3>
      </div>

      <p className="text-sm text-theme-text-secondary">
        If you have a TV or projector at the venue, put the global PizzaDAO
        stream up on it so guests can feel the worldwide party.
      </p>

      <div
        aria-disabled="true"
        className="relative w-full rounded-xl py-4 px-4 text-center bg-[#ff393a]/40 opacity-60 cursor-not-allowed text-white"
      >
        <span className="flex items-center justify-center gap-2 font-semibold text-base">
          <Tv size={18} />
          Open the stream
        </span>
        <span className="block text-xs font-normal text-white/70 mt-1.5 leading-snug">
          A single shareable link to the GPP livestream — open it on the
          venue's screen.
        </span>
        <span className="absolute top-1.5 right-2 text-[10px] uppercase tracking-wider text-white/60 bg-black/40 rounded px-1.5 py-0.5">
          link coming
        </span>
      </div>
    </div>
  );
};
