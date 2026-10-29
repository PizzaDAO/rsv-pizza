import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clipboard, ExternalLink, Loader2, Pencil, RefreshCw, Search, XCircle } from 'lucide-react';
import { IconInput } from '../IconInput';
import { fetchGppVerification, GppCheckStatus, GppVerificationResponse, GppVerificationRow } from '../../lib/api';
import { brandUrl } from '../../config/brand';
import { normalizeText } from '../../lib/normalizeText';

/**
 * bellpepper-36121: pre-launch verification of approved GPP27 city RSVP pages.
 * One row per city, colored by its worst check; expand to see each check's reason.
 */

const STATUS_STYLE: Record<GppCheckStatus, { row: string; text: string; label: string }> = {
  fail: { row: 'border-red-500/40 bg-red-500/10', text: 'text-red-500', label: 'Fail' },
  warn: { row: 'border-amber-500/40 bg-amber-500/10', text: 'text-amber-500', label: 'Warn' },
  pass: { row: 'border-green-500/30 bg-green-500/5', text: 'text-green-500', label: 'Pass' },
};

function StatusIcon({ status, size = 18 }: { status: GppCheckStatus; size?: number }) {
  const cls = STATUS_STYLE[status].text;
  if (status === 'fail') return <XCircle size={size} className={cls} />;
  if (status === 'warn') return <AlertTriangle size={size} className={cls} />;
  return <CheckCircle2 size={size} className={cls} />;
}

export function GppVerificationTab() {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<GppVerificationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GppCheckStatus | 'all'>('all');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchGppVerification());
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load verification');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regions = useMemo(
    () => Array.from(new Set((data?.rows || []).map((r) => r.region).filter(Boolean) as string[])).sort(),
    [data],
  );
  const countries = useMemo(
    () => Array.from(new Set((data?.rows || []).map((r) => r.country).filter(Boolean) as string[])).sort(),
    [data],
  );

  // Backend already sorts fails first; filtering preserves that order.
  const rows = useMemo(() => {
    const q = normalizeText(search.trim());
    return (data?.rows || []).filter((r) =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      (!region || r.region === region) &&
      (!country || r.country === country) &&
      (!q || normalizeText(`${r.name} ${r.city || ''} ${r.slug}`).includes(q)),
    );
  }, [data, statusFilter, region, country, search]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const copyFailing = async () => {
    const failing = rows.filter((r) => r.status === 'fail');
    const text = failing
      .map((r) => {
        const why = r.checks.filter((c) => c.status === 'fail').map((c) => c.label).join(', ');
        return `${r.city || r.name}${r.country ? `, ${r.country}` : ''} - ${brandUrl(r.slug)} - ${why}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy failing cities', text);
    }
  };

  if (loading && !data) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-theme-text-muted" /></div>;
  }
  if (error && !data) {
    return <div className="text-red-500 py-6 text-sm">{error}</div>;
  }
  if (!data) return null;

  const chips: Array<{ key: GppCheckStatus | 'all'; label: string; count: number }> = [
    { key: 'all', label: t('verification.all', 'All'), count: data.summary.total },
    { key: 'fail', label: t('verification.fail', 'Fail'), count: data.summary.fail },
    { key: 'warn', label: t('verification.warn', 'Warn'), count: data.summary.warn },
    { key: 'pass', label: t('verification.pass', 'Pass'), count: data.summary.pass },
  ];

  const selectCls = 'bg-theme-surface border border-theme-stroke rounded-xl px-3 py-2 text-sm text-theme-text min-w-0';

  return (
    <div className="space-y-4">
      <p className="text-sm text-theme-text-muted">
        {t('verification.intro', 'Checks every approved GPP {{year}} city page so problems can be fixed before launch.', { year: data.year })}
      </p>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              statusFilter === c.key
                ? 'bg-theme-surface-hover border-theme-text text-theme-text'
                : 'border-theme-stroke text-theme-text-muted hover:text-theme-text'
            }`}
          >
            {c.key !== 'all' && <span className={`inline-block mr-1.5 align-middle`}><StatusIcon status={c.key} size={14} /></span>}
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="sm:col-span-2">
          <IconInput
            icon={Search}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('verification.search', 'Search city or URL')}
          />
        </div>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className={selectCls}>
          <option value="">{t('verification.allRegions', 'All regions')}</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectCls}>
          <option value="">{t('verification.allCountries', 'All countries')}</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={copyFailing}
          disabled={!rows.some((r) => r.status === 'fail')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-theme-stroke text-theme-text-secondary hover:text-theme-text disabled:opacity-40"
        >
          <Clipboard size={14} />
          {copied ? t('verification.copied', 'Copied') : t('verification.copyFailing', 'Copy failing cities')}
        </button>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-theme-stroke text-theme-text-secondary hover:text-theme-text"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('verification.refresh', 'Refresh')}
        </button>
        <span className="text-xs text-theme-text-muted">
          {rows.length} / {data.summary.total}
        </span>
      </div>

      {rows.length === 0 && (
        <div className="text-center text-theme-text-muted py-10 text-sm">
          {t('verification.empty', 'No cities match.')}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((r: GppVerificationRow) => {
          const open = expanded.has(r.id);
          const issues = r.checks.filter((c) => c.status !== 'pass');
          return (
            <div key={r.id} className={`rounded-xl border ${STATUS_STYLE[r.status].row}`}>
              <div className="flex items-start gap-2 p-3">
                <button
                  onClick={() => toggle(r.id)}
                  className="flex-1 min-w-0 flex items-start gap-2 text-left"
                  aria-expanded={open}
                >
                  <span className="mt-0.5 shrink-0"><StatusIcon status={r.status} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-theme-text truncate">
                      {r.city || r.name}
                      {r.country && <span className="text-theme-text-muted font-normal">, {r.country}</span>}
                    </span>
                    <span className="block text-xs text-theme-text-muted truncate">
                      /{r.slug}{r.region ? ` · ${r.region}` : ''}
                    </span>
                    {!open && issues.length > 0 && (
                      <span className="block text-xs text-theme-text-secondary mt-1">
                        {issues.map((c) => c.label).join(' · ')}
                      </span>
                    )}
                  </span>
                  {open ? <ChevronDown size={16} className="mt-1 shrink-0 text-theme-text-muted" /> : <ChevronRight size={16} className="mt-1 shrink-0 text-theme-text-muted" />}
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={brandUrl(r.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('verification.publicPage', 'Public page')}
                    className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
                  >
                    <ExternalLink size={16} />
                  </a>
                  <a
                    href={`/host/${r.inviteCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('verification.hostEdit', 'Host edit page')}
                    className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text hover:bg-theme-surface"
                  >
                    <Pencil size={16} />
                  </a>
                </div>
              </div>
              {open && (
                <ul className="border-t border-theme-stroke px-3 py-2 space-y-1.5">
                  {r.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0"><StatusIcon status={c.status} size={14} /></span>
                      <span className="min-w-0">
                        <span className="font-medium text-theme-text">{c.label}</span>
                        <span className="text-theme-text-muted"> — {c.reason}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
