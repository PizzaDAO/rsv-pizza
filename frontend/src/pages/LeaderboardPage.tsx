import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Trophy, MapPin, Users, CheckCircle2, Image as ImageIcon, Send } from 'lucide-react';
import { Layout } from '../components/Layout';
import {
  fetchLeaderboard,
  LeaderboardResponse,
  LeaderboardPartyRow,
  LeaderboardCountryRow,
  LeaderboardWindow,
} from '../lib/api';

// stromboli-71593: public leaderboard page rendered at both `/leaderboard`
// and `/gpp/leaderboard`. Single data fetch hydrates both tabs (parties +
// countries) — no realtime subscriptions, fetched on mount + tab change.

type TabKey = 'parties' | 'countries';

const PAGE_SIZE = 50;
const MAX_LIMIT = 200;

function CountryFlag({ code }: { code: string | null }) {
  if (!code) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-4 rounded-sm bg-white/10 text-[8px] text-white/50">
        ??
      </span>
    );
  }
  const lower = code.toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/${lower}.svg`}
      alt={code}
      width={24}
      height={16}
      className="rounded-sm object-cover"
      loading="lazy"
      onError={(e) => {
        // Hide broken flag images rather than show a missing-image icon.
        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

function BreakdownChip({
  Icon,
  value,
  label,
}: {
  Icon: typeof Users;
  value: number;
  label: string;
}) {
  if (!value) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-white/60"
      title={label}
    >
      <Icon size={12} />
      {value.toLocaleString()}
    </span>
  );
}

function LeaderboardPartyRowView({ row }: { row: LeaderboardPartyRow }) {
  return (
    <Link
      to={`/${row.slug}`}
      className="flex items-center gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors"
    >
      <div className="flex-shrink-0 w-8 text-center text-base font-semibold text-white/70 tabular-nums">
        {row.rank}
      </div>
      <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
        {row.eventImageUrl ? (
          <img
            src={row.eventImageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Trophy size={18} className="text-white/30" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-white truncate">
            {row.name}
          </span>
          <CountryFlag code={row.countryCode} />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-white/50 mt-0.5 truncate">
          {row.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} />
              {row.city}
            </span>
          )}
          {row.hostName && (
            <span className="truncate">
              {row.city ? ' · ' : ''}
              {row.hostName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <BreakdownChip Icon={Users} value={row.breakdown.linkRsvps} label="Link RSVPs" />
          <BreakdownChip Icon={Send} value={row.breakdown.inviteRsvps} label="Invite RSVPs" />
          <BreakdownChip
            Icon={CheckCircle2}
            value={row.breakdown.checkIns}
            label="Check-ins"
          />
          <BreakdownChip
            Icon={ImageIcon}
            value={row.breakdown.photos}
            label="Photos"
          />
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-base font-semibold text-white tabular-nums">
          {row.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-white/40">
          score
        </div>
      </div>
    </Link>
  );
}

function LeaderboardCountryRowView({ row }: { row: LeaderboardCountryRow }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
      <div className="flex-shrink-0 w-8 text-center text-base font-semibold text-white/70 tabular-nums">
        {row.rank}
      </div>
      <CountryFlag code={row.countryCode} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">
          {row.country}
        </div>
        <div className="text-[12px] text-white/50">
          {row.partyCount.toLocaleString()}{' '}
          {row.partyCount === 1 ? 'party' : 'parties'}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-base font-semibold text-white tabular-nums">
          {row.score.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-white/40">
          score
        </div>
      </div>
    </div>
  );
}

export function LeaderboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get('tab') === 'countries' ? 'countries' : 'parties') as TabKey;
  const windowParam = (searchParams.get('window') === 'year' ? 'year' : 'all') as LeaderboardWindow;

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(PAGE_SIZE);

  const load = useCallback(
    (windowKey: LeaderboardWindow, lim: number) => {
      setLoading(true);
      setError(null);
      fetchLeaderboard(windowKey, lim, 0)
        .then((res) => {
          setData(res);
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to fetch leaderboard:', err);
          setError(err?.message || 'Failed to load leaderboard');
          setLoading(false);
        });
    },
    [],
  );

  useEffect(() => {
    load(windowParam, limit);
  }, [load, windowParam, limit]);

  const setTab = useCallback(
    (next: TabKey) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'parties') params.delete('tab');
      else params.set('tab', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setWindow = useCallback(
    (next: LeaderboardWindow) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'all') params.delete('window');
      else params.set('window', next);
      // Reset page size when window changes.
      setLimit(PAGE_SIZE);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const showMore = useCallback(() => {
    setLimit((cur) => Math.min(cur + PAGE_SIZE, MAX_LIMIT));
  }, []);

  // Derived values — all hooks declared BEFORE any early return, per
  // feedback_hooks_above_early_returns.md.
  const partyRows = data?.parties.rows ?? [];
  const countryRows = data?.countries.rows ?? [];
  const partyTotal = data?.parties.total ?? 0;
  const countryTotal = data?.countries.total ?? 0;
  const hasMore = partyRows.length < partyTotal && limit < MAX_LIMIT;

  const headline = useMemo(() => {
    if (tabParam === 'countries') {
      return `${countryTotal.toLocaleString()} ${countryTotal === 1 ? 'country' : 'countries'}`;
    }
    return `${partyTotal.toLocaleString()} ${partyTotal === 1 ? 'party' : 'parties'}`;
  }, [tabParam, partyTotal, countryTotal]);

  return (
    <Layout>
      <Helmet>
        <title>Leaderboard | RSV.Pizza</title>
        <meta
          name="description"
          content="Ranking of Global Pizza Party events worldwide by guest engagement: RSVPs, check-ins, and photos."
        />
      </Helmet>

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-2">
          <Trophy size={22} className="text-[#E52828]" />
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Leaderboard
          </h1>
        </div>
        <p className="text-sm text-white/60 mb-6">
          Approved Global Pizza Party events ranked by guest engagement.
        </p>

        {/* Tab + window segmented controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1 self-start">
            <button
              type="button"
              onClick={() => setTab('parties')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tabParam === 'parties'
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Parties
            </button>
            <button
              type="button"
              onClick={() => setTab('countries')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tabParam === 'countries'
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Countries
            </button>
          </div>
          <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1 self-start">
            <button
              type="button"
              onClick={() => setWindow('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                windowParam === 'all'
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              All-time
            </button>
            <button
              type="button"
              onClick={() => setWindow('year')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                windowParam === 'year'
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              2026
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={28} className="animate-spin text-white/40" />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {error}{' '}
            <button
              type="button"
              onClick={() => load(windowParam, limit)}
              className="ml-2 underline text-red-100 hover:text-white"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="text-xs text-white/40 mb-2 tabular-nums">
              {headline}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
              {tabParam === 'parties' ? (
                partyRows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-white/50">
                    No parties yet for this window.
                  </div>
                ) : (
                  partyRows.map((row) => (
                    <LeaderboardPartyRowView key={row.id} row={row} />
                  ))
                )
              ) : countryRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-white/50">
                  No countries yet for this window.
                </div>
              ) : (
                countryRows.map((row) => (
                  <LeaderboardCountryRowView key={row.country} row={row} />
                ))
              )}
            </div>

            {tabParam === 'parties' && hasMore && (
              <div className="flex justify-center mt-4">
                <button
                  type="button"
                  onClick={showMore}
                  className="px-4 py-2 rounded-lg border border-white/15 bg-white/5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                >
                  Show more
                </button>
              </div>
            )}

            <div className="text-[11px] text-white/30 mt-6 text-center">
              Score = link RSVPs + 0.3 invite RSVPs + 2 check-ins + 0.5 photos
              (max 100 photos).
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
