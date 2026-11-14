import { useState } from 'react';
import { Plus, Pencil, Trash2, ListChecks, AlignLeft, Scale, Gauge, Mail, User, Gavel, Link2, Check, PlayCircle, StopCircle, BarChart3 } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  judgeLink,
  type HostHackathon,
  type HackathonCriterion,
  type CriterionInput,
  type JudgeInput,
} from '../../lib/hackathonApi';
import { Hint, SectionCard, toInt } from './shared';

interface Props {
  hackathon: HostHackathon;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  /** Party invite code for the copyable /judge/:inviteCode link. */
  inviteCode?: string;
  onViewLeaderboard?: () => void;
  api: {
    setJudging: (status: 'open' | 'closed') => Promise<unknown>;
    addCriterion: (b: CriterionInput) => Promise<unknown>;
    updateCriterion: (id: string, b: CriterionInput) => Promise<unknown>;
    deleteCriterion: (id: string) => Promise<unknown>;
    addJudge: (b: JudgeInput) => Promise<unknown>;
    updateJudge: (id: string, b: JudgeInput) => Promise<unknown>;
    deleteJudge: (id: string) => Promise<unknown>;
  };
}

const emptyCrit = { name: '', description: '', weight: '1', maxScore: '5' };

const JUDGING_COPY = {
  not_started: { label: 'Not open yet', text: 'Judges can look at their projects but not score yet. Open judging when demos start.' },
  open: { label: 'Open', text: 'Judges can score and edit their scores until you close judging.' },
  closed: { label: 'Closed', text: 'Scores are final. Reopen if a judge needs to fix something.' },
} as const;

