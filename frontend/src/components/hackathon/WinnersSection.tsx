import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Trophy, Medal, Eye, EyeOff, Download, Wallet, Hash, CalendarCheck, StickyNote, Trash2, ChevronDown, ChevronUp, Sparkles, CheckCircle2, Circle,
} from 'lucide-react';
import { IconInput } from '../IconInput';
import { ChoicePills, ErrorBanner, Hint, SectionCard } from './shared';
import {
  PAYOUT_LABEL,
  hackathonAwardsApi as api,
  hackathonModerationApi,
  hasRecordedPayout,
  isoToLocalInput,
  localInputToIso,
  ordinal,
  prizeAmount,
  type AwardCandidate,
  type AwardsResponse,
  type HackathonPrize,
  type HostAward,
  type HostHackathon,
  type PayoutInput,
  type PayoutStatus,
  type RankEntry,
} from '../../lib/hackathonApi';

const STATUS_CLASS: Record<PayoutStatus, string> = {
  unpaid: 'border-theme-stroke text-theme-text-secondary',
  pending: 'border-theme-accent text-theme-accent',
  paid: 'border-theme-success text-theme-success',
  not_applicable: 'border-theme-stroke text-theme-text-muted',
};

export function PayoutBadge({ status }: { status: PayoutStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${STATUS_CLASS[status]}`} data-testid="hackathon-payout-status">
      {PAYOUT_LABEL[status]}
    </span>
  );
}

/** PATCH body with only the fields that differ from the award as last loaded. */
export function payoutChanges(
  award: Pick<HostAward, 'payoutStatus' | 'recipientMemberId' | 'recipientWallet' | 'payoutReference' | 'paidAt' | 'payoutNotes'>,
  form: { status: PayoutStatus; memberId: string; wallet: string; reference: string; paidAt: string; notes: string },
): PayoutInput {
  const body: PayoutInput = {};
  const norm = (v: string) => v.trim() || null;
  if (form.status !== award.payoutStatus) body.status = form.status;
  if (form.memberId !== (award.recipientMemberId ?? '')) body.recipientMemberId = form.memberId || null;
  if (norm(form.wallet) !== (award.recipientWallet ?? null)) body.recipientWallet = norm(form.wallet);
  if (norm(form.reference) !== (award.payoutReference ?? null)) body.payoutReference = norm(form.reference);
  if (norm(form.notes) !== (award.payoutNotes ?? null)) body.payoutNotes = norm(form.notes);
  if (form.status === 'paid' && form.paidAt && form.paidAt !== isoToLocalInput(award.paidAt)) body.paidAt = localInputToIso(form.paidAt);
  return body;
}

const fmt = (n: number | null) => (n === null ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Ranked candidates for a prize's scope (track prize: that track's board; else overall). */
export function rankedCandidates(prize: Pick<HackathonPrize, 'trackId'>, data: Pick<AwardsResponse, 'candidates' | 'ranking'>): Array<{ c: AwardCandidate; r: RankEntry | null }> {
  const rows = prize.trackId ? data.ranking.byTrack.find((t) => t.trackId === prize.trackId)?.rows ?? [] : data.ranking.overall;
  const byId = new Map(rows.map((r) => [r.submissionId, r]));
  return data.candidates
    .filter((c) => !prize.trackId || c.trackIds.includes(prize.trackId))
    .map((c) => ({ c, r: byId.get(c.id) ?? null }))
    .sort((a, b) => (a.r?.rank ?? 1e9) - (b.r?.rank ?? 1e9) || a.c.name.localeCompare(b.c.name));
}

function AwardPicker({ prize, data, busy, onAward }: {
  prize: HackathonPrize;
  data: AwardsResponse;
  busy: boolean;
  onAward: (submissionId: string) => void;
}) {
  const taken = new Set(data.awards.filter((a) => a.prizeId === prize.id).map((a) => a.submissionId));
  const options = rankedCandidates(prize, data).filter((o) => !taken.has(o.c.id));
  const suggested = (data.suggestions[prize.id] ?? []).filter((id) => !taken.has(id));
  const [selected, setSelected] = useState<string | null>(suggested[0] ?? null);
  const [showAll, setShowAll] = useState(false);
  // After another award changes the options, keep the host's pick if it's still valid, else
  // fall back to the next suggestion.
  const optionKey = options.map((o) => o.c.id).join(',');
  const firstSuggestion = suggested[0] ?? null;
  useEffect(() => {
    const ids = optionKey.split(',');
    setSelected((cur) => (cur && ids.includes(cur) ? cur : firstSuggestion));
  }, [optionKey, firstSuggestion]);

  if (!options.length) {
    return <p className="text-sm text-theme-text-muted">{prize.trackId ? 'No other submitted project entered this track.' : 'No other submitted project to award.'}</p>;
  }
  const visible = showAll ? options : options.slice(0, 5);
  const pick = options.find((o) => o.c.id === selected);
  return (
    <div className="space-y-2" data-testid="hackathon-award-picker">
      <ul role="radiogroup" aria-label={`Pick a winner for ${prize.name}`} className="space-y-1.5">
        {visible.map(({ c, r }) => {
          const active = c.id === selected;
          return (
            <li key={c.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(c.id)}
                className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left min-h-[44px] transition-colors ${
                  active ? 'border-theme-accent bg-theme-surface' : 'border-theme-stroke hover:border-theme-stroke-hover'
                }`}
              >
                <span className={`w-9 shrink-0 text-center text-sm font-bold tabular-nums ${r?.rank === 1 ? 'text-theme-accent' : 'text-theme-text-secondary'}`}>
                  {r?.rank ? `${r.tied ? '=' : '#'}${r.rank}` : '-'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-theme-text truncate">{c.name}</span>
                  <span className="block text-xs text-theme-text-muted truncate">{c.teamName ?? ''}</span>
                </span>
                {suggested.includes(c.id) && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-theme-accent shrink-0"><Sparkles size={12} /> Suggested</span>
                )}
                <span className="text-sm font-semibold text-theme-text tabular-nums shrink-0">{fmt(r?.average ?? null)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {options.length > 5 && (
        <button type="button" className="text-xs text-theme-text-muted hover:text-theme-text py-1" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${options.length} projects`}
        </button>
      )}
      <button
        type="button"
        className="btn-primary inline-flex items-center gap-2 text-sm"
        disabled={busy || !pick}
        onClick={() => pick && onAward(pick.c.id)}
        data-testid="hackathon-award-button"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Medal size={14} />}
        {pick ? `Award to ${pick.c.name}` : 'Pick a project'}
      </button>
      {prize.kind === 'peoples_choice' && <Hint>People&apos;s Choice: pick the winner yourself for now. Voting comes later.</Hint>}
    </div>
  );
}

function PayoutEditor({ award, candidate, busy, onSave, onRemove, onClose }: {
  award: HostAward;
  candidate: AwardCandidate | undefined;
  busy: boolean;
  onSave: (body: PayoutInput) => Promise<boolean>;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<PayoutStatus>(award.payoutStatus);
  const [memberId, setMemberId] = useState<string>(award.recipientMemberId ?? '');
  const [wallet, setWallet] = useState(award.recipientWallet ?? '');
  const [reference, setReference] = useState(award.payoutReference ?? '');
  const [paidAt, setPaidAt] = useState(isoToLocalInput(award.paidAt));
  const [notes, setNotes] = useState(award.payoutNotes ?? '');
  const locked = hasRecordedPayout(award);

  const recipientLeft = !!award.recipient && !award.recipientMemberId;

  /** Only the fields this host changed, so a concurrent edit by another host isn't clobbered. */
  const save = () => {
    const body = payoutChanges(award, { status, memberId, wallet, reference, paidAt, notes });
    if (!Object.keys(body).length) return onClose();
    void onSave(body);
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-theme-stroke p-3" data-testid="hackathon-payout-editor">
      <ChoicePills<PayoutStatus>
        ariaLabel="Payout status"
        value={status}
        onChange={setStatus}
        options={(['unpaid', 'pending', 'paid', 'not_applicable'] as const).map((s) => ({ value: s, label: PAYOUT_LABEL[s] }))}
      />
      {recipientLeft && (
        <p className="text-sm text-theme-error" data-testid="hackathon-recipient-left">
          {award.recipient?.name || 'The recipient'} left the team. Pick another recipient before marking this pending or paid.
        </p>
      )}
      {candidate && candidate.members.length > 0 && (
        <div>
          <ChoicePills<string>
            ariaLabel="Recipient"
            value={memberId}
            onChange={setMemberId}
            options={candidate.members.map((m) => ({ value: m.id, label: m.role === 'captain' ? `${m.name} (captain)` : m.name }))}
          />
          <Hint>Who receives the prize{memberId && candidate.members.find((m) => m.id === memberId)?.email ? `: ${candidate.members.find((m) => m.id === memberId)!.email}` : ''}</Hint>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <IconInput icon={Wallet} type="text" value={wallet} maxLength={200} placeholder="Wallet address or payment handle" aria-label="Wallet or handle" onChange={(e) => setWallet(e.target.value)} />
        <IconInput icon={Hash} type="text" value={reference} maxLength={500} placeholder="Reference or tx hash" aria-label="Reference or tx hash" onChange={(e) => setReference(e.target.value)} />
      </div>
      {status === 'paid' && (
        <div>
          <IconInput icon={CalendarCheck} type="datetime-local" aria-label="Paid at" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          <Hint>Paid at (defaults to now)</Hint>
        </div>
      )}
      <IconInput icon={StickyNote} multiline rows={2} value={notes} maxLength={2000} placeholder="Notes (hosts only)" aria-label="Payout notes" onChange={(e) => setNotes(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary text-sm inline-flex items-center gap-2" disabled={busy} onClick={save} data-testid="hackathon-payout-save">
          {busy && <Loader2 size={14} className="animate-spin" />} Save payout
        </button>
        <button
          type="button"
          className="btn-secondary text-sm inline-flex items-center gap-2"
          disabled={busy || locked}
          title={locked ? 'A payout is recorded. Set it back to unpaid and clear the reference to remove this award.' : undefined}
          onClick={onRemove}
        >
          <Trash2 size={14} /> Remove award
        </button>
      </div>
      <Hint>Tracking only: send the prize yourself, then record it here. Wallets and notes are only visible to hosts (the recipient sees their own wallet and reference).</Hint>
    </div>
  );
}

function AwardRow({ award, prize, candidate, busy, onSave, onRemove }: {
  award: HostAward;
  prize: HackathonPrize;
  candidate: AwardCandidate | undefined;
  busy: boolean;
  onSave: (body: PayoutInput) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-3" data-testid="hackathon-award-row">
      <button type="button" className="w-full flex items-center gap-3 text-left min-h-[44px]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Trophy size={18} className="text-theme-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-theme-text truncate">
            {prize.quantity > 1 && award.place ? <span className="text-theme-text-muted font-normal">{ordinal(award.place)} · </span> : null}
            {award.projectName}
          </p>
          <p className="text-xs text-theme-text-muted truncate">
            {[award.teamName, award.recipient?.name && `to ${award.recipient.name}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <PayoutBadge status={award.payoutStatus} />
        {open ? <ChevronUp size={16} className="text-theme-text-muted shrink-0" /> : <ChevronDown size={16} className="text-theme-text-muted shrink-0" />}
      </button>
      {open && (
        <PayoutEditor
          key={`${award.id}:${award.updatedAt ?? ''}`}
          award={award}
          candidate={candidate}
          busy={busy}
          onSave={async (b) => { const ok = await onSave(b); if (ok) setOpen(false); return ok; }}
          onRemove={onRemove}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

/**
 * Host Winners & Payouts (plans/hackathon-platform.md §8, PR 5): award prizes (leaderboard
 * suggestions pre-fill, the host decides), track payouts, reveal results, export CSV.
 */
export function WinnersSection({ partyId, hackathon, onHackathonChanged, onOpenLeaderboard }: {
  partyId: string;
  hackathon: HostHackathon;
  onHackathonChanged: (h: HostHackathon) => void;
  onOpenLeaderboard: () => void;
}) {
  const [data, setData] = useState<AwardsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.list(partyId));
    } catch (e: any) {
      setError(e?.message || 'Could not load winners');
    }
  }, [partyId]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const run = useCallback(async (key: string, fn: () => Promise<AwardsResponse>): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      setData(await fn());
      return true;
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  const candidateById = useMemo(() => new Map((data?.candidates ?? []).map((c) => [c.id, c])), [data]);

  const revealed = !!hackathon.resultsRevealedAt;
  const judgingClosed = hackathon.judgingStatus === 'closed';
  const awardCount = data?.awards.length ?? 0;
  const paidCount = data?.awards.filter((a) => a.payoutStatus === 'paid').length ?? 0;
  const settled = data?.awards.filter((a) => a.payoutStatus === 'paid' || a.payoutStatus === 'not_applicable').length ?? 0;
  const slots = (data?.prizes ?? []).reduce((n, p) => n + p.quantity, 0);

  const toggleReveal = async () => {
    const msg = revealed
      ? 'Hide the results again? Winners disappear from the event page and teams stop seeing judge feedback.'
      : 'Reveal the results? Winners appear on the event page, and each team sees its judges\' feedback.';
    if (!confirm(msg)) return;
    setBusy('reveal');
    setError(null);
    try {
      const res = revealed ? await api.unreveal(partyId) : await api.reveal(partyId);
      if (res.hackathon) onHackathonChanged(res.hackathon);
      void load();
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setError(null);
    try {
      await hackathonModerationApi.exportCsv(partyId, 'awards');
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    }
  };

  const checks = [
    { label: 'Judging closed', done: judgingClosed },
    { label: `${awardCount} of ${slots} prize${slots === 1 ? '' : 's'} awarded`, done: slots > 0 && awardCount >= slots },
    { label: `${settled} of ${awardCount} payout${awardCount === 1 ? '' : 's'} settled`, done: awardCount > 0 && settled === awardCount },
  ];

  return (
    <div className="space-y-4" data-testid="hackathon-winners-section">
      <SectionCard
        title="Winners & Payouts"
        subtitle={revealed
          ? `Results revealed ${new Date(hackathon.resultsRevealedAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Winners show on the event page.`
          : 'Pick winners from the leaderboard, then reveal them on the event page.'}
        action={
          <button
            type="button"
            disabled={busy === 'reveal' || (!revealed && (!judgingClosed || awardCount === 0)) || (revealed && paidCount > 0)}
            onClick={() => void toggleReveal()}
            className={`${revealed ? 'btn-secondary' : 'btn-primary'} text-sm inline-flex items-center gap-2 shrink-0`}
            data-testid="hackathon-reveal"
          >
            {busy === 'reveal' ? <Loader2 size={14} className="animate-spin" /> : revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            {revealed ? 'Hide results' : 'Reveal results'}
          </button>
        }
      >
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center gap-2 text-sm">
              {c.done ? <CheckCircle2 size={16} className="text-theme-success shrink-0" /> : <Circle size={16} className="text-theme-text-faint shrink-0" />}
              <span className={c.done ? 'text-theme-text' : 'text-theme-text-muted'}>{c.label}</span>
            </li>
          ))}
        </ul>
        {!revealed && !judgingClosed && (
          <Hint>
            Close judging before revealing.{' '}
            <button type="button" className="underline" onClick={onOpenLeaderboard}>Open the leaderboard</button>
          </Hint>
        )}
        {revealed && paidCount > 0 && <Hint>A prize is marked paid, so the results stay public.</Hint>}
        {revealed && <Hint>Teams now see their judges&apos; feedback (text only, no judge names or scores).</Hint>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm inline-flex items-center gap-2" onClick={() => void exportCsv()} disabled={!awardCount}>
            <Download size={14} /> Export awards CSV
          </button>
        </div>
        <div className="mt-2"><ErrorBanner message={error} onClose={() => setError(null)} /></div>
      </SectionCard>

      {!data ? (
        <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
      ) : data.prizes.length === 0 ? (
        <div className="card p-6 text-center text-sm text-theme-text-muted">No prizes yet. Add them in Tracks &amp; Prizes.</div>
      ) : (
        data.prizes.map((p) => {
          const awards = data.awards.filter((a) => a.prizeId === p.id).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
          const track = p.trackId ? data.tracks.find((t) => t.id === p.trackId) : null;
          const amount = prizeAmount(p);
          return (
            <div key={p.id} className="card p-4 sm:p-6" data-testid="hackathon-prize-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-theme-text break-words">{p.name}</h3>
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    {[track ? track.name : 'Overall', p.kind === 'peoples_choice' ? "People's Choice" : null, amount].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-sm text-theme-text-secondary tabular-nums shrink-0">{awards.length}/{p.quantity}</span>
              </div>
              {awards.length > 0 && (
                <ul className="divide-y divide-theme-stroke mt-2">
                  {awards.map((a) => (
                    <AwardRow
                      key={a.id}
                      award={a}
                      prize={p}
                      candidate={candidateById.get(a.submissionId)}
                      busy={busy === a.id}
                      onSave={(b) => run(a.id, () => api.updatePayout(partyId, a.id, b))}
                      onRemove={() => {
                        if (confirm(`Remove ${p.name} from ${a.projectName}?`)) void run(a.id, () => api.remove(partyId, a.id));
                      }}
                    />
                  ))}
                </ul>
              )}
              {awards.length < p.quantity && (
                <div className={awards.length ? 'mt-3 pt-3 border-t border-theme-stroke' : 'mt-3'}>
                  <AwardPicker prize={p} data={data} busy={busy === `award:${p.id}`} onAward={(sid) => void run(`award:${p.id}`, () => api.create(partyId, p.id, sid))} />
                </div>
              )}
            </div>
          );
        })
      )}

      {data && data.awards.length > 0 && (
        <SectionCard title="Payout status" subtitle={`${paidCount} paid · ${settled} of ${data.awards.length} settled`}>
          <ul className="divide-y divide-theme-stroke" data-testid="hackathon-payout-table">
            {data.awards.map((a) => {
              const p = data.prizes.find((x) => x.id === a.prizeId);
              return (
                <li key={a.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-theme-text truncate">{p?.name}{p && p.quantity > 1 && a.place ? ` (${ordinal(a.place)})` : ''} · {a.projectName}</p>
                    <p className="text-xs text-theme-text-muted truncate">
                      {[a.recipient?.name || 'No recipient', a.recipientWallet, a.payoutReference && `ref ${a.payoutReference}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <PayoutBadge status={a.payoutStatus} />
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
