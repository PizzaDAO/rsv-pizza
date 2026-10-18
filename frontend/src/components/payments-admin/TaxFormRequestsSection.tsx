import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Download, FileText, Loader2, Plus, Upload, User } from 'lucide-react';
import {
  AdminTaxFormRequest,
  TaxFormRequestInput,
  createAdminTaxFormRequests,
  listAdminTaxFormRequests,
  regenerateAdminTaxFormRequestToken,
  revokeAdminTaxFormRequest,
} from '../../lib/api';
import { IconInput } from '../IconInput';
import { TaxFormReviewPanel } from './TaxFormReviewPanel';

const FORM_LABEL: Record<string, string> = { w9: 'W-9', w8ben: 'W-8BEN', w8bene: 'W-8BEN-E' };
const REQUESTER_LABEL: Record<string, string> = { rare_pizzas: 'Rare Pizzas', pizzadao: 'PizzaDAO' };

const linkFor = (token: string) => `${window.location.origin}/tax-form?payee=${token}`;
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '-');

/** Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function download(name: string, rows: string[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-gray-500/15 text-theme-text-muted',
  opened: 'bg-blue-500/15 text-blue-300',
  draft: 'bg-amber-500/15 text-amber-300',
  submitted: 'bg-emerald-500/15 text-emerald-300',
  verified: 'bg-emerald-600/25 text-emerald-200',
  rejected: 'bg-red-500/15 text-red-300',
};

/**
 * calzone-70821: admin "Tax form requests" section (collapsed by default).
 * Metadata only: form contents are visible solely through TaxFormReviewPanel.
 */
