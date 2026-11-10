/**
 * /payments/hosts: read-only host trust report for payment admins (plans/trusted-hosts.md phase 1).
 * Lists hosts with tier, score, reasons and blockers, next to today's Fast Pass tier. It changes no
 * budget, payout or host view. The backend returns 404 until the report switch is on.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, Search, ShieldX, Users } from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import { fetchAdminMe } from '../lib/api';
import {
  fetchHostTrust,
  fetchHostTrustDetail,
  fetchHostTrustEnabled,
  type HostTrustItem,
  type TrustTier,
} from '../lib/hostTrustApi';

const TIER_STYLE: Record<TrustTier, string> = {
  trusted: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  building: 'bg-amber-100 text-amber-800 border-amber-300',
  new: 'bg-sky-100 text-sky-800 border-sky-300',
  restricted: 'bg-red-100 text-red-800 border-red-300',
};

const TODAY_LABEL: Record<HostTrustItem['todayTier'], string> = {
  fast_pass: 'Fast Pass',
  building: 'Building',
  new: 'New',
  flagged: 'Flagged',
};

const BLOCKER_LABEL: Record<string, string> = {
  scam_tag: 'Possible-scam tag',
  reused_receipts: 'Reused receipts',
  shared_payee: 'Shared payout wallet',
  rejected_payout: 'Rejected payout',
  fake_risk: 'High fake-event risk',
  pizzadao_restricted: 'Restricted on PizzaDAO',
  pizzadao_fraud_rejected: 'PizzaDAO fraud rejection',
};

const PIZZADAO_LABEL: Record<HostTrustItem['pizzadao'], string> = {
  not_checked: 'Not checked',
  unavailable: 'Check unavailable',
  ok: 'Checked',
  ambiguous: 'Ambiguous match',
};

const TIERS: Array<TrustTier | ''> = ['', 'trusted', 'building', 'new', 'restricted'];

function TierChip({ tier }: { tier: TrustTier }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${TIER_STYLE[tier]}`}>{tier}</span>;
}

function Detail({ host }: { host: HostTrustItem }) {
  const [full, setFull] = useState<HostTrustItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchHostTrustDetail(host.userId)
      .then((h) => !cancelled && setFull(h))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Could not load parties'));
    return () => {
      cancelled = true;
    };
  }, [host.userId]);

  return (
    <div className="grid gap-4 md:grid-cols-2 text-sm">
      <div>
        <div className="font-medium text-theme-text mb-1">Why this score</div>
        <ul className="space-y-0.5 text-theme-text-secondary">
          {host.reasons.map((r) => (
            <li key={r.signal}>
              <span className={r.points < 0 ? 'text-red-600' : 'text-emerald-700'}>{r.points > 0 ? `+${r.points}` : r.points}</span> {r.detail}
            </li>
          ))}
          {host.reasons.length === 0 && <li>No signals yet.</li>}
        </ul>
        <div className="font-medium text-theme-text mt-3 mb-1">Gates for trusted</div>
        <ul className="space-y-0.5 text-theme-text-secondary">
          {host.gates.map((g) => (
            <li key={g.id}>
              {g.met ? 'Met' : 'Missing'}: {g.id}
              {g.need != null ? ` (${g.have} of ${g.need})` : ''}
            </li>
          ))}
        </ul>
        {host.blockers.length > 0 && (
          <>
            <div className="font-medium text-red-700 mt-3 mb-1">Blockers</div>
            <ul className="space-y-0.5 text-red-700">
              {host.blockers.map((b) => (
                <li key={b}>{BLOCKER_LABEL[b] ?? b}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="font-medium text-theme-text mb-1">Parties</div>
        {err && <p className="text-red-600">{err}</p>}
        {!full && !err && <Loader2 size={16} className="animate-spin" />}
        {full?.parties && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-theme-text-muted">
                <th className="pr-2">Date</th><th className="pr-2">RSVPs</th><th className="pr-2">Check-ins</th>
                <th className="pr-2">Reported</th><th className="pr-2">Photos</th><th className="pr-2">Receipts</th>
                <th className="pr-2">Payouts</th><th>Fake risk</th>
              </tr>
            </thead>
            <tbody>
              {full.parties.map((p) => (
                <tr key={p.partyId} className="text-theme-text-secondary">
                  <td className="pr-2 whitespace-nowrap">{p.date ? p.date.slice(0, 10) : 'none'}{p.completed ? '' : ' (not done)'}</td>
                  <td className="pr-2">{p.rsvps}</td>
                  <td className="pr-2">{p.checkIns}</td>
                  <td className="pr-2">{p.reportedAttendance ?? '-'}</td>
                  <td className="pr-2">{p.photos} ({p.payoutPhotos} payout)</td>
                  <td className="pr-2">{p.receiptsOnTime ? 'on time' : '-'}</td>
                  <td className="pr-2">{p.payoutStatuses.join(', ') || '-'}</td>
                  <td>{p.fakeRisk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type Gate = 'loading' | 'denied' | 'off' | 'ok';

export function PaymentsHostsPage() {
  const [gate, setGate] = useState<Gate>('loading');
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<TrustTier | ''>('');
  const [hosts, setHosts] = useState<HostTrustItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchAdminMe();
        if (!me.isAdmin || !['admin', 'super_admin', 'payment_admin'].includes(me.role ?? '')) {
          if (!cancelled) setGate('denied');
          return;
        }
        const e = await fetchHostTrustEnabled();
        if (!cancelled) setGate(e.enabled ? 'ok' : 'off');
      } catch {
        if (!cancelled) setGate('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async (nextOffset: number, append: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const page = await fetchHostTrust({ q: q.trim() || undefined, tier: tier || undefined, offset: nextOffset, limit: 50 });
      setHosts((prev) => (append ? [...prev, ...page.hosts] : page.hosts));
      setTotal(page.total);
      setOffset(nextOffset + page.limit);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the report');
    } finally {
      setBusy(false);
    }
  }, [q, tier]);

  useEffect(() => {
    if (gate === 'ok') void load(0, false);
    // Search is submitted with Enter / the button; tier reloads right away.
  }, [gate, tier]);

  if (gate === 'loading') {
    return <Layout><div className="flex justify-center py-32"><Loader2 className="animate-spin" /></div></Layout>;
  }
  if (gate === 'denied') {
    return (
      <Layout>
        <div className="flex flex-col items-center py-32 px-4">
          <ShieldX size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted">The hosts report is only available to payment admins.</p>
        </div>
      </Layout>
    );
  }
  if (gate === 'off') {
    return (
      <Layout>
        <div className="flex flex-col items-center py-32 px-4">
          <Users size={48} className="text-theme-text-muted mb-4" />
          <h1 className="text-2xl font-bold mb-2">Hosts report is off</h1>
          <p className="text-theme-text-muted">A super admin can turn it on under Admin, Host trust settings.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Helmet><title>Hosts | RSV.Pizza</title></Helmet>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <Users size={22} className="text-theme-accent" />
          <h1 className="text-2xl font-bold text-theme-text flex-1">Hosts</h1>
          <Link to="/payments" className="text-sm text-theme-text-secondary underline">Back to payments</Link>
        </div>
        <p className="text-sm text-theme-text-muted mb-4">
          Read-only. Hosts with a party in the next 60 days or an event payout in the last 90. Nothing here changes a budget,
          a payout or what a host sees. {total} host{total === 1 ? '' : 's'}.
        </p>

        <form
          className="flex gap-2 mb-4 flex-wrap items-center"
          onSubmit={(e) => { e.preventDefault(); void load(0, false); }}
        >
          <div className="flex-1 min-w-[12rem]">
            <IconInput icon={Search} placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as TrustTier | '')}
            className="rounded-lg bg-theme-input border border-theme-stroke px-3 py-2 text-theme-text text-sm"
            aria-label="Tier filter (this page of results)"
          >
            {TIERS.map((t) => <option key={t || 'all'} value={t}>{t ? `Tier: ${t}` : 'All tiers'}</option>)}
          </select>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-theme-surface border border-theme-stroke text-sm">Search</button>
        </form>

        {error && <p className="text-red-600 mb-3">{error}</p>}

        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-theme-text-muted border-b border-theme-stroke">
                <th className="p-2">Host</th><th className="p-2">Tier</th><th className="p-2">Score</th>
                <th className="p-2">Verified</th><th className="p-2">Done</th><th className="p-2">Turnout</th>
                <th className="p-2">Account</th><th className="p-2">Today&apos;s Fast Pass</th>
                <th className="p-2">PizzaDAO</th><th className="p-2">Blockers</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((h) => (
                <Fragment key={h.userId}>
                  <tr
                    className="border-b border-theme-stroke/50 cursor-pointer hover:bg-theme-surface-hover"
                    onClick={() => setOpen(open === h.userId ? null : h.userId)}
                  >
                    <td className="p-2"><div className="font-medium text-theme-text">{h.name || h.email}</div><div className="text-xs text-theme-text-muted">{h.email}</div></td>
                    <td className="p-2"><TierChip tier={h.tier} /></td>
                    <td className="p-2">{h.score}</td>
                    <td className="p-2">{h.verifiedParties}{h.verifiedPartiesRaw !== h.verifiedParties ? ` (${h.verifiedPartiesRaw} raw)` : ''}</td>
                    <td className="p-2">{h.completedParties}</td>
                    <td className="p-2">{h.medianTurnout != null ? `${Math.round(h.medianTurnout * 100)}% (${h.turnoutParties})` : '-'}</td>
                    <td className="p-2">{h.accountAgeDays}d</td>
                    <td className="p-2">{TODAY_LABEL[h.todayTier]}{h.disagrees ? ' *' : ''}</td>
                    <td className="p-2">{PIZZADAO_LABEL[h.pizzadao]}</td>
                    <td className="p-2 text-red-700">{h.blockers.map((b) => BLOCKER_LABEL[b] ?? b).join(', ') || '-'}</td>
                  </tr>
                  {open === h.userId && (
                    <tr className="bg-theme-surface/50"><td colSpan={10} className="p-4"><Detail host={h} /></td></tr>
                  )}
                </Fragment>
              ))}
              {hosts.length === 0 && !busy && (
                <tr><td colSpan={10} className="p-6 text-center text-theme-text-muted">No hosts match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-theme-text-muted mt-2">* new tier and today&apos;s Fast Pass disagree about whether this host is trusted.</p>

        <div className="mt-4 flex items-center gap-3">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {hasMore && !busy && (
            <button type="button" onClick={() => void load(offset, true)} className="px-4 py-2 rounded-lg bg-theme-surface border border-theme-stroke text-sm">
              Load more
            </button>
          )}
        </div>
      </main>
    </Layout>
  );
}
