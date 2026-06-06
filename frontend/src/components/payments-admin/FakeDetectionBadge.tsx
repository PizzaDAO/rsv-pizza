/**
 * FakeDetectionBadge (bufalina-60733; clickable popover bresaola-58502)
 *
 * Two-level caution badge for a GPP party's fake-detection risk score, shown
 * in the payments-admin by-city header pill strip next to the SWC Hub /
 * "Possible scam" pills.
 *
 * Renders NOTHING unless tier is `medium` (amber) or `high` (red) — clean/low
 * parties get no badge.
 *
 * The pill is a button: clicking it opens a small popover (portaled to
 * document.body so the table cells + Layout's `relative z-[1]` <main> don't
 * clip it) listing every fired fake-detection flag with its weight. Falls back
 * to `topFlags` (detail only) when the backend hasn't yet shipped the weighted
 * `flags` array (preview frontends hit the prod backend).
 *
 * No deep link into the underboss queue (out of scope).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

export interface FakeDetectionBadgeProps {
  score: number;
  /** 'high' | 'medium' | 'low' | 'clean' — widened to string to match the
   *  compact server payload (`tier: string`). Anything but medium/high renders
   *  nothing. */
  tier: string;
  topFlags: string[];
  flags?: { detail: string; weight: number }[];
  customUrl?: string | null;
}

const POPOVER_WIDTH = 288; // w-72 = 18rem = 288px

export function FakeDetectionBadge({
  score,
  tier,
  topFlags,
  flags,
}: FakeDetectionBadgeProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position the popover just below-left of the pill, clamped to the viewport.
  useEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8),
    );
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  // Close on outside click, Escape, scroll, or resize.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (tier !== 'medium' && tier !== 'high') return null;

  const isHigh = tier === 'high';

  const className =
    (isHigh
      ? 'inline-flex items-center gap-1 text-[11px] text-red-500 px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/40'
      : 'inline-flex items-center gap-1 text-[11px] text-amber-300 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30') +
    ' cursor-pointer focus:outline-none focus:ring-1 focus:ring-white/40';

  const iconColor = isHigh ? 'text-red-500' : 'text-amber-300';
  const hasWeighted = Array.isArray(flags) && flags.length > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <AlertTriangle size={11} />
        Risk {score} ({tier})
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-50 w-72 rounded-lg border border-white/10 bg-zinc-900 text-theme-text shadow-xl p-3 text-xs"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className={`flex items-center gap-1.5 font-medium mb-2 ${iconColor}`}>
              <AlertTriangle size={13} />
              Risk {score} ({tier})
            </div>
            {hasWeighted ? (
              <ul className="space-y-1">
                {flags!.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-2"
                  >
                    <span className="text-white/80">{f.detail}</span>
                    <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[10px] text-white/60">
                      +{f.weight}
                    </span>
                  </li>
                ))}
              </ul>
            ) : topFlags.length > 0 ? (
              <ul className="space-y-1">
                {topFlags.map((f, i) => (
                  <li key={i} className="text-white/80">
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-white/40">No flag details available.</div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
