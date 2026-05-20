import React, { useEffect, useState } from 'react';
import { Radio, Video, Smartphone, ExternalLink } from 'lucide-react';
import { isBroadcastUrlReady } from '../../lib/dayOfConfig';
import { fetchBroadcastUrls } from '../../lib/api';

interface BroadcastJoinCardProps {
  /** Party ID — used to fetch approval-gated broadcast URLs from the backend. */
  partyId: string;
  /** Layout hint from DayOfDashboard. Mobile stacks the buttons; desktop puts them side-by-side. */
  layout?: 'desktop' | 'mobile';
}

interface BroadcastButtonProps {
  url: string | null;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  /** Loading state: render the button greyed out with "Loading..." badge. */
  loading?: boolean;
  /** Reason the URL isn't usable, surfaced in the corner badge. */
  unavailableLabel?: string;
}

const BroadcastButton: React.FC<BroadcastButtonProps> = ({
  url,
  label,
  subtitle,
  icon,
  loading,
  unavailableLabel,
}) => {
  const ready = !loading && isBroadcastUrlReady(url);
  const badgeLabel = loading ? 'Loading…' : unavailableLabel || 'Coming soon';

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
          {badgeLabel}
        </span>
      )}
    </>
  );

  const baseClasses =
    'relative flex-1 rounded-xl py-4 px-4 text-white text-center transition-opacity';

  if (!ready || !url) {
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
 * StreamYard phone). URLs are fetched from an approval-gated backend endpoint
 * (parmigiano-58729) so they never ship in the client bundle. Visibility
 * gate (isGpp) is the caller's job (DayOfDashboard).
 *
 * States:
 *  - Loading                  → both buttons greyed with "Loading..." badge.
 *  - eligible:false / error   → "Not available for this event" badge.
 *  - eligible:true + no URLs  → "Coming soon" badge (env vars unset).
 *  - eligible:true + URLs     → active buttons that open in a new tab.
 */
export const BroadcastJoinCard: React.FC<BroadcastJoinCardProps> = ({ partyId, layout }) => {
  // ---- HOOKS (all above any early return) -------------------------------
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [streamyardUrl, setStreamyardUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    fetchBroadcastUrls(partyId)
      .then((res) => {
        if (cancelled) return;
        setEligible(res.eligible);
        setZoomUrl(res.zoomUrl);
        setStreamyardUrl(res.streamyardUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [partyId]);

  const isMobile = layout === 'mobile';
  const unavailableLabel =
    error || !eligible ? 'Not available for this event' : undefined;

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
          url={eligible ? zoomUrl : null}
          label="Join Zoom (static camera)"
          subtitle="Set up a laptop on a tripod with a wide shot of the venue — leave it running."
          icon={<Video size={18} />}
          loading={loading}
          unavailableLabel={unavailableLabel}
        />
        <BroadcastButton
          url={eligible ? streamyardUrl : null}
          label="Join StreamYard (phone)"
          subtitle="Open this on your phone for live interviews and walkaround shots."
          icon={<Smartphone size={18} />}
          loading={loading}
          unavailableLabel={unavailableLabel}
        />
      </div>
    </div>
  );
};
