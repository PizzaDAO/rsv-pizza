import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { DnsRecordsTable, StatusChip, type ChipTone } from './DnsRecordsTable';
import {
  fetchBrandDomain, requestBrandDomain, cancelBrandDomain, checkBrandDomain, attachBrandDomain, cutoverBrandDomain,
  rollbackBrandDomain, resetBrandDomain, removeBrandAlias, describeApiError, type DomainState, type DomainStatus,
} from '../../lib/brandAdminApi';

interface Props {
  seriesId: string;
  /** Only super-admins see (and the server only accepts) attach / cutover / rollback. */
  isSuperAdmin: boolean;
}

const STEPS: Array<{ key: DomainStatus; label: string }> = [
  { key: 'requested', label: 'Requested' },
  { key: 'dns_ok', label: 'Ownership confirmed' },
  { key: 'attached', label: 'Connected' },
  { key: 'ready', label: 'Ready' },
  { key: 'live', label: 'Live' },
];
const ORDER = STEPS.map((s) => s.key);

export function domainChip(status: DomainState['status']): { tone: ChipTone; text: string } {
  switch (status) {
    case 'requested': return { tone: 'warn', text: 'Waiting for your DNS records' };
    case 'dns_ok': return { tone: 'ok', text: 'Ownership confirmed' };
    case 'attached': return { tone: 'warn', text: 'Connected, waiting for DNS' };
    case 'ready': return { tone: 'ok', text: 'Ready to switch' };
    case 'live': return { tone: 'ok', text: 'Live' };
    default: return { tone: 'neutral', text: 'No custom domain' };
  }
}

