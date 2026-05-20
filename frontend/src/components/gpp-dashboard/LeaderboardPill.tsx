import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Medal } from 'lucide-react';
import { getLeaderboardRank } from '../../lib/api';

interface LeaderboardPillProps {
  partyId: string;
  metric?: string;
}

interface RankData {
  rank: number;
  total: number;
  topPercent: number;
  scope: 'gpp-season' | 'gpp-all';
}

/**
 * quattro-71244: leaderboard rank pill.
 * Renders nothing on auth-fail / 404 (`getLeaderboardRank` returns null).
 * Shows a brief skeleton while loading.
 */
export const LeaderboardPill: React.FC<LeaderboardPillProps> = ({ partyId, metric = 'totalRsvps' }) => {
  const { t } = useTranslation('host');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RankData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    getLeaderboardRank(partyId, metric).then(result => {
      if (cancelled) return;
      setData(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [partyId, metric]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-theme-card border border-theme-stroke text-xs text-theme-text-faint">
        <span className="inline-block w-2 h-2 rounded-full bg-theme-text-faint/40 animate-pulse" />
        <span className="inline-block w-24 h-3 rounded bg-theme-text-faint/20 animate-pulse" />
      </div>
    );
  }

  if (!data || data.total === 0) return null;

  const scopeLabel = t('dashboard.kpis.leaderboardScopeGpp');
  const showTopPct = data.topPercent > 0 && data.topPercent <= 10;

  return (
    <div className="inline-flex flex-col gap-0.5">
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-theme-card border border-[#ff393a]/60 text-xs text-theme-text self-start shadow-sm">
        <Medal size={12} className="text-[#ff393a]" />
        <span>
          {t('dashboard.kpis.leaderboardRank', {
            rank: data.rank,
            total: data.total,
            scope: scopeLabel,
          })}
        </span>
      </div>
      {showTopPct && (
        <span className="text-[10px] text-theme-text-faint pl-1">
          {t('dashboard.kpis.leaderboardTopPct', { percent: data.topPercent, metric })}
        </span>
      )}
    </div>
  );
};
