import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ShieldX, Loader2, DollarSign, Download, Plus, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import {
  fetchAdminMe,
  listAdminPayouts,
  getAdminPayout,
  approveAdminPayout,
  rejectAdminPayout,
  updateAdminPayout,
  markAdminPayoutPaid,
  executeAdminPayout,
  getUsdcDailyCapRemaining,
  exportAdminPayoutsCsv,
  fetchPrepayQueue,
} from '../lib/api';
import type {
  AdminPayout,
  AdminPayoutDetail,
  AdminPayoutFilters,
  AdminPayoutTotals,
  PrepayQueueRow,
} from '../types';
import { formatUsd } from '../components/payments-shared';
import {
  PayoutsFilterBar,
  PayoutsTable,
  PayoutReviewModal,
  PaymentsStatsCards,
  BulkActionsBar,
  ExternalPaymentModal,
  PrepayQueueTable,
  CreatePrepaymentModal,
  HostPaymentDetailsModal,
  ExportSafeJsonModal,
  RejectReasonModal,
} from '../components/payments-admin';

type RoleState =
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'allowed'; role: 'admin' | 'super_admin' | 'payment_admin'; email: string };

const DEFAULT_FILTERS: AdminPayoutFilters = {
  status: 'all',
  payoutMethod: 'all',
  currency: 'all',
};

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

