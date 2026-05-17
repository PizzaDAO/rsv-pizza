import React from 'react';

const CONTENT = (
  <>Find Other Cities at <span style={{ color: '#FE332C' }}>globalpizza.party</span></>
);

/**
 * Scrolling marquee banner that sits below the Header.
 * Right-to-left scroll, ~25s loop, pure CSS animation (defined in index.css).
 * Entire banner is a single link to globalpizza.party.
 */
export const MarqueeBanner: React.FC = () => {
  return (
    <a
      href="https://globalpizza.party"
      aria-label="Find Other Cities at globalpizza.party"
      className="block w-full overflow-hidden whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={{
        backgroundColor: '#0497C1',
        color: '#FFFFFF',
        height: '36px',
        lineHeight: '36px',
        fontSize: '18px',
      }}
    >
      <div className="marquee-track">
        <span className="marquee-item" aria-hidden="false">{CONTENT}</span>
        <span className="marquee-item" aria-hidden="true">{CONTENT}</span>
        <span className="marquee-item" aria-hidden="true">{CONTENT}</span>
        <span className="marquee-item" aria-hidden="true">{CONTENT}</span>
      </div>
    </a>
  );
};
