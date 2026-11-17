import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  fetchSeriesAdmins,
  inviteSeriesAdmin,
  resendSeriesAdminInvite,
  revokeSeriesAdmin,
  setSeriesAdminAlerts,
  type SeriesAdminMember,
} from '../../lib/api';

/**
 * Super-admin: who may manage a brand's settings. Invite by email (the link is sent from the
 * brand's own site), resend a pending invite, revoke, and toggle new-event alerts per person.
 */
export function BrandAdminsSection({ seriesId }: { seriesId: string }) {
  const [admins, setAdmins] = useState<SeriesAdminMember[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetchSeriesAdmins(seriesId);
      setAdmins(res.admins);
    } catch {
      setAdmins([]);
    }
  }, [seriesId]);

  useEffect(() => {
    setMsg('');
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      await load();
    } catch (e: any) {
      setMsg(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    run(async () => {
      const res = await inviteSeriesAdmin(seriesId, email.trim());
      setEmail('');
      setMsg(res.emailSent ? 'Invite sent.' : 'Invite saved, but the email could not be sent. Use Resend.');
    });

  const resend = (id: string) =>
    run(async () => {
      const res = await resendSeriesAdminInvite(seriesId, id);
      setMsg(res.emailSent ? 'Invite resent.' : 'The email could not be sent.');
    });

  const live = admins.filter((a) => a.status !== 'revoked');
  const revoked = admins.filter((a) => a.status === 'revoked');

  return (
    <div className="mt-6 border-t border-theme-stroke pt-4">
      <div className="text-sm font-semibold text-theme-text mb-1">Brand admins</div>
      <p className="text-xs text-theme-text-muted mb-3">
        Brand admins manage this brand's host checklist and approve its events. Once a brand has an admin, PizzaDAO
        stops getting its new-event alerts (you can still approve or reject events here).
      </p>
      <div className="space-y-1 mb-3">
        {live.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-lg bg-theme-surface">
            <div className="min-w-0">
              <div className="text-sm text-theme-text truncate">{a.email}</div>
              <div className="text-xs text-theme-text-muted">
                {a.status === 'active'
                  ? `Active${a.acceptedAt ? ` since ${new Date(a.acceptedAt).toLocaleDateString()}` : ''}`
                  : `Invited${a.inviteExpiresAt ? ` (link expires ${new Date(a.inviteExpiresAt).toLocaleDateString()})` : ''}`}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <Checkbox
                checked={a.alertsEnabled}
                onChange={() => run(() => setSeriesAdminAlerts(seriesId, a.id, !a.alertsEnabled))}
                label="Event alerts"
                size={16}
                disabled={busy}
                labelClassName="text-xs text-theme-text-secondary"
              />
              {a.status === 'invited' && (
                <button type="button" disabled={busy} onClick={() => resend(a.id)}
                  className="px-3 py-1 rounded-lg bg-theme-surface-hover text-theme-text text-xs disabled:opacity-50">Resend</button>
              )}
              <button type="button" disabled={busy}
                onClick={() => { if (window.confirm(`Revoke ${a.email}?`)) void run(() => revokeSeriesAdmin(seriesId, a.id), 'Revoked.'); }}
                className="px-3 py-1 rounded-lg bg-theme-surface-hover text-theme-text text-xs disabled:opacity-50">Revoke</button>
            </div>
          </div>
        ))}
        {live.length === 0 && <p className="text-xs text-theme-text-muted">No brand admins yet.</p>}
        {revoked.length > 0 && (
          <p className="text-xs text-theme-text-muted pt-1">Revoked: {revoked.map((a) => a.email).join(', ')} (invite again to restore)</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <IconInput icon={Mail} type="email" placeholder="Invite a brand admin by email" value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && email.trim() && !busy) void invite(); }} />
        </div>
        <button type="button" onClick={invite} disabled={busy || !email.trim()}
          className="px-3 py-2 rounded-lg bg-theme-surface-hover text-theme-text text-sm disabled:opacity-50">Invite</button>
      </div>
      {msg && <p className="text-xs text-theme-text-muted mt-2">{msg}</p>}
    </div>
  );
}
