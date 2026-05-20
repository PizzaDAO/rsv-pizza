import React from 'react';
import { Radio, Video, Smartphone, ExternalLink } from 'lucide-react';
import {
  ZOOM_URL,
  STREAMYARD_URL,
  isBroadcastUrlReady,
} from '../../lib/dayOfConfig';

interface BroadcastJoinCardProps {
  /** Layout hint from DayOfDashboard. Mobile stacks the buttons; desktop puts them side-by-side. */
  layout?: 'desktop' | 'mobile';
}

interface BroadcastButtonProps {
  url: string;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}

const BroadcastButton: React.FC<BroadcastButtonProps> = ({
  url,
  label,
  subtitle,
  icon,
}) => {
  const ready = isBroadcastUrlReady(url);

  const inner = (
    <>
      <span className="flex items-center justify-center gap-2 font-semibold text-base">
        {icon}
        {label}
        {ready && <ExternalLink size={14} className="opacity-70" />}
      </span>
      <span className="block text-xs font-normal text-white/70 mt-1.5 leading-snug">
        {subtitle}
      </span>
      {!ready && (
        <span className="absolute top-1.5 right-2 text-[10px] uppercase tracking-wider text-white/60 bg-black/40 rounded px-1.5 py-0.5">
          Coming soon
        </span>
      )}
    </>
  );

  const baseClasses =
    'relative flex-1 rounded-xl py-4 px-4 text-white text-center transition-opacity';

  if (!ready) {
    return (
      <div
        aria-disabled="true"
        className={`${baseClasses} bg-[#ff393a]/40 opacity-60 cursor-not-allowed`}
      >
        {inner}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${baseClasses} bg-[#ff393a] hover:bg-[#ff5a5b]`}
    >
      {inner}
    </a>
  );
};

/**
 * GPP-only broadcast launcher. Two equal-weight buttons (Zoom static cam,
 * StreamYard phone). URLs live in lib/dayOfConfig.ts. While URLs are
 * TODO_*, both render disabled with a "Coming soon" badge. Visibility
 * gate (isGpp) is the caller's job (DayOfDashboard).
 */
export const BroadcastJoinCard: React.FC<BroadcastJoinCardProps> = ({ layout }) => {
  const isMobile = layout === 'mobile';

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Radio size={18} className="text-[#ff393a]" />
        <h3 className="text-lg font-semibold text-theme-text">
          Join the global PizzaDAO broadcast
        </h3>
      </div>

      <p className="text-sm text-theme-text-secondary">
        Plug your party into the worldwide GPP livestream.
      </p>

      <div className={isMobile ? 'flex flex-col gap-3' : 'flex flex-col sm:flex-row gap-3'}>
        <BroadcastButton
          url={ZOOM_URL}
          label="Join Zoom (static camera)"
          subtitle="Set up a laptop on a tripod with a wide shot of the venue — leave it running."
          icon={<Video size={18} />}
        />
        <BroadcastButton
          url={STREAMYARD_URL}
          label="Join StreamYard (phone)"
          subtitle="Open this on your phone for live interviews and walkaround shots."
          icon={<Smartphone size={18} />}
        />
      </div>
    </div>
  );
};
