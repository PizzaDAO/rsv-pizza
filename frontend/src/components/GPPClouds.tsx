import React, { useMemo } from 'react';

const CLOUDS = [
  // Layer 1 — large slow clouds
  { src: '/gpp-cloud-1.png', top: '5%', right: '-5%', width: 320, anim: 'cloud-drift-right 50s ease-in-out infinite', mdOnly: true },
  { src: '/gpp-cloud-2.png', top: '18%', left: '-3%', width: 200, anim: 'cloud-drift-left 40s ease-in-out infinite', mdOnly: true },
  { src: '/gpp-cloud-3.png', top: '35%', right: '10%', width: 140, anim: 'cloud-drift-right 55s ease-in-out infinite' },
  // Layer 2 — mid clouds
  { src: '/gpp-cloud-1.png', top: '50%', left: '-6%', width: 280, anim: 'cloud-drift-left 45s ease-in-out infinite', flip: true, mdOnly: true },
  { src: '/gpp-cloud-2.png', top: '65%', right: '5%', width: 160, anim: 'cloud-drift-right 38s ease-in-out infinite' },
  { src: '/gpp-cloud-3.png', top: '80%', left: '5%', width: 120, anim: 'cloud-drift-left 52s ease-in-out infinite' },
] as const;

/** Random opacity between 50-95%, stable for the component's lifetime. */
const randomOpacity = () => 0.5 + Math.random() * 0.45;

/**
 * Floating cloud decorations for GPP-themed pages.
 * Uses the same cloud PNGs as the GPP landing page.
 * Renders as fixed-position background elements that don't interfere with content.
 */
export const GPPClouds: React.FC = () => {
  const opacities = useMemo(() => CLOUDS.map(() => randomOpacity()), []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {CLOUDS.map((c, i) => (
        <img
          key={i}
          src={c.src}
          alt=""
          className={`absolute${c.mdOnly ? ' hidden md:block' : ''}`}
          style={{
            top: c.top,
            ...(c.right ? { right: c.right } : {}),
            ...(c.left ? { left: c.left } : {}),
            width: c.width,
            opacity: opacities[i],
            ...(c.flip ? { transform: 'scaleX(-1)' } : {}),
            animation: c.anim,
          }}
        />
      ))}
    </div>
  );
};
