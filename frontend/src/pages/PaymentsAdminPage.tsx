import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ShieldX, Loader2, DollarSign, Download, Plus, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import {
  fetchAdminMe,
  fetchUnderbossMe,
  listAdminPayouts,
  fetchPayoutsByParty,
  getAdminPayout,
  approveAdminPayout,
  rejectAdminPayout,
  unapproveAdminPayout,
  unrejectAdminPayout,
  revertPaidAdminPayout,
  markPayoutQueued,
  unmarkPayoutQueued,
  updateAdminPayout,
  markAdminPayoutPaid,
  executeAdminPayout,
  getUsdcDailyCapRemaining,
  fetchWalletPaidTotal,
  exportAdminPayoutsCsv,
  fetchPrepayQueue,
  flagReadyForPayment,
  fetchFakeDetectionScores,
} from '../lib/api';
import type { FakeDetectionScoreMap } from '../lib/api';
import type {
  AdminPayout,
  AdminPayoutDetail,
  AdminPayoutFilters,
  AdminPayoutTotals,
  PartyPayoutsRow,
  PrepayQueueRow,
  PrepayCandidate,
} from '../types';
import { formatUsd } from '../components/payments-shared';
import { PAYMENTS_REGION_LABELS, type PaymentsRegionPortal } from '../utils/regions';
import { isSwcHubParty } from '../utils/swcHub';
import { fetchSheetCities } from '../lib/cities';
import {
  PayoutsFilterBar,
  PayoutsTable,
  PayoutsByPartyTable,
  PayoutReviewModal,
  PaymentsStatsCards,
  BulkActionsBar,
  ExternalPaymentModal,
  SendPaymentModal,
  PrepayQueueTable,
  CreatePrepaymentModal,
  HostPaymentDetailsModal,
  ExportSafeJsonModal,
  BulkSendModal,
  RejectReasonModal,
  HotWalletCard,
  MarkPartyPaidModal,
} from '../components/payments-admin';
import type { BulkSendResult } from '../lib/api';

/**
 * argentina-92103: viewer-role state. The full /payments dashboard accepts
 * admin / super_admin / payment_admin (`viewerKind: 'admin'`). A regional
 * portal (`regionFilter` supplied) additionally accepts an underboss whose
 * regions overlap the requested scope (`viewerKind: 'underboss'`).
 */
type RoleState =
  | { kind: 'loading' }
  | { kind: 'denied' }
  | {
      kind: 'allowed';
      role: 'admin' | 'super_admin' | 'payment_admin' | 'underboss';
      viewerKind: 'admin' | 'underboss';
      email: string;
    };

/**
 * argentina-92103: optional props that turn the dashboard into a regional
 * portal. When set:
 *  - All payouts queries forward `?regions=` so the queue is scoped server-side.
 *  - Page title flips to `"{portalSlug.toUpperCase()} Payments"`.
 *  - Viewer-role resolution accepts a matching-region underboss in addition
 *    to admin-class. Funds-sending affordances stay admin-only.
 */
export interface PaymentsAdminPageProps {
  regionFilter?: string[];
  portalSlug?: string;
}

const DEFAULT_FILTERS: AdminPayoutFilters = {
  status: 'all',
  payoutMethod: 'all',
  currency: 'all',
  // bruschetta-58291: country filter default — 'all' means no filter.
  country: 'all',
  // mascarpone-49102: tag filter default — 'all' means no filter.
  tag: 'all',
  // salumi-89172: purpose filter default — 'all' shows both event and
  // shipping payouts so the existing admin queue is unchanged out of box.
  purpose: 'all',
  // caciotta-92105: hide payments-closed cities (pinsa-92103) by default.
  hideClosed: true,
  // stracchino-92108: hide possible-scam-flagged cities (bottarga-92104) by default.
  hideScams: true,
  // arancino-92103: sort order default — newest submitted first. Matches the
  // prior implicit backend ordering, so non-sorting callers see no change.
  sort: 'created_desc',
};

// Prepay queue section is hidden for now. Flip to true to bring it back —
// the data loading + filtering/sort logic is all still wired up below.
const SHOW_PREPAY_QUEUE = false;

