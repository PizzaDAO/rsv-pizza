/**
 * FakeDetectionBadge (bufalina-60733)
 *
 * Two-level caution badge for a GPP party's fake-detection risk score, shown
 * in the payments-admin by-city header pill strip next to the SWC Hub /
 * "Possible scam" pills.
 *
 * Renders NOTHING unless tier is `medium` (amber) or `high` (red) — clean/low
 * parties get no badge. Tooltip (native `title`) shows the score line plus the
 * top fired-flag details, one per line.
 *
 * v1 is a non-link span (no deep link into the underboss queue).
 */
import { AlertTriangle } from 'lucide-react';

export interface FakeDetectionBadgeProps {
  score: number;
  /** 'high' | 'medium' | 'low' | 'clean' — widened to string to match the
   *  compact server payload (`tier: string`). Anything but medium/high renders
   *  nothing. */
  tier: string;
  topFlags: string[];
  customUrl?: string | null;
}

export function FakeDetectionBadge({
  score,
  tier,
  topFlags,
}: FakeDetectionBadgeProps) {
  if (tier !== 'medium' && tier !== 'high') return null;

  const className =
    tier === 'high'
      ? 'inline-flex items-center gap-1 text-[11px] text-red-500 px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/40'
      : 'inline-flex items-center gap-1 text-[11px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30';

  const tooltip =
    `Fake-detection risk ${score}/100 (${tier})` +
    (topFlags.length > 0 ? '\n' + topFlags.map(f => `• ${f}`).join('\n') : '');

  return (
    <span className={className} title={tooltip}>
      <AlertTriangle size={11} />
      Risk {score} ({tier})
    </span>
  );
}