export function PaymentsAdminPage() {
  const [role, setRole] = useState<RoleState>({ kind: 'loading' });
  const [filters, setFilters] = useState<AdminPayoutFilters>(DEFAULT_FILTERS);
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
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

  // External payment modal (arugula-38633 v2 follow-up)
  const [showExternalModal, setShowExternalModal] = useState(false);

  // bismarck-92103: prepay queue + the "Create prepayment" modal target row.
  const [prepayQueue, setPrepayQueue] = useState<PrepayQueueRow[]>([]);
  const [prepayModalRow, setPrepayModalRow] = useState<PrepayQueueRow | null>(null);

  // lardo-58294: local-only substring filter for the prepay queue. Cleared
  // on tab refresh — no persistence.
  const [prepaySearch, setPrepaySearch] = useState('');

  // siciliana-69183: clickable host name opens the read-only payment-details
  // modal. Holds the User.id; null = modal closed.
  const [hostDetailUserId, setHostDetailUserId] = useState<string | null>(null);

  // siciliana-69183: Safe Transaction Builder JSON export. Modal is mounted
  // when true; the modal itself filters non-USDC / missing-wallet rows.
  const [showSafeExportModal, setShowSafeExportModal] = useState(false);

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

  const loadPrepayQueue = useCallback(async () => {
    try {
      const rows = await fetchPrepayQueue();
      setPrepayQueue(rows);
    } catch {
      // Non-fatal — the rest of the dashboard works without it. Silently
      // collapse the section by leaving the array empty.
      setPrepayQueue([]);
    }
  }, []);

  // Role gate
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchAdminMe();
        if (cancelled) return;
        const r = me.role;
        if (me.isAdmin && (r === 'admin' || r === 'super_admin' || r === 'payment_admin')) {
          setRole({ kind: 'allowed', role: r, email: me.email || '' });
        } else {
          setRole({ kind: 'denied' });
        }
      } catch {
        if (!cancelled) setRole({ kind: 'denied' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadPage = useCallback(async (f: AdminPayoutFilters, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setErrorMsg(null);
    try {
      const res = await listAdminPayouts(f);
      setPayouts((prev) => (append ? [...prev, ...res.payouts] : res.payouts));
      setTotals(res.totals);
      setNextCursor(res.nextCursor);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load payments');
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

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

  // siciliana-69183: derive the AdminPayout objects matching `selectedIds` for
  // the Safe-export modal. The modal itself filters non-USDC / missing-wallet
  // rows; we just hand it the full selection.
  const selectedPayouts = useMemo(
    () => payouts.filter((p) => selectedIds.has(p.id)),
    [payouts, selectedIds],
  );

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

  async function openDetail(p: AdminPayout) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await getAdminPayout(p.id);
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
      await approveAdminPayout(id);
      // crudo-91827: refresh BOTH lists — an approved prepayment row stays in
      // the payouts table but may affect prepay-queue derivations.
      await Promise.all([refresh(), loadPrepayQueue()]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Approve failed');
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
      const d = await getAdminPayout(p.id);
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
        await approveAdminPayout(id).catch(() => null);
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
  async function confirmReject(reason: string) {
    if (!rejectTarget) return;
    if (rejectTarget.kind === 'single') {
      setRowBusyId(rejectTarget.id);
      try {
        await rejectAdminPayout(rejectTarget.id, reason);
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
          await rejectAdminPayout(id, reason).catch(() => null);
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
            The host payments dashboard is only available to admins and payment admins.
          </p>
        </div>
      </Layout>
    );
  }

  const meUserId = ''; // not needed client-side — backend enforces self-payout block

  return (
    <Layout>
      <Helmet>
        <title>Host Payments | RSV.Pizza</title>
      </Helmet>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <DollarSign size={20} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-theme-text">Host Payments</h1>
            <p className="text-sm text-theme-text-muted">
              Review, approve, and pay out host payments ({role.role.replace('_', ' ')})
            </p>
          </div>
          {totals && totals.totalUsdPending > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-sm font-medium">
              {formatUsd(totals.totalUsdPending)} pending
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowExternalModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            <Plus size={14} />
            Record External Payment
          </button>
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

        <PaymentsStatsCards totals={totals} loading={loading && !totals} />

        {/* bismarck-92103: Prepay queue — only renders when there's at least
            one matching party (host flagged prepay + saved payment method,
            no in-flight payouts).
            lardo-58294: client-side substring search above the table; header
            count flips to "{filtered} of {total}" while a query is active. */}
        {prepayQueue.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-theme-text mb-3">
              {prepaySearch.trim()
                ? `Prepay queue (${filteredPrepayQueue.length} of ${prepayQueue.length} events)`
                : `Prepay queue (${prepayQueue.length} event${prepayQueue.length === 1 ? '' : 's'})`}
            </h2>
            <div className="mb-3 max-w-md">
              <IconInput
                icon={Search}
                type="text"
                value={prepaySearch}
                onChange={(e) => setPrepaySearch(e.target.value)}
                placeholder="Search city, country, or host…"
              />
            </div>
            {filteredPrepayQueue.length === 0 ? (
              <p className="text-sm text-theme-text-muted">
                No matches for "{prepaySearch.trim()}"
              </p>
            ) : (
              <PrepayQueueTable
                rows={filteredPrepayQueue}
                onCreatePrepayment={(row) => setPrepayModalRow(row)}
                onHostClick={(userId) => setHostDetailUserId(userId)}
              />
            )}
          </section>
        )}

        <PayoutsFilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          availableCurrencies={availableCurrencies}
        />

        <BulkActionsBar
          selectedCount={selectedIds.size}
          onApprove={handleBulkApprove}
          onReject={handleBulkReject}
          onMarkPaid={handleBulkMarkPaid}
          onExportSafeJson={() => setShowSafeExportModal(true)}
          onClear={clearSelection}
          busy={bulkBusy}
        />

        {errorMsg && (
          <div className="mb-3 px-4 py-2 rounded-lg text-sm bg-red-100 text-red-700 border border-red-300">
            {errorMsg}
          </div>
        )}

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
          onHostClick={(userId) => setHostDetailUserId(userId)}
          busyRowId={rowBusyId}
          loading={loading}
          loadingMore={loadingMore}
          onLoadMore={() => loadPage({ ...filters, cursor: nextCursor || undefined }, true)}
          hasMore={!!nextCursor}
        />

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
            onApprove={async (note) => {
              setModalBusy(true);
              try {
                await approveAdminPayout(detail.id, { note });
                const fresh = await getAdminPayout(detail.id);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Approve failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onReject={async (reason) => {
              setModalBusy(true);
              try {
                await rejectAdminPayout(detail.id, reason);
                const fresh = await getAdminPayout(detail.id);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Reject failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onSaveAmount={async (newAmount, note) => {
              setModalBusy(true);
              try {
                await updateAdminPayout(detail.id, { finalAmountUsd: newAmount, note });
                const fresh = await getAdminPayout(detail.id);
                setDetail(fresh);
                await refresh();
              } catch (err: any) {
                setErrorMsg(err.message || 'Save failed');
              } finally {
                setModalBusy(false);
              }
            }}
            onSaveAdminNotes={async (notes) => {
              setModalBusy(true);
              try {
                await updateAdminPayout(detail.id, { adminNotes: notes });
                const fresh = await getAdminPayout(detail.id);
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
                const fresh = await getAdminPayout(detail.id);
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
                const fresh = await getAdminPayout(detail.id);
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
          />
        )}
        {showExternalModal && (
          <ExternalPaymentModal
            onClose={() => setShowExternalModal(false)}
            onCreated={() => refresh()}
          />
        )}

        {prepayModalRow && (
          <CreatePrepaymentModal
            row={prepayModalRow}
            onClose={() => setPrepayModalRow(null)}
            onCreated={handlePrepaymentCreated}
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