// lardo-58294: substring filter shared between the search input and the
// "no matches" hint. Strips the "Global Pizza Party " prefix from party.name
// so typing a city matches what's actually rendered in the table.
function matchesPrepaySearch(row: PrepayQueueRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  if (!needle) return true;
  const nameStripped = row.party.name.replace(/^Global Pizza Party\s+/i, '').toLowerCase();
  if (nameStripped.includes(needle)) return true;
  if (row.party.name.toLowerCase().includes(needle)) return true;
  if (row.party.country?.toLowerCase().includes(needle)) return true;
  for (const c of row.candidates) {
    if ((c.name ?? '').toLowerCase().includes(needle)) return true;
    if (c.email.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/**
 * bocconcini-92110: tally a city row's receipt OCR USD total — non-duplicate,
 * eligible `kind='receipt'` documents across every payout. Mirrors the by-city
 * Receipt total cell + the Mark-paid modal default so the amount sorts order
 * cities by exactly what the admin sees in that column.
 */
function computeReceiptsTotalUsd(row: PartyPayoutsRow): number {
  let total = 0;
  for (const p of row.payouts) {
    for (const d of p.documents || []) {
      if (d.kind !== 'receipt') continue;
      if (d.isDuplicate === true) continue;
      if (d.ineligible === true) continue;
      total += Number(d.ocrAmount) || 0;
    }
  }
  return total;
}

export function PaymentsAdminPage({ regionFilter, portalSlug }: PaymentsAdminPageProps = {}) {
  // argentina-92103: stable region list to thread into API calls + filter
  // defaults. `undefined` when running as the unscoped /payments dashboard.
  const regions = useMemo(
    () => (regionFilter && regionFilter.length > 0 ? [...regionFilter] : undefined),
    [regionFilter],
  );
  // tortelli-92103: use the canonical PAYMENTS_REGION_LABELS map so each
  // portal renders its proper display name ("Africa", "North America",
  // "Asia & Oceania") instead of an upper-cased slug. Falls back to the
  // upper-cased slug for any portal not in the map (defensive — shouldn't
  // happen, but avoids a runtime crash on a typo).
  const portalLabel = portalSlug
    ? PAYMENTS_REGION_LABELS[portalSlug as PaymentsRegionPortal] ?? portalSlug.toUpperCase()
    : null;
  const isRegionalPortal = !!regions;

  const [role, setRole] = useState<RoleState>({ kind: 'loading' });
  const [filters, setFilters] = useState<AdminPayoutFilters>(() =>
    regions ? { ...DEFAULT_FILTERS, regions } : DEFAULT_FILTERS,
  );

  // etruria-92103: primary view is `by-city` (one row per party with status
  // aggregates, click to expand). `by-payment` keeps the existing per-row
  // view available as a fallback. The choice persists in localStorage so an
  // admin's preference sticks across reloads. Falls back to `by-city` on
  // first visit OR if the stored value is corrupted.
  // coppa-92106: third mode `payments` = the actual-payments ledger — one row
  // per status=paid|completed payment, proof-gated (prosciutto-92106), sorted
  // by paid_at DESC. Distinct from `by-payment` which shows every payout
  // regardless of status.
  type ViewMode = 'by-city' | 'by-payment' | 'payments';
  const VIEW_MODE_LS_KEY = 'paymentsAdminViewMode';
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'by-city';
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_LS_KEY);
      if (stored === 'by-city' || stored === 'by-payment' || stored === 'payments') return stored;
    } catch {
      /* localStorage disabled (Safari private etc.) — fall through */
    }
    return 'by-city';
  });
  // Persist on change. Guarded against localStorage failures so private-mode
  // browsing doesn't crash the page.
  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_LS_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  // etruria-92103: by-city grouped rows from /by-party. Empty when viewing
  // the per-payment list. `byPartyRows` and `payouts` are populated by the
  // same loader (`loadPage`) so the rest of the page can read from whichever
  // is active.
  const [byPartyRows, setByPartyRows] = useState<PartyPayoutsRow[]>([]);
  // bufalina-60733: fake-detection risk scores for the loaded by-city parties.
  // Keyed by party id; only medium/high (≥30) parties are returned, so an
  // absent key means "no badge". Fetched best-effort after byPartyRows loads.
  const [fakeScores, setFakeScores] = useState<FakeDetectionScoreMap>({});
  const [totals, setTotals] = useState<AdminPayoutTotals | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selection (bulk actions)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState<AdminPayoutDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // CSV export
  const [exporting, setExporting] = useState(false);

  // External payment modal (arugula-38633 v2 follow-up).
  // mostarda-92103: when opened from a city row in the by-city table, the
  // initial-query prefills the party picker with the city name so the admin
  // doesn't have to re-type it.
  const [externalModalState, setExternalModalState] = useState<
    | { open: false }
    | { open: true; initialQuery?: string }
  >({ open: false });

  // bismarck-92103: prepay queue + the "Create prepayment" modal target row.
  const [prepayQueue, setPrepayQueue] = useState<PrepayQueueRow[]>([]);
  const [prepayModalRow, setPrepayModalRow] = useState<PrepayQueueRow | null>(null);

  // panettone-92103: "Mark party paid" modal target. Holds the partyId +
  // a hint name so the modal header can render the city while the preview
  // request is in flight.
  // parmigiana-92104: also carries `isSwcHub` so the modal can render the
  // SWC Hub reimbursement warning (the preview endpoint doesn't expose
  // country/event_tags).
  const [markPartyPaidTarget, setMarkPartyPaidTarget] = useState<
    | { partyId: string; partyNameHint: string; isSwcHub: boolean }
    | null
  >(null);

  // salame-92106: "Send payment" modal target — opens the SendPaymentModal
  // pre-filled with the city's outstanding total, country, cap, paid total,
  // and primary host id. Holds a snapshot of the PartyPayoutsRow so the modal
  // stays decoupled from byPartyRows mutations while it's open.
  const [sendPaymentTarget, setSendPaymentTarget] = useState<
    | {
        partyId: string;
        partyName: string;
        outstandingUsd: number;
        // gnocchi-92105: sum of non-duplicate receipt OCR USD across the
        // party's payouts. Drives the new "receipts - paid" default amount
        // in SendPaymentModal (no cap clamp).
        receiptsTotalUsd: number;
        country: string | null;
        eventTags: string[];
        effectiveReimbursementCapUsd: number | null;
        paidTotalUsd: number;
        primaryHostUserId: string | null;
        // Map of recipient User id -> the USDC wallet that host submitted on
        // their most recent receipt payout for this city (ENS input preferred
        // over the resolved 0x). Lets SendPaymentModal pre-fill the wallet
        // field per selected recipient instead of making the admin re-type it.
        hostWalletByUserId: Record<string, string>;
        // bufalina-60733: fake-detection risk for this party, looked up from
        // `fakeScores` at open time so the modal can gate "Send" behind an ack
        // when the event is flagged (medium/high). Undefined = no flag.
        fakeScore?: number;
        fakeTier?: string;
        fakeTopFlags?: string[];
      }
    | null
  >(null);

  // lardo-58294: local-only substring filter for the prepay queue. Cleared
  // on tab refresh — no persistence.
  const [prepaySearch, setPrepaySearch] = useState('');

  // pomodoro-58294: client-side sort for the prepay queue. Default 'newest'
  // preserves whatever order the backend sent.
  type PrepaySortKey = 'newest' | 'country_asc' | 'country_desc' | 'city_asc' | 'city_desc';
  const [prepaySort, setPrepaySort] = useState<PrepaySortKey>('newest');

  // siciliana-69183: clickable host name opens the read-only payment-details
  // modal. Holds the User.id; null = modal closed.
  const [hostDetailUserId, setHostDetailUserId] = useState<string | null>(null);

  // siciliana-69183: Safe Transaction Builder JSON export. Modal is mounted
  // when true; the modal itself filters non-USDC / missing-wallet rows.
  const [showSafeExportModal, setShowSafeExportModal] = useState(false);

  // salsiccia-49102: BulkSendModal — sequentially executes USDC payouts via
  // backend POST /api/admin/payouts/bulk-execute. Modal does its own
  // eligibility filter; we just hand it `selectedPayouts`.
  const [showBulkSend, setShowBulkSend] = useState(false);

  // crudo-91827: in-app reject-reason modal target. Replaces window.prompt()
  // which gets silently blocked by popup blockers / Brave / Arc / extensions.
  // `null` = modal closed; either `single` (one row) or `bulk` (multi-select).
  const [rejectTarget, setRejectTarget] = useState<
    | { kind: 'single'; id: string; hostName: string }
    | { kind: 'bulk'; ids: string[] }
    | null
  >(null);

  // siciliana-69183: tiny toast stack (matches AdminLogoCleanup pattern).
  // Surfaces post-prepayment success + post-export confirmations.
  type Toast = { id: number; message: string; kind: 'success' | 'error' };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback(
    (message: string, kind: 'success' | 'error' = 'success') => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    [],
  );

  // crocchetta-92107: city-name → Telegram group chat_id map, sourced from
  // the same GPP sheet (`fetchSheetCities` → `SheetCity.groupId`) that
  // /underboss uses for its broadcast tooling. Drives the per-city group
  // post on the Send-receipts-reminder action; rows without a matching city
  // entry skip the group post server-side. Fetched once on mount; failures
  // collapse to an empty map (the host DM still goes out).
  const [cityGroupChatIds, setCityGroupChatIds] = useState<Map<string, string>>(
    new Map(),
  );
  useEffect(() => {
    let cancelled = false;
    fetchSheetCities()
      .then((cities) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const c of cities) {
          if (c.groupId) {
            map.set(c.city.toLowerCase().trim(), c.groupId);
          }
        }
        setCityGroupChatIds(map);
      })
      .catch(() => {
        // Sheet fetch is best-effort — silently collapse on failure. The DM
        // path still runs and the toast surfaces "no city TG group set".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPrepayQueue = useCallback(async () => {
    try {
      const rows = await fetchPrepayQueue(regions ? { regions } : undefined);
      setPrepayQueue(rows);
    } catch {
      // Non-fatal — the rest of the dashboard works without it. Silently
      // collapse the section by leaving the array empty.
      setPrepayQueue([]);
    }
  }, [regions]);

  // Role gate
  // argentina-92103: when running as a regional portal (regions set), we
  // accept EITHER an admin-class user OR an underboss whose regions overlap
  // the requested scope. The unscoped /payments dashboard keeps the
  // pre-existing admin-class-only behavior.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchAdminMe();
        if (cancelled) return;
        const r = me.role;
        if (me.isAdmin && (r === 'admin' || r === 'super_admin' || r === 'payment_admin')) {
          setRole({
            kind: 'allowed',
            role: r,
            viewerKind: 'admin',
            email: me.email || '',
          });
          return;
        }
        // Regional portal fallback — check for underboss with matching region.
        if (regions) {
          try {
            const ub = await fetchUnderbossMe();
            if (cancelled) return;
            if (ub.isUnderboss && Array.isArray(ub.regions)) {
              const overlap = ub.regions.some((reg) => regions.includes(reg));
              if (overlap) {
                setRole({
                  kind: 'allowed',
                  role: 'underboss',
                  viewerKind: 'underboss',
                  email: ub.email || '',
                });
                return;
              }
            }
          } catch {
            // fall through to denied
          }
        }
        setRole({ kind: 'denied' });
      } catch {
        if (!cancelled) setRole({ kind: 'denied' });
      }
    })();
    return () => { cancelled = true; };
  }, [regions]);

  // risotto-58931: monotonic request id — only the latest loadPage call is
  // allowed to write state.
  const loadSeqRef = useRef(0);

  // bufalina-60733: separate monotonic id for the best-effort fake-detection
  // score fetch so a slow score response can't clobber a newer filter's scores.
  const fakeScoresSeqRef = useRef(0);

  const loadPage = useCallback(
    async (f: AdminPayoutFilters, append = false) => {
      // risotto-58931: monotonic request id — only the latest loadPage call is
      // allowed to write state, so a slow initial unfiltered fetch can't clobber
      // a faster filtered fetch fired by the first search keystroke.
      const myReq = ++loadSeqRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setErrorMsg(null);
      try {
        // argentina-92103: always re-inject the portal's region scope so a
        // user clearing filters can't accidentally fetch the global queue.
        const baseMerged = regions ? { ...f, regions } : f;
        // coppa-92106: in Payments view, override status/sort/provenOnly +
        // bump page size to 50 (the proven-paid set is small, ~600-1000 rows).
        // The filter chips for status/sort are hidden in PaymentsFilterBar so
        // these can't be changed by the user mid-session. Other filters
        // (country, region, method, currency, search) still apply.
        const merged: AdminPayoutFilters = viewMode === 'payments'
          ? {
              ...baseMerged,
              status: 'paid,completed',
              sort: 'paid_at_desc',
              provenOnly: true,
              limit: baseMerged.limit ?? 50,
            }
          : baseMerged;
        // etruria-92103: when by-city is active, ALSO fetch the grouped
        // shape from /by-party so the new table can render. The per-payment
        // list is still fetched so:
        //   1. Stats cards / totals / bulk-selection still work identically.
        //   2. Toggling back to by-payment is instant (no extra fetch).
        // append (load-more) only applies to the per-payment list; by-city
        // returns all matching parties in one go (v1).
        const listRes = await listAdminPayouts(merged);
        if (myReq !== loadSeqRef.current) return; // superseded by a newer load
        setPayouts((prev) => (append ? [...prev, ...listRes.payouts] : listRes.payouts));
        setTotals(listRes.totals);
        setNextCursor(listRes.nextCursor);
        if (!append && viewMode === 'by-city') {
          // The status tab filters which CITIES show, not which payout rows —
          // so we always fetch the COMPLETE per-city rollup (every status) and
          // apply the status membership test client-side (see
          // `displayedByPartyRows`). Passing `status` to /by-party filters at
          // the payout-row level, which both (a) drops a city whose matching
          // status isn't the selected one and (b) zeroes its other-status
          // columns — e.g. a partially-paid city under "Approved" lost its
          // Paid column. Stripping it here keeps Approved/Paid/Outstanding
          // accurate for every shown city.
          const { status: _byCityStatus, ...byCityFilters } = merged;
          const grouped = await fetchPayoutsByParty(byCityFilters);
          if (myReq !== loadSeqRef.current) return; // superseded by a newer load
          setByPartyRows(grouped.rows);
        }
      } catch (err: any) {
        if (myReq === loadSeqRef.current) setErrorMsg(err.message || 'Failed to load payments');
      } finally {
        // Only the live request resets the loading flag; a superseded request
        // returns early above and skips this, leaving the flag to its owner.
        if (myReq === loadSeqRef.current) {
          if (append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [regions, viewMode],
  );

  // Re-load when filters change (and we're allowed)
  useEffect(() => {
    if (role.kind !== 'allowed') return;
    loadPage(filters, false);
  }, [filters, role.kind, loadPage]);

  // bismarck-92103: load the prepay queue once admin is allowed in. It's
  // independent of the payouts filter set, so it doesn't refetch on filter
  // changes — only after a prepayment is created (see refresh() below).
  useEffect(() => {
    if (role.kind !== 'allowed') return;
    loadPrepayQueue();
  }, [role.kind, loadPrepayQueue]);

  // bufalina-60733: best-effort fake-detection score fetch for the loaded
  // by-city parties. Non-blocking — failures are swallowed and just leave the
  // badges hidden. Guarded by `fakeScoresSeqRef` so a slow response from an
  // older filter can't overwrite a newer one's scores.
  useEffect(() => {
    if (role.kind !== 'allowed') return;
    const ids = byPartyRows.map((r) => r.party.id);
    if (ids.length === 0) {
      setFakeScores({});
      return;
    }
    const myReq = ++fakeScoresSeqRef.current;
    fetchFakeDetectionScores(ids)
      .then((res) => {
        if (myReq !== fakeScoresSeqRef.current) return;
        setFakeScores(res.scores);
      })
      .catch(() => {
        /* best-effort: leave badges hidden on failure */
      });
  }, [byPartyRows, role.kind]);

  // lardo-58294: apply the substring filter. When the search is empty this
  // is identity-equal to prepayQueue.
  const filteredPrepayQueue = useMemo(
    () => prepayQueue.filter((row) => matchesPrepaySearch(row, prepaySearch)),
    [prepayQueue, prepaySearch],
  );

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const p of payouts) {
      if (p.originalCurrency) set.add(p.originalCurrency.toUpperCase());
    }
    return Array.from(set).sort();
  }, [payouts]);

  // pancetta-92103: the prior `availableCountries` derivation was removed
  // alongside the single-country dropdown. The new Regions multi-select is
  // sourced from PAYMENTS_REGION_SCOPES (a static map) — no per-load derivation
  // needed.

  // mascarpone-49102: derive the tag dropdown set from `party.eventTags`
  // (added to PAYOUT_PARTY_SELECT in tagliatelle-49102). Flattens the arrays
  // and dedupes; sorted ascending. Mirrors the country / currency pattern.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of payouts) {
      if (Array.isArray(p.party.eventTags)) {
        for (const t of p.party.eventTags) {
          if (t && typeof t === 'string') set.add(t);
        }
      }
    }
    return Array.from(set).sort();
  }, [payouts]);

  // siciliana-69183: derive the AdminPayout objects matching `selectedIds` for
  // the Safe-export modal. The modal itself filters non-USDC / missing-wallet
  // rows; we just hand it the full selection.
  const selectedPayouts = useMemo(
    () => payouts.filter((p) => selectedIds.has(p.id)),
    [payouts, selectedIds],
  );

  // etruria-92103: in by-city view, surface how many distinct cities (parties)
  // the current selection spans so the BulkActionsBar can render "N payments
  // across M cities selected". Derived from `selectedPayouts` so it stays in
  // sync with the same source of truth.
  const selectedCityCount = useMemo(() => {
    if (viewMode !== 'by-city') return 0;
    const partyIds = new Set<string>();
    for (const p of selectedPayouts) {
      if (p.party?.id) partyIds.add(p.party.id);
    }
    return partyIds.size;
  }, [selectedPayouts, viewMode]);

  // Status-tab membership filter for the by-city table. `byPartyRows` always
  // holds the COMPLETE per-city rollup (loadPage strips `status` from the
  // /by-party fetch), so here we only decide which CITIES to show: a city
  // appears under a status tab when it has at least one payout of that exact
  // status. 'all' / unset shows every city. This is the "has a still-X entry"
  // membership rule — shown cities still render their full Approved/Paid/
  // Outstanding columns since the rollup is computed from all their payouts.
  const displayedByPartyRows = useMemo(() => {
    const status = filters.status;
    const filtered =
      !status || status === 'all'
        ? byPartyRows
        : byPartyRows.filter((row) => row.payouts.some((p) => p.status === status));

    // "Oldest/Newest first" in the by-city view should order cities by their
    // host UPLOAD time, not lastActivityAt. The /by-party endpoint doesn't
    // implement created_asc/created_desc — they fall through to its activity
    // sort — so we order here off the payouts each row already carries:
    //   • Oldest first  → city whose EARLIEST host upload is oldest (min createdAt asc)
    //   • Newest first  → city whose LATEST host upload is most recent (max createdAt desc)
    const sort = filters.sort;
    if (sort === 'created_asc' || sort === 'created_desc') {
      const earliest = (r: PartyPayoutsRow) =>
        Math.min(...r.payouts.map((p) => new Date(p.createdAt).getTime()));
      const latest = (r: PartyPayoutsRow) =>
        Math.max(...r.payouts.map((p) => new Date(p.createdAt).getTime()));
      return [...filtered].sort((a, b) =>
        sort === 'created_asc' ? earliest(a) - earliest(b) : latest(b) - latest(a),
      );
    }
    // bocconcini-92110: "Highest/Lowest amount" should order cities by the
    // Receipt total column the admin sees, not the backend by-party
    // payout-sum order they'd otherwise fall through to.
    if (sort === 'amount_desc' || sort === 'amount_asc') {
      return [...filtered].sort((a, b) => {
        const cmp = computeReceiptsTotalUsd(a) - computeReceiptsTotalUsd(b);
        return sort === 'amount_asc' ? cmp : -cmp;
      });
    }
    return filtered;
  }, [byPartyRows, filters.status, filters.sort]);

  // salsiccia-49102: count of selected payouts eligible for bulk USDC send.
  // Mirrors the backend filter (usdc_base + approved/failed + valid 0x
  // wallet — passata-49102 added failed-status retry) so the BulkActionsBar
  // button label + tooltip match what the server will actually execute.
  // Kept in this file (not in BulkSendModal) so the bar can show the count
  // even when the modal is closed.
  const eligibleBulkSendCount = useMemo(() => {
    const re = /^0x[0-9a-fA-F]{40}$/;
    return selectedPayouts.filter(
      (p) =>
        p.payoutMethod === 'usdc_base' &&
        (p.status === 'approved' || p.status === 'failed') &&
        !!p.payoutWalletAddress &&
        re.test(p.payoutWalletAddress),
    ).length;
  }, [selectedPayouts]);

  // pomodoro-58294: sort the prepay queue client-side. 'newest' is a no-op so
  // we preserve backend ordering; the city sort strips the "Global Pizza Party"
  // prefix so events sort by their actual locality. Sort runs over the
  // lardo-58294 filtered list so search + sort compose cleanly.
  const sortedPrepayQueue = useMemo(() => {
    if (prepaySort === 'newest') return filteredPrepayQueue;
    const stripCity = (name: string) =>
      name.replace(/^Global Pizza Party\s+/i, '').trim();
    const out = [...filteredPrepayQueue];
    out.sort((a, b) => {
      if (prepaySort === 'country_asc' || prepaySort === 'country_desc') {
        const ca = (a.party.country ?? '').toLowerCase();
        const cb = (b.party.country ?? '').toLowerCase();
        const cmp = ca.localeCompare(cb);
        return prepaySort === 'country_asc' ? cmp : -cmp;
      }
      if (prepaySort === 'city_asc' || prepaySort === 'city_desc') {
        const ca = stripCity(a.party.name).toLowerCase();
        const cb = stripCity(b.party.name).toLowerCase();
        const cmp = ca.localeCompare(cb);
        return prepaySort === 'city_asc' ? cmp : -cmp;
      }
      return 0;
    });
    return out;
  }, [filteredPrepayQueue, prepaySort]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (prev.size === payouts.length && payouts.length > 0) return new Set();
      return new Set(payouts.map((p) => p.id));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function refresh() {
    await loadPage(filters, false);
  }

  // bismarck-92103: after a prepayment is created, refresh BOTH the payouts
  // list (so the new pending payout shows up there) and the prepay queue (so
  // the source row drops off — it now has an in-flight payout).
  // siciliana-69183: also flash a success toast with the host + amount so
  // it's clear where the new payout went (the source row drops off the prepay
  // queue silently otherwise).
  async function handlePrepaymentCreated(summary?: { hostName: string; amountUsd: number }) {
    await Promise.all([refresh(), loadPrepayQueue()]);
    if (summary) {
      pushToast(
        `Created prepayment for ${summary.hostName} — $${summary.amountUsd.toFixed(2)}`,
        'success',
      );
    }
  }

  /**
   * tiramisu-49102: "Pay again to this wallet" from PayoutReviewModal.
   * Closes the review modal and opens CreatePrepaymentModal pre-filled with
   * the same party + host + payout-method/destination as the existing payout.
   * The synthetic PrepayQueueRow mirrors the shape the prepay-queue endpoint
   * normally emits — a single PrepayCandidate derived from the paid payout's
   * host + method + walletAddress/bankEmail. CreatePrepaymentModal handles the
   * cap-remaining clamp + the existing 50%-of-cap default.
   */
  function handlePayAgain(payout: AdminPayoutDetail) {
    if (!payout.host?.id || !payout.payoutMethod || !payout.host.email) return;

    const bankEmail =
      payout.payoutMethod === 'wire' &&
      payout.payoutBankDetails &&
      typeof (payout.payoutBankDetails as any).email === 'string'
        ? ((payout.payoutBankDetails as any).email as string).trim() || null
        : null;

    const candidate: PrepayCandidate = {
      userId: payout.host.id,
      name: payout.host.name ?? null,
      email: payout.host.email,
      method: payout.payoutMethod,
      walletAddress:
        payout.payoutMethod === 'usdc_base' ? payout.payoutWalletAddress ?? null : null,
      bankEmail,
      // We don't carry primary/cohost role here — the modal only uses it for
      // a star icon. Default to false; the admin already knows who they're
      // paying because the modal came from a specific payout row.
      isPrimaryHost: false,
    };

    const syntheticRow: PrepayQueueRow = {
      party: {
        id: payout.party.id,
        name: payout.party.name,
        customUrl: payout.party.customUrl,
        country: payout.party.country,
        effectiveReimbursementCapUsd: payout.party.effectiveReimbursementCapUsd,
        // We don't carry eventTags on AdminPayout.party; the modal only reads
        // it for the cap-fallback display, and `effectiveReimbursementCapUsd`
        // is already resolved upstream.
        eventTags: [],
      },
      candidates: [candidate],
      hasMultipleCandidates: false,
      partyPaidUsd: payout.party.paidTotalUsd ?? 0,
      partyPaidCount: payout.party.paidTotalCount ?? 0,
    };

    setDetail(null);
    setPrepayModalRow(syntheticRow);
  }

  async function openDetail(p: AdminPayout) {
    setDetail(null);
    setDetailLoading(true);
    try {
      // argentina-92103: forward the portal's region scope so underbosses
      // can't peek at out-of-region detail by direct id lookup.
      const d = await getAdminPayout(p.id, regions ? { regions } : undefined);
      setDetail(d);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load payment');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetail(null);
  }

  async function handleRowApprove(id: string) {
    setRowBusyId(id);
    try {
      await approveAdminPayout(id, regions ? { regions } : undefined);
      // crudo-91827: refresh BOTH lists — an approved prepayment row stays in
      // the payouts table but may affect prepay-queue derivations.
      await Promise.all([refresh(), loadPrepayQueue()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Approve failed');
    } finally {
      setRowBusyId(null);
    }
  }

  // caprino-92103: revert an approved payout back to pending. Same refresh
  // pattern as handleRowApprove — both queues can shift when a row flips
  // approved <-> pending.
  async function handleRowUnapprove(id: string) {
    setRowBusyId(id);
    try {
      await unapproveAdminPayout(id, regions ? { regions } : undefined);
      await Promise.all([refresh(), loadPrepayQueue()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Revert failed');
    } finally {
      setRowBusyId(null);
    }
  }

  // crudo-91827: opens the in-app reject-reason modal. The actual reject work
  // is done by `confirmReject` once the admin types a reason and confirms.
  async function handleRowReject(id: string) {
    const row = payouts.find((p) => p.id === id);
    setRejectTarget({
      kind: 'single',
      id,
      hostName: row?.host?.name ?? row?.host?.email ?? 'this host',
    });
  }

  async function handleRowMarkPaid(p: AdminPayout) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getAdminPayout(p.id, regions ? { regions } : undefined);
      setDetail(d);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Approve ${selectedIds.size} payments?`)) return;
    setBulkBusy(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await approveAdminPayout(id, regions ? { regions } : undefined).catch(() => null);
      }
      clearSelection();
      // crudo-91827: refresh BOTH lists for the same reason as the row variant.
      await Promise.all([refresh(), loadPrepayQueue()]);
    } finally {
      setBulkBusy(false);
    }
  }

  // crudo-91827: opens the in-app reject-reason modal in bulk mode. Actual
  // reject work is done by `confirmReject` once the admin confirms.
  async function handleBulkReject() {
    if (selectedIds.size === 0) return;
    setRejectTarget({ kind: 'bulk', ids: Array.from(selectedIds) });
  }

  // crudo-91827: invoked by RejectReasonModal once the admin types a reason
  // and clicks Reject. Performs the actual API call(s), refreshes BOTH the
  // payouts list AND the prepay queue (a rejected prepayment correctly
  // re-appears in the queue), and closes the modal on success.
  // gouda-92103: the modal passes `silent` as a second-arg ack — true means
  // the admin ticked "Don't notify host"; false (default) preserves
  // pre-gouda behavior. Threaded into `rejectAdminPayout(id, reason, opts)`.
  async function confirmReject(reason: string, ackOpts: { silent: boolean }) {
    if (!rejectTarget) return;
    const rejectOpts = {
      ...(regions ? { regions } : {}),
      ...(ackOpts.silent ? { silent: true } : {}),
    };
    if (rejectTarget.kind === 'single') {
      setRowBusyId(rejectTarget.id);
      try {
        await rejectAdminPayout(rejectTarget.id, reason, rejectOpts);
        await Promise.all([refresh(), loadPrepayQueue()]);
        setRejectTarget(null);
      } catch (err: any) {
        setErrorMsg(err.message || 'Reject failed');
      } finally {
        setRowBusyId(null);
      }
    } else {
      setBulkBusy(true);
      try {
        for (const id of rejectTarget.ids) {
          await rejectAdminPayout(id, reason, rejectOpts).catch(() => null);
        }
        setSelectedIds(new Set());
        await Promise.all([refresh(), loadPrepayQueue()]);
        setRejectTarget(null);
      } finally {
        setBulkBusy(false);
      }
    }
  }

  async function handleBulkMarkPaid() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Mark ${selectedIds.size} payments as paid (no transaction refs)?`)) return;
    setBulkBusy(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await markAdminPayoutPaid(id, { note: 'bulk mark-paid' }).catch(() => null);
      }
      clearSelection();
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      await exportAdminPayoutsCsv(filters);
    } catch (err: any) {
      setErrorMsg(err.message || 'CSV export failed');
    } finally {
      setExporting(false);
    }
  }

  // Loading guard
  if (role.kind === 'loading') {
    return (
      <Layout>
        <div className="flex items-center justify-center py-32">
          <Loader2 size={32} className="animate-spin text-theme-text-muted" />
        </div>
      </Layout>
    );
  }

  if (role.kind === 'denied') {
    return (
      <Layout>
        <Helmet>
          <title>Payments — Access Denied | RSV.Pizza</title>
        </Helmet>
        <div className="flex flex-col items-center justify-center px-4 py-32">
          <ShieldX size={48} className="text-red-400/60 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-theme-text-muted text-center max-w-md">
            {/* argentina-92103: tailored message for regional portals so the
                UB knows which account to sign in as. Falls back to the
                global message for the unscoped /payments dashboard. */}
            {portalLabel
              ? `Sign in as the ${portalLabel} underboss or as an admin to view this portal.`
              : 'The host payments dashboard is only available to admins and payment admins.'}
          </p>
        </div>
      </Layout>
    );
  }

  const meUserId = ''; // not needed client-side — backend enforces self-payout block

  // argentina-92103: regional portals show "{PORTAL} Payments" in the
  // header + title (e.g. "LATAM Payments"). Underbosses also see a
  // softer subhead — they can review + flag but not send funds.
  const pageTitle = portalLabel ? `${portalLabel} Payments` : 'Host Payments';
  const viewerKind = role.viewerKind;
  const isUnderboss = viewerKind === 'underboss';

  return (
    <Layout>
      <Helmet>
        <title>{pageTitle} | RSV.Pizza</title>
      </Helmet>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <DollarSign size={20} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-theme-text">{pageTitle}</h1>
            <p className="text-sm text-theme-text-muted">
              {isUnderboss
                ? 'Review, approve, and flag payments ready for the payments team to pay.'
                : `Review, approve, and pay out host payments (${role.role.replace('_', ' ')})`}
            </p>
          </div>
          {totals && totals.totalUsdPending > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-sm font-medium">
              {formatUsd(totals.totalUsdPending)} pending
            </span>
          )}
          {/* argentina-92103: Record External Payment is funds-adjacent
              (it records a paid-status payout out-of-band). Stays admin-only. */}
          {!isUnderboss && (
            <button
              type="button"
              onClick={() => setExternalModalState({ open: true })}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
            >
              <Plus size={14} />
              Record External Payment
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-theme-surface border border-theme-stroke hover:bg-theme-surface-hover text-sm text-theme-text disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export CSV
          </button>
        </div>

        {/* coppa-91827: hot wallet address + ETH/USDC balances so admins know
            where to deposit funds and can verify they landed. Self-fetches.
            argentina-92103: read-only for regional underbosses — they can
            see balances but the refresh button + low-gas warning + "Base
            only" caption are hidden. */}
        <HotWalletCard readOnly={isUnderboss} />

        <PaymentsStatsCards totals={totals} loading={loading && !totals} />

        {/* taleggio-49183: the parmigiana-58291 "Totals by party" rollup table
            was removed here. Each PayoutRow already renders "Already paid:
            $X (N)" inline under the event name (powered by the same
            partyTotals aggregation on the backend), so the top table was
            duplicative. */}

        {/* bismarck-92103: Prepay queue — only renders when there's at least
            one matching party (host flagged prepay + saved payment method,
            no in-flight payouts).
            lardo-58294: client-side substring search above the table; header
            count flips to "{filtered} of {total}" while a query is active.
            pomodoro-58294: client-side sort control (country / city) sits on
            the same row to the right of the search input.
            Hidden via SHOW_PREPAY_QUEUE for now. */}
        {SHOW_PREPAY_QUEUE && prepayQueue.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-theme-text mb-3">
              {prepaySearch.trim()
                ? `Prepay queue (${sortedPrepayQueue.length} of ${prepayQueue.length} events)`
                : `Prepay queue (${prepayQueue.length} event${prepayQueue.length === 1 ? '' : 's'})`}
            </h2>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3">
              <div className="sm:max-w-md sm:flex-1">
                <IconInput
                  icon={Search}
                  type="text"
                  value={prepaySearch}
                  onChange={(e) => setPrepaySearch(e.target.value)}
                  placeholder="Search city, country, or host…"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs uppercase tracking-wide text-theme-text-muted">
                  Sort:
                </span>
                <select
                  value={prepaySort}
                  onChange={(e) => setPrepaySort(e.target.value as PrepaySortKey)}
                  className="bg-theme-surface border border-theme-stroke rounded text-sm text-theme-text px-2 py-1"
                >
                  <option value="newest">Newest first</option>
                  <option value="country_asc">Country (A→Z)</option>
                  <option value="country_desc">Country (Z→A)</option>
                  <option value="city_asc">City (A→Z)</option>
                  <option value="city_desc">City (Z→A)</option>
                </select>
              </div>
            </div>
            {prepayQueue.length > 0 && sortedPrepayQueue.length === 0 ? (
              <p className="text-sm text-theme-text-muted">
                No matches for "{prepaySearch.trim()}"
              </p>
            ) : (
              <PrepayQueueTable
                rows={sortedPrepayQueue}
                onCreatePrepayment={(row) => setPrepayModalRow(row)}
                onHostClick={(userId) => setHostDetailUserId(userId)}
                onPartyUpdated={() => loadPrepayQueue()}
                viewerRole={viewerKind}
                onMarkPartyPaid={(row) =>
                  setMarkPartyPaidTarget({
                    partyId: row.party.id,
                    partyNameHint: row.party.name,
                    // parmigiana-92104: PrepayQueueRow.party already carries
                    // country + eventTags so we can resolve the flag here and
                    // let MarkPartyPaidModal stay decoupled from the row shape.
                    isSwcHub: isSwcHubParty(row.party),
                  })
                }
              />
            )}
          </section>
        )}

        <PayoutsFilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          availableCurrencies={availableCurrencies}
          availableTags={availableTags}
          // pinsa-92103: Hide closed cities only makes sense on the by-city
          // view (paymentsClosedAt is a party-level signal). The per-payment
          // view has no party-row, so the toggle would be confusing there.
          showHideClosedToggle={viewMode === 'by-city'}
          // stracchino-92108: Hide possible scams, by-city view only (same as above).
          showHideScamsToggle={viewMode === 'by-city'}
          // pancetta-92103: Regions multi-select is the admin /payments tool;
          // regional sub-portals (`/payments/latam` etc.) are hard-scoped by
          // their `regionFilter` prop and shouldn't show a second region
          // picker on top of that.
          showRegionsFilter={!isRegionalPortal}
          // coppa-92106: hide the status tab strip in the Payments-ledger
          // view (status + sort are forced server-side; user can't override).
          showStatusTabs={viewMode !== 'payments'}
        />

        {/* etruria-92103: by-city / by-payment view toggle. by-city is the
            default; the choice persists in localStorage. Lives on its own
            row above the bulk-actions bar so it doesn't fight the filter
            bar's sticky position.
            coppa-92106: third "Payments" tab shows the actual payments ledger
            (status=paid|completed, proven-only, sorted by paid_at DESC). */}
        <div className="flex items-center justify-end gap-2 mb-3">
          <span className="text-xs uppercase tracking-wide text-theme-text-muted">View:</span>
          <div
            role="tablist"
            aria-label="Payments view mode"
            className="inline-flex rounded-lg overflow-hidden border border-theme-stroke bg-theme-surface"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-city'}
              onClick={() => setViewMode('by-city')}
              className={`px-3 py-1.5 text-sm font-medium ${
                viewMode === 'by-city'
                  ? 'bg-emerald-600 text-white'
                  : 'text-theme-text-muted hover:bg-theme-surface-hover'
              }`}
            >
              By city
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'by-payment'}
              onClick={() => setViewMode('by-payment')}
              className={`px-3 py-1.5 text-sm font-medium ${
                viewMode === 'by-payment'
                  ? 'bg-emerald-600 text-white'
                  : 'text-theme-text-muted hover:bg-theme-surface-hover'
              }`}
            >
              By payment
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'payments'}
              onClick={() => setViewMode('payments')}
              className={`px-3 py-1.5 text-sm font-medium ${
                viewMode === 'payments'
                  ? 'bg-emerald-600 text-white'
                  : 'text-theme-text-muted hover:bg-theme-surface-hover'
              }`}
            >
              Payments
            </button>
          </div>
        </div>

        {/* coppa-92106: breadcrumb under the toggle when the Payments-ledger
            view is active. Surfaces the forced status + sort so the admin
            knows why the status tab strip + KPI tiles don't drive this view. */}
        {viewMode === 'payments' && (
          <div className="mb-3 text-xs text-theme-text-muted">
            Showing all paid payments • Newest first
          </div>
        )}

        <BulkActionsBar
          selectedCount={selectedIds.size}
          selectedCityCount={selectedCityCount}
          onApprove={handleBulkApprove}
          onReject={handleBulkReject}
          onMarkPaid={handleBulkMarkPaid}
          onExportSafeJson={() => setShowSafeExportModal(true)}
          onBulkSend={() => setShowBulkSend(true)}
          eligibleBulkSendCount={eligibleBulkSendCount}
          onClear={clearSelection}
          busy={bulkBusy}
          viewerRole={viewerKind}
        />

        {errorMsg && (
          <div className="mb-3 px-4 py-2 rounded-lg text-sm bg-red-100 text-red-700 border border-red-300">
            {errorMsg}
          </div>
        )}

        {/* etruria-92103: render the by-city table when toggled on; the
            per-payment table is the fallback view + the "old" experience for
            admins who prefer the flat list. Both share the same handlers /
            selection state. Bulk-action selection still operates on per-
            payment ids — selecting a whole party doesn't make sense as a
            bulk-action concept, so selection lives inside the expansion.
            coppa-92106: the Payments-ledger view reuses PayoutsTable below
            with the loadPage-applied status=paid|completed filter. */}
        {viewMode === 'by-city' ? (
          <PayoutsByPartyTable
            rows={displayedByPartyRows}
            fakeScores={fakeScores}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onRowClick={openDetail}
            onApprove={handleRowApprove}
            onReject={handleRowReject}
            onEdit={openDetail}
            onMarkPaid={handleRowMarkPaid}
            onExecute={openDetail}
            onUnapprove={handleRowUnapprove}
            onHostClick={(userId) => setHostDetailUserId(userId)}
            onCapUpdated={() => refresh()}
            // bocconcini-92103: bridge the panettone-92103 "Mark party paid"
            // action into the by-city default view. Looks up the row so the
            // modal header can render the city name while the preview
            // request is in flight. Hidden for underbosses via viewerRole.
            onMarkPartyPaid={(partyId) => {
              const row = byPartyRows.find((r) => r.party.id === partyId);
              setMarkPartyPaidTarget({
                partyId,
                partyNameHint: row?.party.name ?? '',
                // parmigiana-92104: PartyPayoutsRow.party carries
                // country + eventTags — resolve the SWC Hub flag here so the
                // modal stays decoupled from the row shape.
                isSwcHub: isSwcHubParty(row?.party),
              });
            }}
            // Undo an accidental close. The table owns the reopenParty call +
            // busy spinner; we just refresh the feeds (statuses + close pill
            // changed) and flash a toast.
            onReopened={async (partyId, reopenedCount) => {
              const row = byPartyRows.find((r) => r.party.id === partyId);
              const name = (row?.party.name ?? 'City').replace(
                /^Global Pizza Party\s+/i,
                '',
              );
              pushToast(
                reopenedCount > 0
                  ? `Reopened ${name} — ${reopenedCount} payment${reopenedCount === 1 ? '' : 's'} restored to in-flight`
                  : `Reopened ${name}`,
                'success',
              );
              await Promise.all([refresh(), loadPrepayQueue()]);
            }}
            // mostarda-92103: city-level "Add external payment" — opens the
            // ExternalPaymentModal with the city name seeded in the party
            // picker so the admin can confirm-and-go. Admin-only via the
            // viewerRole gate on the menu.
            onAddExternalPayment={(_partyId, partyName) => {
              // The picker searches by name, not id — strip the GPP prefix
              // off so the search matches the visible label cleanly.
              const seed = partyName.replace(/^Global Pizza Party\s+/i, '');
              setExternalModalState({ open: true, initialQuery: seed });
            }}
            // salame-92106: city-level "Send payment" — opens SendPaymentModal
            // with the row's outstanding total, country, cap, paid-total, and
            // primary host id pre-loaded so the admin can confirm-and-send.
            // Admin-only via the viewerRole gate on the menu.
            onSendPayment={(row) => {
              // bresaola-49340: proof-gate the completed contribution so the
              // Send-payment modal's paid/outstanding defaults match the
              // by-city Paid column. Proofless completed close-outs (never
              // actually sent) drop out of both sums; completedUsd still counts
              // all completed, so we subtract the proofless subset here.
              const completedProvenUsd =
                (row.aggregates.completedUsd ?? 0)
                - (row.aggregates.completedNoProofUsd ?? 0);
              const approvedSumUsd =
                row.aggregates.approvedUsd
                + row.aggregates.paidUsd
                + completedProvenUsd;
              const paidSumUsd = row.aggregates.paidUsd + completedProvenUsd;
              const outstandingUsd = Math.max(0, approvedSumUsd - paidSumUsd);
              // gnocchi-92105: tally non-duplicate, eligible receipt OCR USD
              // across every payout on the party. Matches the coppa-92105 +
              // provola-92106 semantics used by the by-city Receipt total
              // cell so the modal default lines up with what the admin sees.
              const receiptsTotalUsd = computeReceiptsTotalUsd(row);
              // Pull in each host's submitted USDC wallet so the modal can
              // pre-fill it per recipient. Walk payouts newest-first (ISO
              // createdAt sorts lexically) and keep the first non-empty wallet
              // per recipient — preferring the original ENS input over the
              // resolved 0x (caciotta-92104). Only usdc_base payouts carry a
              // wallet, so presence is the filter.
              const hostWalletByUserId: Record<string, string> = {};
              const payoutsNewestFirst = [...row.payouts].sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              );
              for (const p of payoutsNewestFirst) {
                if (!p.hostUserId || hostWalletByUserId[p.hostUserId]) continue;
                const wallet = (p.payoutWalletInput || p.payoutWalletAddress || '').trim();
                if (wallet) hostWalletByUserId[p.hostUserId] = wallet;
              }
              // bufalina-60733: attach the looked-up fake-detection risk for
              // this party so the modal can gate the send behind an ack.
              const fake = fakeScores[row.party.id];
              setSendPaymentTarget({
                partyId: row.party.id,
                partyName: row.party.name,
                outstandingUsd,
                receiptsTotalUsd,
                country: row.party.country,
                eventTags: row.party.eventTags ?? [],
                effectiveReimbursementCapUsd: row.party.effectiveReimbursementCapUsd,
                paidTotalUsd: paidSumUsd,
                primaryHostUserId: row.party.userId ?? null,
                hostWalletByUserId,
                fakeScore: fake?.score,
                fakeTier: fake?.tier,
                fakeTopFlags: fake?.topFlags,
              });
            }}
            // bottarga-92104: after the table toggles the `possible-scam` tag,
            // surface a toast and patch the in-memory row's eventTags so the
            // pill survives a re-render even before the next full refresh.
            // The table also keeps its own optimistic override, so this is
            // belt + suspenders — but it also catches downstream consumers
            // (filter chips, counts) that read off byPartyRows directly.
            onScamFlagChanged={(partyId, nextTags) => {
              setByPartyRows((prev) =>
                prev.map((r) =>
                  r.party.id === partyId
                    ? { ...r, party: { ...r.party, eventTags: nextTags } }
                    : r,
                ),
              );
              const flagged = nextTags.includes('possible-scam');
              pushToast(
                flagged
                  ? 'Flagged as possible scam'
                  : 'Unflagged possible scam',
                'success',
              );
            }}
            // panuozzo-58217: custom-tag add/remove — patch the row's eventTags
            // in place (mirrors the scam-flag handler) and flash a toast.
            onTagsChanged={(partyId, nextTags) => {
              setByPartyRows((prev) =>
                prev.map((r) =>
                  r.party.id === partyId
                    ? { ...r, party: { ...r.party, eventTags: nextTags } }
                    : r,
                ),
              );
              pushToast('Custom tags updated', 'success');
            }}
            // crocchetta-92106: Send-receipts-reminder result toast. The
            // backend returns per-channel success + skip reason; we render
            // each channel as a "✓"/"–" so the admin can see at a glance
            // whether both messages went out, or just the group post when
            // the host hasn't linked TG yet.
            onTgReminderResult={(_partyId, result) => {
              if ('error' in result) {
                pushToast(
                  `Could not send reminder: ${result.error}`,
                  'error',
                );
                return;
              }
              const hostLabel = result.hostDmSent
                ? 'DM ✓'
                : `DM skipped${
                    result.hostDmReason ? ` (${result.hostDmReason})` : ''
                  }`;
              const groupLabel = result.groupSent
                ? 'Group ✓'
                : `Group skipped${
                    result.groupReason ? ` (${result.groupReason})` : ''
                  }`;
              const tone =
                result.hostDmSent || result.groupSent ? 'success' : 'error';
              pushToast(`Reminder: ${hostLabel} | ${groupLabel}`, tone);
            }}
            // Wallet reminder — same per-channel success/skip toast as the
            // receipts reminder.
            onTgWalletReminderResult={(_partyId, result) => {
              if ('error' in result) {
                pushToast(
                  `Could not send wallet reminder: ${result.error}`,
                  'error',
                );
                return;
              }
              const hostLabel = result.hostDmSent
                ? 'DM ✓'
                : `DM skipped${
                    result.hostDmReason ? ` (${result.hostDmReason})` : ''
                  }`;
              const groupLabel = result.groupSent
                ? 'Group ✓'
                : `Group skipped${
                    result.groupReason ? ` (${result.groupReason})` : ''
                  }`;
              const tone =
                result.hostDmSent || result.groupSent ? 'success' : 'error';
              pushToast(`Wallet reminder: ${hostLabel} | ${groupLabel}`, tone);
            }}
            // crocchetta-92107: sheet-derived city → TG group chat_id map so
            // the Send-receipts-reminder action can post into the city's
            // group chat (same source /underboss uses). Reused by the wallet
            // reminder too.
            cityGroupChatIds={cityGroupChatIds}
            viewerRole={viewerKind}
            busyRowId={rowBusyId}
            loading={loading}
          />
        ) : (
          <PayoutsTable
            payouts={payouts}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onRowClick={openDetail}
            onApprove={handleRowApprove}
            onReject={handleRowReject}
            onEdit={openDetail}
            onMarkPaid={handleRowMarkPaid}
            onExecute={openDetail}
            onUnapprove={handleRowUnapprove}
            onHostClick={(userId) => setHostDetailUserId(userId)}
            onCapUpdated={() => refresh()}
            busyRowId={rowBusyId}
            loading={loading}
            loadingMore={loadingMore}
            onLoadMore={() => loadPage({ ...filters, cursor: nextCursor || undefined }, true)}
            hasMore={!!nextCursor}
          />
        )}

        {detailLoading && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white" />
          </div>
        )}

        {detail && (
          <PayoutReviewModal
            payout={detail}
            // Self-payout block is enforced server-side; if the actor's email
            // matches the host's, surface a visual cue. (Backend will return
            // 403 if they try anyway.)
            selfPayoutBlocked={
              role.kind === 'allowed' &&
              role.role === 'payment_admin' &&
              !!detail.host.email &&
              detail.host.email.toLowerCase() === role.email.toLowerCase()
            }
            busy={modalBusy}
            onClose={closeDetail}
            onApprove={async (note, opts) => {
              setModalBusy(true);
              try {
                await approveAdminPayout(detail.id, {
                  note,
                  ...(regions ? { regions } : {}),
                  // nduja-92106: forward the per-party cap override ack so the
                  // backend skips its bocconcini-49102 recheck + records the
                  // override marker on the audit row.
                  ...(opts?.allowOverPartyCap ? { allowOverPartyCap: true } : {}),
                });
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Approve failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onReject={async (reason, opts) => {
              setModalBusy(true);
              try {
                // gouda-92103: forward the modal's silent ack (when ticked)
                // alongside the regional scope. Default (undefined) preserves
                // today's notify-on-reject contract.
                const rejectOpts = {
                  ...(regions ? { regions } : {}),
                  ...(opts?.silent ? { silent: true } : {}),
                };
                await rejectAdminPayout(detail.id, reason, rejectOpts);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Reject failed');
              } finally {
                setModalBusy(false);
              }
            }}
            // caprino-92103: stay-open after revert so the admin sees the
            // new pending state in the modal (and can immediately re-approve
            // if they want). Returns the error message string on failure so
            // PayoutReviewModal can render it inline below the footer.
            onUnapprove={async () => {
              setModalBusy(true);
              try {
                await unapproveAdminPayout(detail.id, regions ? { regions } : undefined);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await Promise.all([refresh(), loadPrepayQueue()]);
                return;
              } catch (err: any) {
                return err?.message || 'Revert failed';
              } finally {
                setModalBusy(false);
              }
            }}
            // brie-92108: un-reject -> pending. Stays open + refreshes both
            // lists like unapprove so the admin sees the new pending state.
            onReopen={async () => {
              setModalBusy(true);
              try {
                await unrejectAdminPayout(detail.id, regions ? { regions } : undefined);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await Promise.all([refresh(), loadPrepayQueue()]);
              } catch (err: any) {
                setErrorMsg(err.message || 'Unreject failed');
              } finally {
                setModalBusy(false);
              }
            }}
            // culatello-92103: revert a paid payout back to approved. Works
            // for every payout method (USDC, wire, mercury_card, external,
            // off-platform). Stays-open + refreshes the same way unapprove
            // does so the admin can immediately re-execute / re-mark-paid.
            // Toast on success surfaces the method so the admin can confirm
            // the right row reverted.
            onRevertPaid={async () => {
              setModalBusy(true);
              try {
                const priorMethod = detail.payoutMethod;
                await revertPaidAdminPayout(detail.id);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await Promise.all([refresh(), loadPrepayQueue()]);
                const m = fresh.payoutMethod ?? priorMethod;
                const methodLabel =
                  m === 'usdc_base'
                    ? 'USDC'
                    : m === 'wire'
                      ? 'wire'
                      : m === 'mercury_card'
                        ? 'Mercury card'
                        : m === 'external'
                          ? 'external'
                          : m === 'off_platform'
                            ? 'off-platform'
                            : (m ?? 'external');
                pushToast(`Reverted ${methodLabel} payment to approved status`, 'success');
                return;
              } catch (err: any) {
                return err?.message || 'Revert failed';
              } finally {
                setModalBusy(false);
              }
            }}
            // gnocchi-92104: mark-queued = approved -> queued (wire request
            // sent, awaiting settlement). Stays-open like unapprove/revertPaid
            // so admin sees the queued pill flip in-modal. Refreshes the
            // payouts list (so the row shows the new pill) and the prepay
            // queue (so the source party drops off since 'queued' is now in
            // the in-flight set).
            onMarkQueued={async () => {
              setModalBusy(true);
              try {
                await markPayoutQueued(detail.id);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await Promise.all([refresh(), loadPrepayQueue()]);
                pushToast('Marked queued — wire request sent', 'success');
                return;
              } catch (err: any) {
                return err?.message || 'Mark queued failed';
              } finally {
                setModalBusy(false);
              }
            }}
            // gnocchi-92104: un-queue = queued -> approved (admin oops
            // un-queue). Same stays-open/refresh pattern.
            onUnmarkQueued={async () => {
              setModalBusy(true);
              try {
                await unmarkPayoutQueued(detail.id);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await Promise.all([refresh(), loadPrepayQueue()]);
                pushToast('Un-queued — payment back to approved', 'success');
                return;
              } catch (err: any) {
                return err?.message || 'Un-queue failed';
              } finally {
                setModalBusy(false);
              }
            }}
            onSaveAmount={async (newAmount, opts) => {
              setModalBusy(true);
              try {
                await updateAdminPayout(
                  detail.id,
                  {
                    finalAmountUsd: newAmount,
                    note: opts?.note,
                    // aglio-62584: forward the admin's per-submission cap
                    // acknowledgement so the backend bypasses the 400.
                    allowOverSubmissionCap: opts?.allowOverSubmissionCap,
                  },
                  // cannelloni-92103: thread `?regions=` so regional UB
                  // PATCH passes the `requireAdminOrRegionalUnderboss`
                  // gate on the backend.
                  regions ? { regions } : undefined,
                );
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await refresh();
                return;
              } catch (err: any) {
                // aglio-62584: return the message instead of swallowing it
                // into the page-level error so PayoutReviewModal can render
                // it inline (was previously silent — clicking Save on a
                // grandfathered $750 row just did nothing visible).
                return err?.message || 'Save failed';
              } finally {
                setModalBusy(false);
              }
            }}
            onSaveAdminNotes={async (notes) => {
              setModalBusy(true);
              try {
                await updateAdminPayout(
                  detail.id,
                  { adminNotes: notes },
                  // cannelloni-92103: same regions thread for UB notes edits.
                  regions ? { regions } : undefined,
                );
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
              } catch (err: any) {
                setErrorMsg(err.message || 'Save failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onMarkPaid={async (refs) => {
              setModalBusy(true);
              try {
                await markAdminPayoutPaid(detail.id, refs);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Mark-paid failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onExecute={async (body) => {
              setModalBusy(true);
              try {
                await executeAdminPayout(detail.id, body);
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Execute failed');
                // Refresh anyway — USDC failure flips status to 'failed' server-side.
                try {
                  const fresh = await getAdminPayout(detail.id);
                  setDetail(fresh);
                  await refresh();
                } catch {
                  /* ignore */
                }
              } finally {
                setModalBusy(false);
              }
            }}
            fetchUsdcCapRemaining={async () => {
              try {
                return await getUsdcDailyCapRemaining();
              } catch {
                return null;
              }
            }}
            fetchWalletPaidTotal={async (address, amount) => {
              try {
                return await fetchWalletPaidTotal(address, amount);
              } catch {
                return null;
              }
            }}
            onPayAgain={handlePayAgain}
            // tagliatelle-49102: surface the actor's role so the modal can
            // gate the in-modal event_tags editor. `payment_admin` sees the
            // chips read-only; `admin` / `super_admin` get add + remove.
            // argentina-92103: underbosses pass `null` here so the tag
            // editor stays read-only for them too.
            adminRole={
              role.kind === 'allowed' && role.role !== 'underboss' ? role.role : null
            }
            // argentina-92103: viewer-role threading. The modal hides
            // Execute / Mark-paid for underbosses and surfaces the green
            // Flag-ready button.
            viewerRole={viewerKind}
            onFlagReady={async () => {
              setModalBusy(true);
              try {
                const fresh = await flagReadyForPayment(
                  detail.id,
                  regions ? { regions } : undefined,
                );
                setDetail(fresh);
                await refresh();
                return;
              } catch (err: any) {
                return err?.message || 'Flag failed';
              } finally {
                setModalBusy(false);
              }
            }}
            // panettone-92103: open MarkPartyPaidModal pre-targeted at this
            // payout's party so the admin can flip every in-flight payout on
            // the event in one click. Admin-only (PayoutReviewModal already
            // gates this on viewerRole='admin').
            onMarkPartyPaid={() =>
              setMarkPartyPaidTarget({
                partyId: detail.partyId,
                partyNameHint: detail.party.name,
                // parmigiana-92104: PayoutReviewModal's `payout.party` has
                // country + eventTags surfaced — propagate the SWC Hub flag.
                isSwcHub: isSwcHubParty(detail.party),
              })
            }
            // tagliatelle-49102: after a tag mutation, refresh the payouts
            // list so the row picks up the new tag set (effective cap, etc.).
            // Re-fetch the modal detail too so its local `payout.party.eventTags`
            // stays in sync with anything the backend derives.
            onTagsChanged={async () => {
              try {
                const fresh = await getAdminPayout(detail.id, regions ? { regions } : undefined);
                setDetail(fresh);
              } catch {
                /* ignore — modal already updated its local state */
              }
              await refresh();
            }}
          />
        )}
        {externalModalState.open && (
          <ExternalPaymentModal
            onClose={() => setExternalModalState({ open: false })}
            onCreated={() => refresh()}
            initialQuery={externalModalState.initialQuery}
          />
        )}

        {/* salame-92106: actively-send modal. Differs from the external/mark-
            paid flows: this creates + approves + executes a real payout via
            rsv.pizza's payment infrastructure (USDC via Privy server-wallet,
            wire confirmation, Mercury card). Refreshes the by-party rows on
            success so the row's Paid total updates immediately. */}
        {sendPaymentTarget && (
          <SendPaymentModal
            partyId={sendPaymentTarget.partyId}
            partyName={sendPaymentTarget.partyName}
            outstandingUsd={sendPaymentTarget.outstandingUsd}
            receiptsTotalUsd={sendPaymentTarget.receiptsTotalUsd}
            country={sendPaymentTarget.country}
            eventTags={sendPaymentTarget.eventTags}
            effectiveReimbursementCapUsd={
              sendPaymentTarget.effectiveReimbursementCapUsd
            }
            paidTotalUsd={sendPaymentTarget.paidTotalUsd}
            primaryHostUserId={sendPaymentTarget.primaryHostUserId}
            hostWalletByUserId={sendPaymentTarget.hostWalletByUserId}
            fakeScore={sendPaymentTarget.fakeScore}
            fakeTier={sendPaymentTarget.fakeTier}
            fakeTopFlags={sendPaymentTarget.fakeTopFlags}
            onClose={() => setSendPaymentTarget(null)}
            onSent={async ({ partyName: sentTo, method, amountUsd }) => {
              const methodLabel =
                method === 'usdc_base'
                  ? 'USDC'
                  : method === 'wire'
                    ? 'wire'
                    : 'Mercury card';
              pushToast(
                `Sent ${methodLabel} payment of $${amountUsd.toFixed(2)} to ${sentTo}`,
                'success',
              );
              await Promise.all([refresh(), loadPrepayQueue()]);
            }}
          />
        )}

        {prepayModalRow && (
          <CreatePrepaymentModal
            row={prepayModalRow}
            onClose={() => setPrepayModalRow(null)}
            onCreated={handlePrepaymentCreated}
          />
        )}

        {/* panettone-92103: party-level "Mark party paid" modal. Refreshes
            BOTH the payouts list (so flipped rows show paid) and the prepay
            queue (so the source party drops off). If the review modal was
            open over this party, refresh its detail too so the admin sees
            the rows reflect the new state. */}
        {markPartyPaidTarget && (
          <MarkPartyPaidModal
            partyId={markPartyPaidTarget.partyId}
            partyNameHint={markPartyPaidTarget.partyNameHint}
            // parmigiana-92104: forward the resolved SWC Hub flag so the
            // modal can render the warning + ack.
            isSwcHub={markPartyPaidTarget.isSwcHub}
            onClose={() => setMarkPartyPaidTarget(null)}
            onSuccess={async ({ count, mode, partyName, action, paymentsClosedAt }) => {
              // caciotta-92103 + pinsa-92103 + provolone-92103: split the
              // toast copy by the resolved server action so the admin gets a
              // clear signal whether they (a) flipped payouts to paid,
              // (b) closed out pending claims as completed
              // (mark_pending_complete), (c) closed out a fully-paid city
              // (pinsa), or (d) the city was already closed / no-op.
              let toastMsg: string;
              if (action === 'closed') {
                toastMsg = `Closed out ${partyName} — all payouts already paid`;
              } else if (action === 'already_closed') {
                toastMsg = `${partyName} is already closed out`;
              } else if (action === 'noop') {
                toastMsg = `No payouts to action for ${partyName}`;
              } else if (action === 'mark_pending_complete' || mode === 'mark_pending_complete') {
                toastMsg = count > 0
                  ? `Marked ${count} pending claim${count === 1 ? '' : 's'} complete for ${partyName}`
                  : `No in-flight payouts for ${partyName} — nothing changed`;
              } else if (count > 0) {
                const closedNow = !!paymentsClosedAt;
                toastMsg = closedNow
                  ? `Marked ${count} payment${count === 1 ? '' : 's'} paid for ${partyName} — city closed out`
                  : `Marked ${count} payment${count === 1 ? '' : 's'} paid for ${partyName}`;
              } else {
                toastMsg = `No in-flight payouts for ${partyName} — nothing changed`;
              }
              pushToast(toastMsg, 'success');
              await Promise.all([refresh(), loadPrepayQueue()]);
              if (detail && detail.partyId === markPartyPaidTarget.partyId) {
                try {
                  const fresh = await getAdminPayout(
                    detail.id,
                    regions ? { regions } : undefined,
                  );
                  setDetail(fresh);
                } catch {
                  /* non-fatal */
                }
              }
            }}
          />
        )}

        {/* siciliana-69183: read-only host payment-details modal — opens when
            the admin clicks a host name on the prepay queue or payouts table. */}
        <HostPaymentDetailsModal
          userId={hostDetailUserId}
          onClose={() => setHostDetailUserId(null)}
        />

        {/* crudo-91827: in-app reject-reason modal. Replaces window.prompt()
            which gets silently blocked by popup blockers in some browsers. */}
        <RejectReasonModal
          isOpen={!!rejectTarget}
          context={
            rejectTarget?.kind === 'single'
              ? { kind: 'single', hostName: rejectTarget.hostName }
              : rejectTarget?.kind === 'bulk'
              ? { kind: 'bulk', count: rejectTarget.ids.length }
              : { kind: 'single', hostName: '' }
          }
          onCancel={() => setRejectTarget(null)}
          onConfirm={confirmReject}
        />

        {/* siciliana-69183: Safe Transaction Builder batch export. */}
        {showSafeExportModal && (
          <ExportSafeJsonModal
            selected={selectedPayouts}
            onClose={() => setShowSafeExportModal(false)}
            onExported={(summary) => {
              pushToast(
                `Exported Safe batch: ${summary.included} transfer${summary.included === 1 ? '' : 's'}` +
                  (summary.skipped > 0 ? ` (${summary.skipped} skipped)` : ''),
                'success',
              );
            }}
          />
        )}

        {/* salsiccia-49102: bulk USDC send for selected approved payouts.
            onComplete refreshes BOTH the payouts list (so paid rows flip to
            'paid') and the prepay queue (so the source rows drop off). */}
        <BulkSendModal
          isOpen={showBulkSend}
          selectedPayouts={selectedPayouts}
          onCancel={() => setShowBulkSend(false)}
          onComplete={async (results: BulkSendResult[]) => {
            const paid = results.filter((r) => r.status === 'paid').length;
            const failed = results.filter((r) => r.status === 'failed').length;
            pushToast(
              `Bulk send: ${paid} paid${failed > 0 ? `, ${failed} failed` : ''}`,
              failed > 0 ? 'error' : 'success',
            );
            clearSelection();
            await Promise.all([refresh(), loadPrepayQueue()]);
          }}
        />

        {/* siciliana-69183: toast stack (bottom-right, 3s auto-dismiss). */}
        {toasts.length > 0 && (
          <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-lg border-l-4 ${
                  t.kind === 'success'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-100'
                    : 'bg-red-500/15 border-red-500 text-red-100'
                }`}
              >
                {t.message}
              </div>
            ))}
          </div>
        )}

        {/* meUserId placeholder to silence unused-warning while client-side comparison stays optional */}
        <input type="hidden" value={meUserId} />
      </main>
    </Layout>
  );
}