export const TaxFormRequestsSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AdminTaxFormRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listAdminTaxFormRequests({ requester: 'rare_pizzas' }));
    } catch (e: any) {
      setError(e?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rows.length === 0) void refresh();
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setMessage('Link copied.');
    } catch {
      setMessage(linkFor(token));
    }
  };

  const createMany = async (items: TaxFormRequestInput[]) => {
    setBusy(true);
    setError(null);
    try {
      const created = await createAdminTaxFormRequests(items);
      setMessage(`Created ${created.length} request${created.length === 1 ? '' : 's'}. Downloaded a links CSV.`);
      download('tax-form-links.csv', [['label', 'link'], ...created.map((r) => [r.payeeLabel, linkFor(r.token)])]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Failed to create requests');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateOne = async () => {
    if (!label.trim()) return;
    await createMany([{ label: label.trim(), email: email.trim() || undefined }]);
    setLabel('');
    setEmail('');
  };

  const handleCsv = async (file: File) => {
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setError('CSV needs a header row and at least one data row.');
      return;
    }
    const header = parsed[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
    const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const iLabel = idx('label', 'name', 'payee', 'payee_label');
    if (iLabel < 0) {
      setError('CSV needs a "label" (or "name") column.');
      return;
    }
    const iEmail = idx('email', 'payee_email');
    const iWallet = idx('wallet', 'payee_wallet');
    const iHandle = idx('handle', 'payee_handle', 'discord', 'telegram');
    const iType = idx('suggested_form_type', 'form_type', 'suggested_type');
    const iNote = idx('tax_year_note', 'note');
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] || '').trim() || undefined : undefined);
    const items = parsed
      .slice(1)
      .map((r) => ({
        label: get(r, iLabel) || '',
        email: get(r, iEmail),
        wallet: get(r, iWallet),
        handle: get(r, iHandle),
        suggestedFormType: get(r, iType),
        taxYearNote: get(r, iNote),
      }))
      .filter((x) => x.label);
    if (items.length === 0) {
      setError('No rows with a label found.');
      return;
    }
    await createMany(items);
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await fn();
      setMessage(ok);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Action failed');
    }
  };

  const exportStatus = () =>
    download('tax-form-request-status.csv', [
      ['label', 'requester', 'status', 'form_type', 'opened', 'submitted', 'created', 'revoked'],
      ...rows.map((r) => [
        r.payeeLabel,
        REQUESTER_LABEL[r.requester] ?? r.requester,
        r.status,
        r.formType ? FORM_LABEL[r.formType] : '',
        r.openedAt ?? '',
        r.submittedAt ?? '',
        r.createdAt,
        r.revokedAt ?? '',
      ]),
    ]);

  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  const reviewing = rows.find((r) => r.id === reviewId) || null;

  return (
    <div className="card mb-6">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-2 p-4 text-left text-theme-text"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <FileText size={16} className="text-theme-text-muted" />
        <span className="font-semibold">Tax form requests</span>
        {rows.length > 0 && (
          <span className="text-xs text-theme-text-muted">
            {rows.length} total, {counts.submitted || 0} submitted, {counts.verified || 0} verified
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex-1">
              <IconInput icon={User} placeholder="Payee name" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="flex-1">
              <IconInput placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="button" className="btn-primary inline-flex items-center gap-2 justify-center" onClick={handleCreateOne} disabled={busy || !label.trim()}>
              <Plus size={14} /> Create link
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleCsv(f);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={14} /> Import CSV
            </button>
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={exportStatus} disabled={rows.length === 0}>
              <Download size={14} /> Export status CSV
            </button>
            <span className="text-xs text-theme-text-muted">
              CSV columns: label, email, wallet, handle, suggested_form_type, tax_year_note
            </span>
            {busy && <Loader2 size={14} className="animate-spin" />}
          </div>
          {error && <div className="text-xs text-red-300">{error}</div>}
          {message && <div className="text-xs text-emerald-300 break-all">{message}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-theme-text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-theme-text-muted">
                    <th className="py-2 pr-3">Payee</th>
                    <th className="py-2 pr-3">Requester</th>
                    <th className="py-2 pr-3">Contact</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2 pr-3">Submitted</th>
                    <th className="py-2 pr-3">Form</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-theme-stroke ${r.taxFormId ? 'cursor-pointer hover:bg-theme-surface-hover' : ''}`}
                      onClick={() => r.taxFormId && setReviewId(r.id === reviewId ? null : r.id)}
                    >
                      <td className="py-2 pr-3 text-theme-text">
                        {r.payeeLabel}
                        {r.revokedAt && <span className="ml-2 text-xs text-red-300">revoked</span>}
                      </td>
                      <td className="py-2 pr-3 text-theme-text-muted">{REQUESTER_LABEL[r.requester] ?? r.requester}</td>
                      <td className="py-2 pr-3 text-theme-text-muted">{r.payeeEmail || r.payeeHandle || r.payeeWallet || '-'}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[r.status] || ''}`}>{r.status}</span>
                      </td>
                      <td className="py-2 pr-3 text-theme-text-muted">{fmt(r.openedAt)}</td>
                      <td className="py-2 pr-3 text-theme-text-muted">{fmt(r.submittedAt)}</td>
                      <td className="py-2 pr-3 text-theme-text-muted">{r.formType ? FORM_LABEL[r.formType] : '-'}</td>
                      <td className="py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="p-1 text-theme-text-muted hover:text-theme-text" title="Copy link" onClick={() => void copy(r.token)}>
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          className="text-xs text-theme-text-muted underline ml-2"
                          onClick={() => {
                            if (window.confirm('Generate a new link? The old one stops working.')) {
                              void act(() => regenerateAdminTaxFormRequestToken(r.id), 'New link generated. Use the copy button.');
                            }
                          }}
                        >
                          New link
                        </button>
                        {!r.revokedAt && (
                          <button
                            type="button"
                            className="text-xs text-red-300 underline ml-2"
                            onClick={() => {
                              if (window.confirm('Revoke this link?')) void act(() => revokeAdminTaxFormRequest(r.id), 'Link revoked.');
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-theme-text-muted">No requests yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {reviewing && (
            <div className="border-t border-theme-stroke pt-3">
              <div className="text-xs text-theme-text-muted mb-2">Reviewing: {reviewing.payeeLabel}</div>
              {/* Verify/reject here mirrors onto the request on the backend. */}
              <TaxFormReviewPanel key={reviewing.taxFormId} taxFormId={reviewing.taxFormId} />
              <button type="button" className="text-xs text-theme-text-muted underline mt-2" onClick={() => void refresh()}>
                Refresh statuses
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