export function domainInstructions(status: DomainState['status']): string {
  switch (status) {
    case 'requested': return 'Add both records below at your DNS provider (where you bought the domain), then press "Check now". DNS changes can take a few minutes, sometimes longer.';
    case 'dns_ok': return 'We can see your ownership record. PizzaDAO will now connect the domain to your site. Keep both records in place.';
    case 'attached': return 'The domain is connected. We are waiting for your DNS to point at the site and for the security certificate. Press "Check now" to refresh.';
    case 'ready': return 'Everything checks out. PizzaDAO will switch your site over to this domain. Your old address will keep working and redirect.';
    case 'live': return 'Your site is live on this domain. Your old address redirects here, so printed QR codes and old emails keep working.';
    default: return 'Use your own web address, such as events.yourdomain.com. It must be a subdomain (not the bare domain), and you need access to its DNS settings.';
  }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export const DomainPanel: React.FC<Props> = ({ seriesId, isSuperAdmin }) => {
  const [state, setState] = useState<DomainState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [redirectOld, setRedirectOld] = useState(true);
  const [detach, setDetach] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setState(await fetchBrandDomain(seriesId));
    } catch (e) {
      setLoadError(describeApiError(e));
    }
  }, [seriesId]);
  useEffect(() => { setState(null); void load(); }, [load]);

  const run = async (name: string, fn: () => Promise<DomainState>, okText?: (s: DomainState) => string) => {
    setBusy(name);
    setMessage(null);
    try {
      const s = await fn();
      setState(s);
      if (okText) setMessage({ kind: 'ok', text: okText(s) });
    } catch (e) {
      setMessage({ kind: 'error', text: describeApiError(e) });
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[#E52828]" role="alert">{loadError}</p>
        <button type="button" className="btn-secondary text-sm" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!state) return <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading domain…</div>;

  const chip = domainChip(state.status);
  const idx = state.status ? ORDER.indexOf(state.status) : -1;
  const canCancel = state.status === 'requested' || state.status === 'dns_ok';
  const c = state.checks;

  return (
    <div className="space-y-6" data-testid="domain-panel">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-theme-text">Your own web address</h2>
          <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
        </div>
        <p className="text-sm text-theme-text-muted">{domainInstructions(state.status)}</p>
        {state.siteUrl ? <p className="text-xs text-theme-text-muted break-all">Current site address: {state.siteUrl}</p> : null}
      </section>

      {!state.domain ? (
        <section className="space-y-3">
          <IconInput icon={Globe} type="text" aria-label="Domain" placeholder="events.yourdomain.com" value={host}
            onChange={(e) => { setHost(e.target.value); setMessage(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <p className="text-xs text-theme-text-muted">A subdomain you control, like events.yourdomain.com. Bare domains (yourdomain.com) are not supported.</p>
          <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={!host.trim() || busy !== null}
            onClick={() => run('request', () => requestBrandDomain(seriesId, host.trim()), () => 'Domain requested. Add the DNS records below.')}>
            {busy === 'request' ? 'Requesting…' : 'Request this domain'}
          </button>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-theme-text break-all">{state.domain}</span>
            </div>
            <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s.key} aria-current={i === idx ? 'step' : undefined} className={i <= idx ? 'text-theme-text font-medium' : 'text-theme-text-muted'}>
                  {i < idx ? '✓ ' : i === idx ? '● ' : '○ '}{s.label}
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-theme-text">DNS records to add</h3>
            <DnsRecordsTable caption="DNS records for your domain" records={state.records} />
            <p className="text-xs text-theme-text-muted">If you use Cloudflare, set the CNAME to "DNS only" (grey cloud). If you have CAA records, allow letsencrypt.org.</p>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-secondary text-sm disabled:opacity-50" disabled={busy !== null}
                onClick={() => run('check', () => checkBrandDomain(seriesId), (s) => (s.changed ? 'Status updated.' : 'Checked. No change yet.'))}>
                {busy === 'check' ? 'Checking…' : 'Check now'}
              </button>
              {canCancel && (
                <button type="button" className="text-sm text-theme-text-muted underline disabled:opacity-50" disabled={busy !== null}
                  onClick={() => run('cancel', () => cancelBrandDomain(seriesId), () => 'Request cancelled.')}>
                  Cancel request
                </button>
              )}
              {state.checkedAt && <span className="text-xs text-theme-text-muted">Last checked {fmt(state.checkedAt)}</span>}
            </div>
            {c && (
              <ul className="flex flex-wrap gap-2" aria-label="Check results">
                <li><StatusChip tone={c.dnsError ? 'warn' : c.txtOk ? 'ok' : 'error'}>{c.dnsError ? 'DNS lookup failed, try again' : c.txtOk ? 'Ownership record found' : 'Ownership record not found'}</StatusChip></li>
                <li><StatusChip tone={c.cnameOk ? 'ok' : 'warn'}>{c.cnameOk ? 'Domain points at the site' : 'Domain not pointing at the site yet'}</StatusChip></li>
                {c.vercel && <li><StatusChip tone={c.vercel.configured ? 'ok' : 'warn'}>{c.vercel.configured ? 'Connected and secure' : c.vercel.attached ? 'Connected, finishing setup' : 'Not connected yet'}</StatusChip></li>}
              </ul>
            )}
          </section>
        </>
      )}

      {message && <p className={`text-sm ${message.kind === 'error' ? 'text-[#E52828]' : 'text-theme-text-muted'}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      {state.steps.length > 0 && (
        <section className="rounded-xl border border-theme-stroke p-3 space-y-2" data-testid="domain-steps">
          <h3 className="text-sm font-semibold text-theme-text">Manual steps for PizzaDAO</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-theme-text-muted">
            {state.steps.map((s) => <li key={s} className="break-words">{s}</li>)}
          </ul>
        </section>
      )}

      {isSuperAdmin && state.aliases.length > 0 && (
        <section className="rounded-xl border border-theme-stroke p-3 space-y-2" data-testid="domain-aliases">
          <h3 className="text-sm font-semibold text-theme-text">Site aliases (PizzaDAO admin)</h3>
          <ul className="space-y-2">
            {state.aliases.map((a) => (
              <li key={a} className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs break-all text-theme-text">{a}</span>
                <button type="button" className="btn-secondary text-xs shrink-0 disabled:opacity-50" disabled={busy !== null}
                  onClick={() => run(`alias:${a}`, () => removeBrandAlias(seriesId, a), () => 'Alias removed.')}>Remove</button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-theme-text-muted">Links and API access from a removed alias stop working.</p>
        </section>
      )}

      {isSuperAdmin && state.domain && (
        <section className="rounded-xl border border-theme-stroke p-3 space-y-3" data-testid="domain-super-admin">
          <h3 className="text-sm font-semibold text-theme-text">PizzaDAO admin</h3>
          {!state.configured.vercel && <p className="text-xs text-[#b7791f]">Domain hosting is not configured on the server (VERCEL_DOMAINS_TOKEN / VERCEL_TEAM_ID).</p>}
          {!state.projectMapped && <p className="text-xs text-[#b7791f]">This brand has no entry in BRAND_VERCEL_PROJECTS, so it cannot be attached.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm disabled:opacity-50" disabled={busy !== null || state.status !== 'dns_ok'}
              onClick={() => run('attach', () => attachBrandDomain(seriesId), () => 'Domain attached to the site project.')}>
              {busy === 'attach' ? 'Attaching…' : 'Attach to site project'}
            </button>
          </div>
          <div className="space-y-2">
            <Checkbox checked={redirectOld} onChange={() => setRedirectOld((v) => !v)} label="Redirect the old address to the new one (308)" className="text-left" checkboxRole />
            <Checkbox checked={ack} onChange={() => setAck((v) => !v)} label="Everyone on this site will need to log in again once" className="text-left" checkboxRole />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={busy !== null || state.status !== 'ready' || !ack}
                onClick={() => run('cutover', () => cutoverBrandDomain(seriesId, redirectOld), () => 'Switched over. Do the manual steps below.')}>
                {busy === 'cutover' ? 'Switching…' : 'Cut over to this domain'}
              </button>
              <button type="button" className="btn-secondary text-sm disabled:opacity-50" disabled={busy !== null || state.status !== 'live'}
                onClick={() => run('rollback', () => rollbackBrandDomain(seriesId), () => 'Rolled back to the previous address.')}>
                {busy === 'rollback' ? 'Rolling back…' : 'Roll back'}
              </button>
            </div>
            <p className="text-xs text-theme-text-muted">Cutover needs every DNS check to pass first. The old address is never detached.</p>
            <Checkbox checked={detach} onChange={() => setDetach((v) => !v)} label="Also remove the domain from the Vercel project" className="text-left" checkboxRole />
            <button type="button" className="btn-secondary text-sm disabled:opacity-50" disabled={busy !== null || state.status === 'live'}
              onClick={() => run('reset', () => resetBrandDomain(seriesId, detach), () => 'Domain claim reset. It can be requested again.')}>
              {busy === 'reset' ? 'Resetting…' : 'Reset domain claim'}
            </button>
            <p className="text-xs text-theme-text-muted">Reset is not available while live: roll back first.</p>
          </div>
        </section>
      )}
    </div>
  );
};
