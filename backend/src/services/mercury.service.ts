/**
 * stromboli-58524: Mercury API client + wire-reconciliation service.
 *
 * Mercury does not support webhooks for incoming wire notifications, so we
 * poll on demand (button-triggered MVP — no cron yet).
 *
 * Environment variables (all backend-only, never exposed to frontend):
 *   MERCURY_API_TOKEN   — Bearer token for Mercury API
 *   MERCURY_ACCOUNT_ID  — Mercury account UUID to poll
 *   MERCURY_API_BASE    — Optional override; defaults to https://api.mercury.com/api/v1
 */

import { prisma } from '../config/database.js';

const MERCURY_API_BASE = process.env.MERCURY_API_BASE ?? 'https://api.mercury.com/api/v1';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface MercuryTransaction {
  txnId: string;
  amountCents: number;   // positive = credit (incoming)
  currency: string;
  memo: string | null;
  counterparty: string | null;
  postedAt: string | null;
  kind: 'credit' | 'debit' | 'other';
}

export interface ReconcileResult {
  autoPaid: number;
  needsReview: number;
  unmatched: number;
  needsReviewRows: Array<{
    id: string;
    mercuryTxnId: string;
    amount: number;
    currency: string | null;
    memo: string | null;
    counterparty: string | null;
    postedAt: Date | null;
    status: string;
    invoiceId: string | null;
  }>;
}

// ──────────────────────────────────────────────
// Mercury API client
// ──────────────────────────────────────────────

/**
 * Fetch incoming (credit) transactions from Mercury.
 * Returns [] (graceful no-op) if env vars are missing.
 */
