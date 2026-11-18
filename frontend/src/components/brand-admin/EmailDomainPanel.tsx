import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Globe, Loader2 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { DnsRecordsTable, StatusChip, type ChipTone } from './DnsRecordsTable';
import {
  fetchBrandEmailDomain, saveBrandEmailDomain, checkBrandEmailDomain, removeBrandEmailDomain, describeApiError,
  type EmailDomainState,
} from '../../lib/brandAdminApi';

export function emailChip(s: Pick<EmailDomainState, 'emailDomain' | 'verified' | 'status'>): { tone: ChipTone; text: string } {
  if (!s.emailDomain) return { tone: 'neutral', text: 'Using the default sender' };
  if (s.verified) return { tone: 'ok', text: 'Verified, sending from your address' };
  if (s.status === 'failed') return { tone: 'error', text: 'DNS records not found' };
  return { tone: 'warn', text: 'Waiting for your DNS records' };
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

export const EmailDomainPanel: React.FC<{ seriesId: string }> = ({ seriesId }) => {
  const [state, setState] = useState<EmailDomainState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const adopt = useCallback((s: EmailDomainState) => {
    setState(s);
    setDomain(s.emailDomain ?? '');
    setFrom(s.emailFromAddress ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      adopt(await fetchBrandEmailDomain(seriesId));
    } catch (e) {
      setLoadError(describeApiError(e));
    }
  }, [seriesId, adopt]);
  useEffect(() => { setState(null); void load(); }, [load]);

  const run = async (name: string, fn: () => Promise<EmailDomainState>, okText: (s: EmailDomainState) => string) => {
    setBusy(name);
    setMessage(null);
    try {
      const s = await fn();
      adopt(s);
      setMessage({ kind: 'ok', text: okText(s) });
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
  if (!state) return <div className="flex items-center gap-2 text-sm text-theme-text-muted"><Loader2 size={16} className="animate-spin" />Loading email settings…</div>;

  const chip = emailChip(state);
  const unchanged = domain.trim().toLowerCase() === (state.emailDomain ?? '') && from.trim().toLowerCase() === (state.emailFromAddress ?? '');
  const ready = domain.trim() !== '' && from.trim() !== '';

  return (
    <div className="space-y-6" data-testid="email-domain-panel">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-theme-text">Send email from your own address</h2>
          <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
        </div>
        <p className="text-sm text-theme-text-muted">
          Pick a sending subdomain you control, like mail.yourdomain.com, and an address on it. Add the DNS records we show, then press "Check now".
          Until it is verified, your emails keep going out from the default address, so nothing breaks while you set this up.
        </p>
        {!state.configured.resend && <p className="text-xs text-[#b7791f]">Sending domains are not available yet. Please contact PizzaDAO.</p>}
      </section>

      <section className="space-y-3">
        <IconInput icon={Globe} type="text" aria-label="Sending subdomain" placeholder="Sending subdomain, e.g. mail.yourdomain.com" value={domain}
          onChange={(e) => { setDomain(e.target.value); setMessage(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <IconInput icon={Mail} type="email" aria-label="From address" placeholder="From address, e.g. events@mail.yourdomain.com" value={from}
          onChange={(e) => { setFrom(e.target.value); setMessage(null); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <p className="text-xs text-theme-text-muted">Use a subdomain (not your main domain) so your normal email is untouched. Changing either field starts verification again.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={!ready || unchanged || busy !== null}
            onClick={() => run('save', () => saveBrandEmailDomain(seriesId, domain.trim(), from.trim()), () => 'Saved. Add the DNS records below.')}>
            {busy === 'save' ? 'Saving…' : state.emailDomain ? 'Save changes' : 'Save and get DNS records'}
          </button>
          {state.emailDomain && (
            <button type="button" className="text-sm text-theme-text-muted underline disabled:opacity-50" disabled={busy !== null}
              onClick={() => run('remove', () => removeBrandEmailDomain(seriesId), () => 'Removed. Emails use the default sender.')}>
              Remove
            </button>
          )}
        </div>
      </section>

      {state.emailDomain && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-theme-text">DNS records to add</h3>
          {state.error && <p className="text-sm text-[#b7791f]" role="status">{state.error}</p>}
          <DnsRecordsTable caption="DNS records for sending email" records={state.records} />
          <p className="text-xs text-theme-text-muted">Records are added where you manage DNS for {state.emailDomain}. The host names above are the full names; some providers want only the part before your domain.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary text-sm disabled:opacity-50" disabled={busy !== null || !state.configured.resend}
              onClick={() => run('check', () => checkBrandEmailDomain(seriesId), (s) => (s.verified ? 'Verified. Your emails now come from your address.' : 'Checked. The records are not all visible yet, try again in a few minutes.'))}>
              {busy === 'check' ? 'Checking…' : 'Check now'}
            </button>
            {state.verifiedAt && <span className="text-xs text-theme-text-muted">Verified {fmt(state.verifiedAt)}</span>}
          </div>
        </section>
      )}

      {message && <p className={`text-sm ${message.kind === 'error' ? 'text-[#E52828]' : 'text-theme-text-muted'}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    </div>
  );
};
