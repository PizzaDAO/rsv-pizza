import { useState } from 'react';
import { Plus, Pencil, Trash2, Tag, Building2, AlignLeft, Trophy, Coins, Hash, Medal } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  type HostHackathon,
  type HackathonTrack,
  type HackathonPrize,
  type TrackInput,
  type PrizeInput,
  type PrizeKind,
  prizeAmount,
} from '../../lib/hackathonApi';
import { ChoicePills, Hint, SectionCard, toInt } from './shared';

interface Props {
  hackathon: HostHackathon;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  api: {
    addTrack: (b: TrackInput) => Promise<unknown>;
    updateTrack: (id: string, b: TrackInput) => Promise<unknown>;
    deleteTrack: (id: string) => Promise<unknown>;
    addPrize: (b: PrizeInput) => Promise<unknown>;
    updatePrize: (id: string, b: PrizeInput) => Promise<unknown>;
    deletePrize: (id: string) => Promise<unknown>;
  };
}

const emptyTrack = { name: '', sponsorName: '', description: '' };
const emptyPrize = { name: '', amountText: '', trackId: '', rank: '', quantity: '1', kind: 'judged' as PrizeKind, description: '' };

export function TracksPrizesSection({ hackathon, busy, run, api }: Props) {
  const [track, setTrack] = useState(emptyTrack);
  const [editingTrack, setEditingTrack] = useState<string | null>(null);
  const [prize, setPrize] = useState(emptyPrize);
  const [editingPrize, setEditingPrize] = useState<string | null>(null);

  const trackName = (id: string | null) => hackathon.tracks.find((t) => t.id === id)?.name ?? 'Overall';

  const submitTrack = async () => {
    const body: TrackInput = { name: track.name.trim(), sponsorName: track.sponsorName.trim() || null, description: track.description.trim() || null };
    const ok = await run(() => (editingTrack ? api.updateTrack(editingTrack, body) : api.addTrack(body)));
    if (ok) { setTrack(emptyTrack); setEditingTrack(null); }
  };

  const editTrack = (t: HackathonTrack) => {
    setEditingTrack(t.id);
    setTrack({ name: t.name, sponsorName: t.sponsorName ?? '', description: t.description ?? '' });
  };

  const submitPrize = async () => {
    const body: PrizeInput = {
      name: prize.name.trim(),
      amountText: prize.amountText.trim() || null,
      trackId: prize.trackId || null,
      rank: prize.rank ? toInt(prize.rank, 1, 1, 1000) : null,
      quantity: toInt(prize.quantity, 1, 1, 100),
      kind: prize.kind,
      description: prize.description.trim() || null,
    };
    const ok = await run(() => (editingPrize ? api.updatePrize(editingPrize, body) : api.addPrize(body)));
    if (ok) { setPrize(emptyPrize); setEditingPrize(null); }
  };

  const editPrize = (p: HackathonPrize) => {
    setEditingPrize(p.id);
    setPrize({
      name: p.name, amountText: p.amountText ?? '', trackId: p.trackId ?? '', rank: p.rank ? String(p.rank) : '',
      quantity: String(p.quantity), kind: p.kind, description: p.description ?? '',
    });
  };

  const groups: Array<{ id: string | null; label: string; prizes: HackathonPrize[] }> = [
    { id: null, label: 'Overall', prizes: hackathon.prizes.filter((p) => !p.trackId) },
    ...hackathon.tracks.map((t) => ({ id: t.id, label: t.name, prizes: hackathon.prizes.filter((p) => p.trackId === t.id) })),
  ].filter((g) => g.prizes.length > 0);

  return (
    <div className="space-y-4">
      <SectionCard title="Tracks" subtitle="Themes or sponsor challenges projects can enter.">
        {hackathon.tracks.length === 0 ? (
          <p className="text-sm text-theme-text-muted mb-4">No tracks yet. Add at least one before you publish.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {hackathon.tracks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 p-3 rounded-xl border border-theme-stroke bg-theme-surface">
                <Tag size={18} className="text-theme-text-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-theme-text break-words">
                    {t.name}
                    {t.sponsorName && <span className="text-theme-text-muted font-normal"> · by {t.sponsorName}</span>}
                  </p>
                  {t.description && <p className="text-xs text-theme-text-secondary mt-0.5 break-words">{t.description}</p>}
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    {hackathon.prizes.filter((p) => p.trackId === t.id).length} prize(s)
                  </p>
                </div>
                <button type="button" aria-label={`Edit ${t.name}`} onClick={() => editTrack(t)} className="p-2 text-theme-text-muted hover:text-theme-text"><Pencil size={16} /></button>
                <button type="button" aria-label={`Delete ${t.name}`} disabled={busy}
                  onClick={() => { if (confirm(`Delete the "${t.name}" track?`)) void run(() => api.deleteTrack(t.id)); }}
                  className="p-2 text-theme-text-muted hover:text-theme-error"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t border-theme-stroke pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IconInput type="text" icon={Tag} aria-label="Track name" placeholder="Track name, e.g. DeFi" maxLength={80}
              value={track.name} onChange={(e) => setTrack({ ...track, name: e.target.value })} />
            <IconInput type="text" icon={Building2} aria-label="Sponsor" placeholder="Sponsor (optional)" maxLength={120}
              value={track.sponsorName} onChange={(e) => setTrack({ ...track, sponsorName: e.target.value })} />
          </div>
          <IconInput icon={AlignLeft} multiline rows={2} aria-label="Track description" placeholder="What should projects in this track do? (optional)" maxLength={2000}
            value={track.description} onChange={(e) => setTrack({ ...track, description: e.target.value })} />
          <div className="flex gap-2 justify-end">
            {editingTrack && <button type="button" className="btn-secondary" onClick={() => { setEditingTrack(null); setTrack(emptyTrack); }}>Cancel</button>}
            <button type="button" className="btn-primary flex items-center gap-2" disabled={busy || !track.name.trim()} onClick={submitTrack}>
              {editingTrack ? 'Save track' : <><Plus size={16} /> Add track</>}
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Prizes" subtitle="Overall prizes or prizes for one track.">
        {groups.length === 0 ? (
          <p className="text-sm text-theme-text-muted mb-4">No prizes yet. Add at least one before you publish.</p>
        ) : (
          <div className="space-y-4 mb-4">
            {groups.map((g) => (
              <div key={g.id ?? 'overall'}>
                <p className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">{g.label}</p>
                <ul className="space-y-2">
                  {g.prizes.map((p) => (
                    <li key={p.id} className="flex items-start gap-3 p-3 rounded-xl border border-theme-stroke bg-theme-surface">
                      <Trophy size={18} className="text-theme-text-muted mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-theme-text break-words">
                          {p.rank ? `#${p.rank} ` : ''}{p.name}
                          {p.quantity > 1 && <span className="text-theme-text-muted font-normal"> ×{p.quantity}</span>}
                        </p>
                        <p className="text-xs text-theme-text-secondary mt-0.5">
                          {[prizeAmount(p), p.kind === 'peoples_choice' ? "People's choice" : null].filter(Boolean).join(' · ') || 'No amount set'}
                        </p>
                      </div>
                      <button type="button" aria-label={`Edit ${p.name}`} onClick={() => editPrize(p)} className="p-2 text-theme-text-muted hover:text-theme-text"><Pencil size={16} /></button>
                      <button type="button" aria-label={`Delete ${p.name}`} disabled={busy}
                        onClick={() => { if (confirm(`Delete the "${p.name}" prize?`)) void run(() => api.deletePrize(p.id)); }}
                        className="p-2 text-theme-text-muted hover:text-theme-error"><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t border-theme-stroke pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IconInput type="text" icon={Trophy} aria-label="Prize name" placeholder="Prize name, e.g. 1st place" maxLength={120}
              value={prize.name} onChange={(e) => setPrize({ ...prize, name: e.target.value })} />
            <IconInput type="text" icon={Coins} aria-label="Prize amount" placeholder='Amount, e.g. "$5,000" or "2,500 USDC"' maxLength={120}
              value={prize.amountText} onChange={(e) => setPrize({ ...prize, amountText: e.target.value })} />
            <div>
              <IconInput icon={Medal} type="number" min={1} aria-label="Rank" placeholder="Rank (optional)"
                value={prize.rank} onChange={(e) => setPrize({ ...prize, rank: e.target.value })} />
              <Hint>Rank orders prizes: 1 = first place</Hint>
            </div>
            <div>
              <IconInput icon={Hash} type="number" min={1} max={100} aria-label="Quantity" placeholder="How many"
                value={prize.quantity} onChange={(e) => setPrize({ ...prize, quantity: e.target.value })} />
              <Hint>How many winners get this prize</Hint>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-theme-text-secondary">For</p>
            <ChoicePills<string>
              ariaLabel="Prize track"
              value={prize.trackId}
              onChange={(v) => setPrize({ ...prize, trackId: v })}
              options={[{ value: '', label: 'Overall' }, ...hackathon.tracks.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-theme-text-secondary">Decided by</p>
            <ChoicePills<PrizeKind>
              ariaLabel="Prize kind"
              value={prize.kind}
              onChange={(v) => setPrize({ ...prize, kind: v })}
              options={[{ value: 'judged', label: 'Judges' }, { value: 'peoples_choice', label: "People's choice vote" }]}
            />
          </div>
          <div className="flex gap-2 justify-end">
            {editingPrize && <button type="button" className="btn-secondary" onClick={() => { setEditingPrize(null); setPrize(emptyPrize); }}>Cancel</button>}
            <button type="button" className="btn-primary flex items-center gap-2" disabled={busy || !prize.name.trim()} onClick={submitPrize}>
              {editingPrize ? 'Save prize' : <><Plus size={16} /> Add prize</>}
            </button>
          </div>
          {editingPrize && <p className="text-xs text-theme-text-muted">Editing a prize for {trackName(prize.trackId || null)}.</p>}
        </div>
      </SectionCard>
    </div>
  );
}
