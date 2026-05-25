import React from 'react';
import { Tv, Youtube } from 'lucide-react';
import { STREAM_YOUTUBE_URL, STREAM_X_URL } from '../../lib/dayOfConfig';

/**
 * Inline X (formerly Twitter) logo. Lucide ships the legacy bird as
 * `Twitter`, which is no longer X's brand mark — caciocavallo-71203
 * swapped it for the official "X" path.
 */
const XLogo: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

/**
 * prosciutto-78201: Day-of prompt for hosts to put the global PizzaDAO
 * livestream on a TV or projector at their venue. Universal (not GPP-gated)
 * — even non-GPP events may want to display the broader PizzaDAO stream
 * for the vibes; if a host has no screen they'll just ignore the card.
 *
 * porchetta-19384: Replaced the "link coming" placeholder with two real
 * buttons — YouTube + X — opening the public PizzaDAO stream URLs.
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

      <div className="flex flex-col md:flex-row gap-2">
        <a
          href={STREAM_YOUTUBE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-4 bg-[#ff0000] hover:bg-[#cc0000] transition-colors text-[#ffffff] font-semibold text-base"
        >
          <Youtube size={18} />
          Watch on YouTube
        </a>
        <a
          href={STREAM_X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-4 bg-black hover:bg-neutral-800 transition-colors text-[#ffffff] font-semibold text-base"
        >
          <XLogo size={18} />
          Watch on X
        </a>
      </div>

      <p className="text-xs text-white/40">
        Put one of these up on a TV or projector to share the global PizzaDAO
        stream at your event.
      </p>
    </div>
  );
};