export function JudgingSection({ hackathon, busy, run, inviteCode, onViewLeaderboard, api }: Props) {
  const [copied, setCopied] = useState(false);
  const [crit, setCrit] = useState(emptyCrit);
  const [editingCrit, setEditingCrit] = useState<string | null>(null);
  const [judge, setJudge] = useState({ email: '', name: '' });
  const [judgeTracks, setJudgeTracks] = useState<string[]>([]);

  const totalWeight = hackathon.criteria.reduce((s, c) => s + c.weight, 0);
  const trackName = (id: string) => hackathon.tracks.find((t) => t.id === id)?.name ?? 'Unknown track';

  const submitCrit = async () => {
    const body: CriterionInput = {
      name: crit.name.trim(),
      description: crit.description.trim() || null,
      weight: toInt(crit.weight, 1, 1, 10),
      maxScore: toInt(crit.maxScore, 5, 1, 10),
    };
    const ok = await run(() => (editingCrit ? api.updateCriterion(editingCrit, body) : api.addCriterion(body)));
    if (ok) { setCrit(emptyCrit); setEditingCrit(null); }
  };

  const editCrit = (c: HackathonCriterion) => {
    setEditingCrit(c.id);
    setCrit({ name: c.name, description: c.description ?? '', weight: String(c.weight), maxScore: String(c.maxScore) });
  };

  const addJudge = async () => {
    const ok = await run(() => api.addJudge({ email: judge.email.trim(), name: judge.name.trim() || null, trackIds: judgeTracks }));
    if (ok) { setJudge({ email: '', name: '' }); setJudgeTracks([]); }
  };

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const activeJudges = hackathon.judges.filter((j) => j.status === 'active');
  const status = hackathon.judgingStatus;
  const link = inviteCode ? judgeLink(inviteCode) : null;

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the judge link', link);
    }
  };

  const toggleJudging = () => {
    if (status === 'open') {
      if (confirm('Close judging? Judges will no longer be able to change their scores. You can reopen it later.')) void run(() => api.setJudging('closed'));
    } else {
      void run(() => api.setJudging('open'));
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Judging"
        subtitle={JUDGING_COPY[status].text}
        action={<span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${status === 'open' ? 'border-theme-success text-theme-success' : 'border-theme-stroke text-theme-text-muted'}`} data-testid="hackathon-judging-status">{JUDGING_COPY[status].label}</span>}
      >
        {link && (
          <div className="rounded-xl border border-theme-stroke bg-theme-surface p-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-theme-text-muted">Judge link: share it with your judges. They log in with the email you added below.</p>
              <p className="text-sm text-theme-text break-all mt-0.5" data-testid="hackathon-judge-link">{link}</p>
            </div>
            <button type="button" className="btn-secondary text-sm inline-flex items-center justify-center gap-2 shrink-0 min-h-[44px]" onClick={() => void copyLink()} data-testid="hackathon-copy-judge-link">
              {copied ? <Check size={14} /> : <Link2 size={14} />} {copied ? 'Copied' : 'Copy judge link'}
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button type="button" disabled={busy || (status !== 'open' && hackathon.criteria.length === 0)} onClick={toggleJudging}
            className={`${status === 'open' ? 'btn-secondary' : 'btn-primary'} inline-flex items-center justify-center gap-2 min-h-[44px]`} data-testid="hackathon-toggle-judging">
            {status === 'open' ? <StopCircle size={16} /> : <PlayCircle size={16} />}
            {status === 'open' ? 'Close judging' : status === 'closed' ? 'Reopen judging' : 'Open judging'}
          </button>
          {onViewLeaderboard && (
            <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 min-h-[44px]" onClick={onViewLeaderboard}>
              <BarChart3 size={16} /> Leaderboard
            </button>
          )}
        </div>
        {status !== 'open' && hackathon.criteria.length === 0 && <Hint>Add at least one rubric criterion before opening judging.</Hint>}
        {hackathon.blindJudging && (
          <Hint>Blind judging is on: judges don't see team or member names, and links unlock after they score. It's best-effort: a project's name, screenshots or links can still give a team away.</Hint>
        )}
      </SectionCard>

      <SectionCard
        title="Rubric"
        subtitle="Judges score each criterion. A project's score is the weighted average, out of 100."
      >
        {hackathon.judgingStatus !== 'not_started' && (
          <p className="text-xs text-theme-text-muted mb-3">Once judges have scored, criteria can't be added or removed and max scores are fixed. Weights can still change: every score is re-totaled.</p>
        )}
        {hackathon.criteria.length === 0 ? (
          <p className="text-sm text-theme-text-muted mb-4">No criteria yet. Add at least one, e.g. Impact, Technical depth, Design, Demo.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {hackathon.criteria.map((c) => (
              <li key={c.id} className="flex items-start gap-3 p-3 rounded-xl border border-theme-stroke bg-theme-surface">
                <ListChecks size={18} className="text-theme-text-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-theme-text break-words">{c.name}</p>
                  {c.description && <p className="text-xs text-theme-text-secondary mt-0.5 break-words">{c.description}</p>}
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    Score 1-{c.maxScore} · weight {c.weight}
                    {totalWeight > 0 && ` (${Math.round((100 * c.weight) / totalWeight)}%)`}
                  </p>
                </div>
                <button type="button" aria-label={`Edit ${c.name}`} onClick={() => editCrit(c)} className="p-2 text-theme-text-muted hover:text-theme-text"><Pencil size={16} /></button>
                <button type="button" aria-label={`Delete ${c.name}`} disabled={busy}
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) void run(() => api.deleteCriterion(c.id)); }}
                  className="p-2 text-theme-text-muted hover:text-theme-error"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t border-theme-stroke pt-4">
          <IconInput type="text" icon={ListChecks} aria-label="Criterion name" placeholder="Criterion, e.g. Impact" maxLength={80}
            value={crit.name} onChange={(e) => setCrit({ ...crit, name: e.target.value })} />
          <IconInput type="text" icon={AlignLeft} aria-label="Criterion description" placeholder="What judges should look for (optional)" maxLength={1000}
            value={crit.description} onChange={(e) => setCrit({ ...crit, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <IconInput icon={Scale} type="number" min={1} max={10} aria-label="Weight" placeholder="Weight"
                value={crit.weight} onChange={(e) => setCrit({ ...crit, weight: e.target.value })} />
              <Hint>Weight 1-10</Hint>
            </div>
            <div>
              <IconInput icon={Gauge} type="number" min={1} max={10} aria-label="Max score" placeholder="Max score"
                value={crit.maxScore} onChange={(e) => setCrit({ ...crit, maxScore: e.target.value })} />
              <Hint>Highest score, 1-10</Hint>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            {editingCrit && <button type="button" className="btn-secondary" onClick={() => { setEditingCrit(null); setCrit(emptyCrit); }}>Cancel</button>}
            <button type="button" className="btn-primary flex items-center gap-2" disabled={busy || !crit.name.trim()} onClick={submitCrit}>
              {editingCrit ? 'Save criterion' : <><Plus size={16} /> Add criterion</>}
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Judges"
        subtitle="Judges sign in with this email to score projects. They don't get access to your host page."
      >
        {hackathon.judges.length === 0 ? (
          <p className="text-sm text-theme-text-muted mb-4">No judges yet.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {hackathon.judges.map((j) => (
              <li key={j.id} className={`flex items-start gap-3 p-3 rounded-xl border border-theme-stroke bg-theme-surface ${j.status === 'removed' ? 'opacity-60' : ''}`}>
                <Gavel size={18} className="text-theme-text-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-theme-text break-words">{j.name || j.email}</p>
                  {j.name && <p className="text-xs text-theme-text-secondary break-all">{j.email}</p>}
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    {j.status === 'removed' ? 'Removed' : j.trackIds.length ? j.trackIds.map(trackName).join(', ') : 'All tracks'}
                  </p>
                  {j.status === 'active' && hackathon.tracks.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {hackathon.tracks.map((t) => (
                        <Checkbox
                          key={t.id}
                          size={16}
                          labelClassName="text-xs text-theme-text-secondary"
                          checked={j.trackIds.includes(t.id)}
                          disabled={busy}
                          onChange={() => void run(() => api.updateJudge(j.id, { trackIds: toggle(j.trackIds, t.id) }))}
                          label={t.name}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {j.status === 'removed' ? (
                  <button type="button" className="text-xs underline text-theme-text-secondary p-2" disabled={busy}
                    onClick={() => void run(() => api.updateJudge(j.id, { status: 'active' }))}>Restore</button>
                ) : (
                  <button type="button" aria-label={`Remove ${j.email}`} disabled={busy}
                    onClick={() => { if (confirm(`Remove ${j.email} as a judge?`)) void run(() => api.deleteJudge(j.id)); }}
                    className="p-2 text-theme-text-muted hover:text-theme-error"><Trash2 size={16} /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 border-t border-theme-stroke pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <IconInput icon={Mail} type="email" aria-label="Judge email" placeholder="Judge email" maxLength={320}
              value={judge.email} onChange={(e) => setJudge({ ...judge, email: e.target.value })} />
            <IconInput type="text" icon={User} aria-label="Judge name" placeholder="Name (optional)" maxLength={120}
              value={judge.name} onChange={(e) => setJudge({ ...judge, name: e.target.value })} />
          </div>
          {hackathon.tracks.length > 0 && (
            <div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {hackathon.tracks.map((t) => (
                  <Checkbox key={t.id} size={16} labelClassName="text-sm text-theme-text-secondary"
                    checked={judgeTracks.includes(t.id)} onChange={() => setJudgeTracks(toggle(judgeTracks, t.id))} label={t.name} />
                ))}
              </div>
              <Hint>Pick the tracks this judge scores. None picked = all tracks.</Hint>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn-primary flex items-center gap-2" disabled={busy || !judge.email.trim()} onClick={addJudge}>
              <Plus size={16} /> Add judge
            </button>
          </div>
          <p className="text-xs text-theme-text-muted">{activeJudges.length} active judge(s).</p>
        </div>
      </SectionCard>
    </div>
  );
}