export async function getIncomingTransactions(sinceISO?: string): Promise<MercuryTransaction[]> {
  const token = process.env.MERCURY_API_TOKEN;
  const accountId = process.env.MERCURY_ACCOUNT_ID;

  if (!token || !accountId) {
    console.warn('[mercury] MERCURY_API_TOKEN or MERCURY_ACCOUNT_ID not set — skipping poll');
    return [];
  }

  try {
    const url = new URL(`${MERCURY_API_BASE}/account/${accountId}/transactions`);
    if (sinceISO) {
      url.searchParams.set('start', sinceISO);
    }
    // Only incoming credits
    url.searchParams.set('kind', 'credit');

    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[mercury] transactions API error ${resp.status}: ${body}`);
      return [];
    }

    const data = (await resp.json()) as { transactions?: any[] };
    const raw: any[] = data.transactions ?? [];

    return raw
      .filter((t) => t.amount != null && t.amount > 0)
      .map((t) => ({
        txnId: String(t.id),
        amountCents: Math.round(Number(t.amount) * 100),
        currency: (t.currencyExponent == null ? 'usd' : 'usd'), // Mercury only handles USD
        memo: t.note ?? t.externalMemo ?? null,
        counterparty:
          t.counterpartyName ??
          t.counterpartyNickname ??
          t.bankDescription ??
          null,
        postedAt: t.postedAt ?? t.createdAt ?? null,
        kind: 'credit' as const,
      }));
  } catch (err) {
    console.error('[mercury] Failed to fetch transactions:', err);
    return [];
  }
}

// ──────────────────────────────────────────────
// Shared helper — mark an invoice paid (internal)
// ──────────────────────────────────────────────

/**
 * Shared with invoice.routes.ts hostRouter mark-paid path.
 * Sets invoice status → paid, timestamps, payment fields,
 * and updates the related sponsor status → paid.
 */
export async function markInvoicePaidInternal(
  invoiceId: string,
  opts: { paymentMethod: string; paymentRef: string; paidAmount: number }
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'paid',
      paidAt: new Date(),
      paidAmount: opts.paidAmount,
      paymentMethod: opts.paymentMethod,
      paymentRef: opts.paymentRef,
    },
  });

  await prisma.sponsor.update({
    where: { id: invoice.sponsorId },
    data: { status: 'paid' },
  });
}

// ──────────────────────────────────────────────
// Reconciler
// ──────────────────────────────────────────────

/**
 * Pull recent Mercury credits and reconcile against open invoices.
 *
 * Matching rules:
 *  - Exact:       amountCents === invoice.total AND memo contains invoiceNumber
 *                 → mark invoice paid, upsert match status='auto_paid'
 *  - Amount-only: amount matches exactly one open invoice but memo lacks number
 *                 → upsert status='needs_review', do NOT mark paid
 *  - Ambiguous:   0 or >1 amount matches
 *                 → upsert status='unmatched', invoice_id=null
 *
 * Idempotent: already-processed mercury_txn_ids are skipped.
 */
export async function reconcileWires(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    autoPaid: 0,
    needsReview: 0,
    unmatched: 0,
    needsReviewRows: [],
  };

  const transactions = await getIncomingTransactions();
  if (transactions.length === 0) {
    return result;
  }

  // Load all open invoices (issued or viewed)
  const openInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['issued', 'viewed'] } },
    select: { id: true, total: true, invoiceNumber: true, sponsorId: true },
  });

  // Load already-processed txn ids to skip
  const existingTxnIds = new Set(
    (
      await prisma.mercuryWireMatch.findMany({
        select: { mercuryTxnId: true },
      })
    ).map((r) => r.mercuryTxnId)
  );

  for (const txn of transactions) {
    if (existingTxnIds.has(txn.txnId)) {
      continue; // idempotent skip
    }

    const memoNorm = (txn.memo ?? '').toLowerCase().trim();

    // Find invoices that match by amount
    const amountMatches = openInvoices.filter((inv) => inv.total === txn.amountCents);

    // Check if any amount match also has the invoice number in the memo
    const exactMatches = amountMatches.filter((inv) =>
      memoNorm.includes(inv.invoiceNumber.toLowerCase())
    );

    let matchStatus: 'auto_paid' | 'needs_review' | 'unmatched';
    let matchedInvoiceId: string | null = null;

    if (exactMatches.length === 1) {
      // Perfect match — auto-pay
      matchStatus = 'auto_paid';
      const exactInvoiceId = exactMatches[0].id;
      matchedInvoiceId = exactInvoiceId;

      try {
        await markInvoicePaidInternal(exactInvoiceId, {
          paymentMethod: 'wire',
          paymentRef: `Mercury wire ${txn.txnId} / ${txn.counterparty ?? 'unknown'}`,
          paidAmount: txn.amountCents,
        });

        // Remove from openInvoices so we don't double-match with another txn
        const idx = openInvoices.findIndex((i) => i.id === exactInvoiceId);
        if (idx !== -1) openInvoices.splice(idx, 1);

        result.autoPaid++;
      } catch (err) {
        console.error(`[mercury] Failed to mark invoice ${matchedInvoiceId} paid:`, err);
        // Fall back to needs_review so admin can handle it
        matchStatus = 'needs_review';
        result.needsReview++;
      }
    } else if (amountMatches.length === 1) {
      // Amount matches exactly one invoice, but no invoice number in memo
      matchStatus = 'needs_review';
      matchedInvoiceId = amountMatches[0].id;
      result.needsReview++;
    } else {
      // Ambiguous (0 or >1 amount matches)
      matchStatus = 'unmatched';
      matchedInvoiceId = null;
      result.unmatched++;
    }

    // Upsert the match row (idempotent by mercury_txn_id unique constraint)
    const matchRow = await prisma.mercuryWireMatch.upsert({
      where: { mercuryTxnId: txn.txnId },
      create: {
        mercuryTxnId: txn.txnId,
        invoiceId: matchedInvoiceId,
        amount: txn.amountCents,
        currency: txn.currency,
        memo: txn.memo,
        counterparty: txn.counterparty,
        postedAt: txn.postedAt ? new Date(txn.postedAt) : null,
        status: matchStatus,
      },
      update: {
        invoiceId: matchedInvoiceId,
        status: matchStatus,
        updatedAt: new Date(),
      },
    });

    if (matchStatus === 'needs_review' || matchStatus === 'unmatched') {
      result.needsReviewRows.push(matchRow);
    }
  }

  return result;
}
