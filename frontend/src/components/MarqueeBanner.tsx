import React from 'react';

const CONTENT = (
  <>
    <span style={{ color: '#FFFFFF', opacity: 0.8 }}>Find other cities at </span>
    <span style={{ color: '#FFFFFF' }}>globalpizza.party</span>
  </>
);

// One "set" contains enough copies of the text that it will overflow any
// reasonable viewport width on its own. The track renders TWO identical
// sets, and the CSS animation translates the track by -50% (= exactly one
// full set), so when the loop restarts the second set is in exactly the
// position the first set started in. Result: a perfectly seamless loop.
const SET_COPIES = 6;

const Set: React.FC<{ ariaHidden?: boolean }> = ({ ariaHidden }) => (
  <span className="marquee-set" aria-hidden={ariaHidden ? 'true' : 'false'}>
    {Array.from({ length: SET_COPIES }).map((_, i) => (
      <span key={i} className="marquee-item">
        {CONTENT}
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
  return (
    <a
      href="https://globalpizza.party"
      aria-label="Find other cities at globalpizza.party"
      className="block w-full overflow-hidden whitespace-nowrap font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={{
        backgroundColor: '#0497C1',
        color: '#FFFFFF',
        height: '36px',
        lineHeight: '36px',
        fontSize: '18px',
      }}
    >
      <div className="marquee-track">
        <Set />
        <Set ariaHidden />
      </div>
    </a>
  );
};
