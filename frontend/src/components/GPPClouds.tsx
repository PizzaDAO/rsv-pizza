import React from 'react';

/**
 * Floating cloud decorations for GPP-themed pages.
 * Uses the same cloud PNGs as the GPP landing page.
 * Renders as fixed-position background elements that don't interfere with content.
 */
export const GPPClouds: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Layer 1 — large slow clouds */}
      <img src="/gpp-cloud-1.png" alt="" className="absolute hidden md:block" style={{ top: '5%', right: '-5%', width: 320, animation: 'cloud-drift-right 50s ease-in-out infinite' }} />
      <img src="/gpp-cloud-2.png" alt="" className="absolute hidden md:block" style={{ top: '18%', left: '-3%', width: 200, animation: 'cloud-drift-left 40s ease-in-out infinite' }} />
      <img src="/gpp-cloud-3.png" alt="" className="absolute" style={{ top: '35%', right: '10%', width: 140, animation: 'cloud-drift-right 55s ease-in-out infinite' }} />

      {/* Layer 2 — mid clouds */}
      <img src="/gpp-cloud-1.png" alt="" className="absolute hidden md:block" style={{ top: '50%', left: '-6%', width: 280, transform: 'scaleX(-1)', animation: 'cloud-drift-left 45s ease-in-out infinite' }} />
      <img src="/gpp-cloud-2.png" alt="" className="absolute" style={{ top: '65%', right: '5%', width: 160, animation: 'cloud-drift-right 38s ease-in-out infinite' }} />
      <img src="/gpp-cloud-3.png" alt="" className="absolute" style={{ top: '80%', left: '5%', width: 120, animation: 'cloud-drift-left 52s ease-in-out infinite' }} />
    </div>
  );
};
