import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { DnsRecord } from '../../lib/brandAdminApi';

export type ChipTone = 'ok' | 'warn' | 'error' | 'neutral';
const TONE: Record<ChipTone, string> = {
  ok: 'text-[#1f9d55] border-[#1f9d55]/40 bg-[#1f9d55]/10',
  warn: 'text-[#b7791f] border-[#b7791f]/40 bg-[#b7791f]/10',
  error: 'text-[#E52828] border-[#E52828]/40 bg-[#E52828]/10',
  neutral: 'text-theme-text-muted border-theme-stroke bg-transparent',
};

export const StatusChip: React.FC<{ tone: ChipTone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[tone]}`}>{children}</span>
);

/** Per-record status (Resend): verified is green, failures red, anything still waiting amber. */
export function recordTone(status: string | undefined): ChipTone {
  if (status === 'verified') return 'ok';
  if (status === 'failed') return 'error';
  if (!status) return 'neutral';
  return 'warn';
}
export function recordLabel(status: string | undefined): string {
  if (!status) return '';
  if (status === 'verified') return 'Found';
  if (status === 'failed') return 'Not found';
  if (status === 'not_started') return 'Not checked yet';
  if (status === 'temporary_failure') return 'Checking again';
  return 'Waiting';
}

const CopyButton: React.FC<{ text: string; what: string }> = ({ text, what }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard blocked: the value is still selectable on screen */
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={`Copy ${what}`} title={`Copy ${what}`}
      className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-theme-stroke text-theme-text-muted hover:text-theme-text">
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
};

const PURPOSE_LABEL: Record<DnsRecord['purpose'], string> = {
  ownership: 'Ownership',
  site: 'Site',
  vercel_verification: 'Hosting check',
  email: 'Email',
};

/**
 * Copyable DNS records: a table on wide screens, stacked cards on phones. Each record shows its
 * type, full name and value with a copy button for each; email records also show their check status.
 */
export const DnsRecordsTable: React.FC<{ records: DnsRecord[]; caption: string }> = ({ records, caption }) => {
  if (records.length === 0) return null;
  return (
    <div data-testid="dns-records" aria-label={caption}>
      <ul className="space-y-2 min-w-0">
        {records.map((r, i) => (
          <li key={`${r.type}-${r.name}-${i}`} className="rounded-xl border border-theme-stroke p-3 space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-theme-text rounded bg-theme-surface-hover px-1.5 py-0.5">{r.type}</span>
              <span className="text-xs text-theme-text-muted">{PURPOSE_LABEL[r.purpose]}{r.note && r.purpose === 'email' ? ` · ${r.note}` : ''}</span>
              {r.status ? <StatusChip tone={recordTone(r.status)}>{recordLabel(r.status)}</StatusChip> : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr] min-w-0">
              <span className="text-xs text-theme-text-muted sm:pt-2">Name / host</span>
              <div className="flex items-center gap-2 min-w-0">
                <code className="flex-1 min-w-0 break-all text-xs text-theme-text select-all">{r.name}</code>
                <CopyButton text={r.name} what="name" />
              </div>
              <span className="text-xs text-theme-text-muted sm:pt-2">Value{typeof r.priority === 'number' ? ` (priority ${r.priority})` : ''}</span>
              <div className="flex items-center gap-2 min-w-0">
                <code className="flex-1 min-w-0 break-all text-xs text-theme-text select-all">{r.value}</code>
                <CopyButton text={r.value} what="value" />
              </div>
            </div>
            {r.note && r.purpose !== 'email' ? <p className="text-xs text-theme-text-muted">{r.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
