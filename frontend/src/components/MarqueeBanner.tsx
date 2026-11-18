import React, { useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { IS_SERIES_SCOPED } from '../config/brandScope';

/** Create / auth / host-side pages where promoting other cities is a distraction. */
const HIDDEN_PREFIXES = [
  '/new', '/login', '/auth', '/link', '/host', '/run', '/checkin', '/dj', '/judge',
  '/gpp27', '/side', '/brand-admin', '/account',
];

export function isMarqueeHiddenPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return HIDDEN_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

const Content: React.FC<{ lead: string }> = ({ lead }) => (
  <>
    <span style={{ color: '#FFFFFF', opacity: 0.8 }}>{lead} </span>
    <span style={{ color: '#FFFFFF' }}>globalpizza.party</span>
  </>
);

// One "set" contains enough copies of the text that it will overflow any
// reasonable viewport width on its own. The track renders TWO identical
// sets, and the CSS animation translates the track by -50% (= exactly one
// full set), so when the loop restarts the second set is in exactly the
// position the first set started in. Result: a perfectly seamless loop.
const SET_COPIES = 6;

const Set: React.FC<{ ariaHidden?: boolean; lead: string }> = ({ ariaHidden, lead }) => (
  <span className="marquee-set" aria-hidden={ariaHidden ? 'true' : 'false'}>
    {Array.from({ length: SET_COPIES }).map((_, i) => (
      <span key={i} className="marquee-item">
        <Content lead={lead} />
      </span>
    ))}
  </span>
);

/**
 * Scrolling marquee banner that sits below the Header.
 * Right-to-left infinite scroll, pure CSS animation (defined in index.css).
 * Entire banner is a single link to globalpizza.party.
 *
 * Uses the two-track pattern: the inner track contains exactly two identical
 * sets of repeated text and animates from translateX(0) to translateX(-50%).
 * Because -50% equals exactly one set's width, the loop restart is invisible.
 */
export const MarqueeBanner: React.FC = () => {
  const { pathname } = useLocation();
  const { t } = useTranslation('common');
  const [paused, setPaused] = useState(false);
  // White-label series builds: this promotes PizzaDAO's GPP site; hide it.
  if (IS_SERIES_SCOPED || isMarqueeHiddenPath(pathname)) return null;
  const lead = t('banner.findCities');
  return (
    <div
      className={`marquee-banner flex w-full items-stretch${paused ? ' marquee-paused' : ''}`}
      style={{ backgroundColor: '#0497C1', color: '#FFFFFF', height: '36px', lineHeight: '36px', fontSize: '16px' }}
    >
      <a
        href="https://globalpizza.party"
        aria-label={`${lead} globalpizza.party`}
        className="block flex-1 min-w-0 overflow-hidden whitespace-nowrap font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <div className="marquee-track">
          <Set lead={lead} />
          <Set lead={lead} ariaHidden />
        </div>
      </a>
      {/* WCAG 2.2.2: moving content can be paused. Hidden when the user prefers reduced motion (static). */}
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? t('banner.play') : t('banner.pause')}
        aria-pressed={paused}
        className="marquee-pause-btn shrink-0 px-3 flex items-center justify-center hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </div>
  );
};
