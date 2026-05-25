import { useCallback, useState } from 'react';
import { drawProgressCard } from '../components/gpp-dashboard/ProgressCard';
import { getLeaderboardRank } from '../lib/api';
import type { Party, EventReport } from '../types';

/**
 * napoli-93184: Generate a 1200x630 PNG blob of the host-progress card.
 *
 * Awaits `document.fonts.ready` so the Hub 191 webfont is measurable before
 * drawing — otherwise the hero number renders with the fallback metric and
 * looks visually off-spec.
 */
export interface UseProgressCardImageResult {
  generate: (party: Party, report: EventReport) => Promise<Blob>;
  loading: boolean;
  error: Error | null;
}

export function useProgressCardImage(): UseProgressCardImageResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async (party: Party, report: EventReport): Promise<Blob> => {
    setLoading(true);
    setError(null);
    try {
      // Wait for fonts before measuring — Hub 191 Display uses font-display: swap.
      if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Non-fatal — fall back to system fonts.
        }
      }

      // Leaderboard rank (graceful null on auth-fail or 404).
      const rank = await getLeaderboardRank(party.id).catch(() => null);

      const canvas = document.createElement('canvas');
      await drawProgressCard(canvas, {
        party,
        totalRsvps: report.stats?.totalRsvps ?? 0,
        rank: rank ? { rank: rank.rank, total: rank.total } : null,
      });

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      if (!blob) throw new Error('Failed to encode progress card as PNG');
      return blob;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, loading, error };
}
