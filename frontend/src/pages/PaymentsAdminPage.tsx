import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ShieldX, Loader2, DollarSign, Download, Plus } from 'lucide-react';
import { Layout } from '../components/Layout';
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

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const p of payouts) {
      if (p.originalCurrency) set.add(p.originalCurrency.toUpperCase());
    }
    return Array.from(set).sort();
  }, [payouts]);

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
  async function handlePrepaymentCreated() {
    await Promise.all([refresh(), loadPrepayQueue()]);
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
      await refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Approve failed');
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleRowReject(id: string) {
    const reason = window.prompt('Rejection reason (visible to host):');
    if (!reason || !reason.trim()) return;
    setRowBusyId(id);
    try {
      await rejectAdminPayout(id, reason.trim());
      await refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Reject failed');
    } finally {
      setRowBusyId(null);
    }
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
      await refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleBulkReject() {
    if (selectedIds.size === 0) return;
    const reason = window.prompt('Rejection reason (applied to all selected):');
    if (!reason || !reason.trim()) return;
    setBulkBusy(true);
    try {
      for (const id of Array.from(selectedIds)) {
        await rejectAdminPayout(id, reason.trim()).catch(() => null);
      }
      clearSelection();
      await refresh();
    } finally {
      setBulkBusy(false);
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
            no in-flight payouts). */}
        {prepayQueue.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-theme-text mb-3">
              Prepay queue ({prepayQueue.length} event{prepayQueue.length === 1 ? '' : 's'})
            </h2>
            <PrepayQueueTable
              rows={prepayQueue}
              onCreatePrepayment={(row) => setPrepayModalRow(row)}
            />
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

        {/* meUserId placeholder to silence unused-warning while client-side comparison stays optional */}
        <input type="hidden" value={meUserId} />
      </main>
    </Layout>
  );
}
