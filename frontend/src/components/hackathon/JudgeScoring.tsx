import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Github, Video, Presentation, Globe, Lock, Loader2, MessageSquare, MessageSquareHeart, CheckCircle2, Hash, Users } from 'lucide-react';
import { IconInput } from '../IconInput';
import { ErrorBanner, Hint } from './shared';
import {
  weightedTotal,
  type HackathonCriterion,
  type HackathonTrack,
  type JudgeSubmission,
  type JudgingStatus,
  type ScoreInput,
} from '../../lib/hackathonApi';

/** Score buttons for one criterion: 1..max, big tap targets (judges walk the demo floor). */
function CriterionPicker({ c, value, disabled, onChange }: {
  c: HackathonCriterion;
  value: number | undefined;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const options = Array.from({ length: c.maxScore }, (_, i) => i + 1);
  return (
    <div className="py-3" data-testid="judge-criterion">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-theme-text break-words">{c.name}</p>
        <p className="text-xs text-theme-text-muted shrink-0">weight {c.weight}</p>
      </div>
      {c.description && <p className="text-xs text-theme-text-secondary mt-0.5 break-words">{c.description}</p>}
      <div role="radiogroup" aria-label={c.name} className="mt-2 flex flex-wrap gap-2">
        {options.map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${c.name}: ${n} of ${c.maxScore}`}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={`min-w-[44px] h-11 px-2 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-60 ${
                active
                  ? 'bg-theme-accent border-theme-accent text-white'
                  : 'border-theme-stroke text-theme-text-secondary bg-theme-surface hover:border-theme-stroke-hover hover:text-theme-text'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LINKS = [
  ['repoUrl', Github, 'Repo'],
  ['demoVideoUrl', Video, 'Demo video'],
  ['deckUrl', Presentation, 'Deck'],
  ['liveUrl', Globe, 'Live app'],
] as const;

/**
 * One project + the scoring form (plans/hackathon-platform.md §8 Judge, PR 4). Everything the
 * server left out in blind mode (team, links) simply isn't rendered.
 */
export function JudgeScoring({ submission, criteria, tracks, judgingStatus, saving, error, onDismissError, onSave, onBack, onNext }: {
  submission: JudgeSubmission;
  criteria: HackathonCriterion[];
  tracks: HackathonTrack[];
  judgingStatus: JudgingStatus;
  saving: boolean;
  error: string | null;
  onDismissError: () => void;
  onSave: (body: ScoreInput) => Promise<boolean>;
  onBack: () => void;
  onNext: (() => void) | null;
}) {
  const [scores, setScores] = useState<Record<string, number>>(submission.myScore?.criterionScores ?? {});
  const [privateComment, setPrivateComment] = useState(submission.myScore?.privateComment ?? '');
  const [teamFeedback, setTeamFeedback] = useState(submission.myScore?.teamFeedback ?? '');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // A different project (or a fresh server copy after save) resets the form.
  useEffect(() => {
    setScores(submission.myScore?.criterionScores ?? {});
    setPrivateComment(submission.myScore?.privateComment ?? '');
    setTeamFeedback(submission.myScore?.teamFeedback ?? '');
  }, [submission.id, submission.myScore?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSavedAt(null); }, [submission.id]);

  const total = useMemo(() => weightedTotal(scores, criteria), [scores, criteria]);
  const complete = criteria.length > 0 && criteria.every((c) => typeof scores[c.id] === 'number');
  const open = judgingStatus === 'open';
  const trackNames = tracks.filter((t) => submission.trackIds.includes(t.id)).map((t) => t.name);
  const images = [...(submission.cover ? [submission.cover] : []), ...submission.screenshots].filter((i) => !!i.url);
  const links = submission.links ? LINKS.filter(([k]) => !!submission.links![k]) : [];

  const save = async () => {
    const ok = await onSave({ scores, privateComment: privateComment.trim() || null, teamFeedback: teamFeedback.trim() || null });
    if (ok) setSavedAt(new Date().toISOString());
  };

  return (
    <div className="space-y-4" data-testid="judge-scoring">
      <button type="button" onClick={onBack} className="lg:hidden inline-flex items-center gap-1.5 text-sm text-theme-text-secondary min-h-[44px]">
        <ArrowLeft size={16} /> All projects
      </button>

      <div className="card p-4 sm:p-6">
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-3 snap-x">
            {images.map((img, i) => (
              <a key={img.path} href={img.url!} target="_blank" rel="noopener noreferrer" className="shrink-0 snap-start">
                <img src={img.url!} alt={i === 0 && submission.cover ? 'Cover image' : 'Screenshot'} className="h-36 sm:h-44 w-auto max-w-[80vw] object-cover rounded-xl border border-theme-stroke" />
              </a>
            ))}
          </div>
        )}
        <h2 className="text-xl font-semibold text-theme-text break-words">{submission.name}</h2>
        {submission.tagline && <p className="text-sm text-theme-text-secondary mt-1 break-words">{submission.tagline}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-theme-text-muted">
          {submission.tableNumber && <span className="inline-flex items-center gap-1"><Hash size={12} /> Table {submission.tableNumber}</span>}
          {trackNames.length > 0 && <span>{trackNames.join(' · ')}</span>}
        </div>
        {submission.team && (
          <p className="text-sm text-theme-text-secondary mt-3 flex items-start gap-1.5 break-words">
            <Users size={14} className="mt-0.5 shrink-0" />
            <span><span className="font-medium text-theme-text">{submission.team.name}</span>{submission.team.members.length > 0 && `: ${submission.team.members.map((m) => m.name).join(', ')}`}</span>
          </p>
        )}
        {submission.description && <p className="text-sm text-theme-text-secondary mt-3 whitespace-pre-wrap break-words">{submission.description}</p>}

        <div className="mt-4">
          {submission.linksLocked ? (
            <p className="text-sm text-theme-text-muted flex items-center gap-2 rounded-xl border border-dashed border-theme-stroke p-3" data-testid="judge-links-locked">
              <Lock size={14} className="shrink-0" /> Blind judging: repo, demo and live links unlock after you save a score.
            </p>
          ) : links.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {links.map(([k, Icon, label]) => (
                <a key={k} href={submission.links![k]!} target="_blank" rel="noopener noreferrer nofollow ugc"
                  className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                  <Icon size={14} /> {label}
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-theme-text-muted">No links provided.</p>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-theme-text">Your score</h3>
            <p className="text-sm text-theme-text-secondary mt-0.5">
              {open ? 'You can change it until the host closes judging.' : judgingStatus === 'closed' ? 'Judging is closed.' : "Judging hasn't opened yet. You can look around."}
            </p>
          </div>
          <div className="text-right shrink-0" aria-live="polite">
            <p className="text-2xl font-bold text-theme-text tabular-nums" data-testid="judge-total">{total === null ? '-' : Math.round(total)}</p>
            <p className="text-xs text-theme-text-muted">of 100</p>
          </div>
        </div>
        <div className="divide-y divide-theme-stroke mt-2">
          {criteria.map((c) => (
            <CriterionPicker key={c.id} c={c} value={scores[c.id]} disabled={!open || saving} onChange={(v) => setScores((s) => ({ ...s, [c.id]: v }))} />
          ))}
        </div>
        <div className="space-y-3 mt-3">
          <div>
            <IconInput icon={MessageSquare} multiline rows={3} maxLength={2000} disabled={!open || saving}
              placeholder="Private note for the hosts (optional)" value={privateComment} onChange={(e) => setPrivateComment(e.target.value)} />
          </div>
          <div>
            <IconInput icon={MessageSquareHeart} multiline rows={3} maxLength={2000} disabled={!open || saving}
              placeholder="Feedback for the team (optional)" value={teamFeedback} onChange={(e) => setTeamFeedback(e.target.value)} />
            <Hint>The team sees this after results are revealed.</Hint>
          </div>
        </div>
        <div className="mt-3"><ErrorBanner message={error} onClose={onDismissError} /></div>
        <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
          {savedAt && !saving && (
            <p className="text-sm text-theme-success inline-flex items-center gap-1.5 sm:mr-auto"><CheckCircle2 size={16} /> Saved</p>
          )}
          {savedAt && onNext && (
            <button type="button" className="btn-secondary min-h-[44px]" onClick={onNext}>Next project</button>
          )}
          <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 min-h-[44px]" disabled={!open || !complete || saving}
            onClick={() => void save()} data-testid="judge-save">
            {saving && <Loader2 size={16} className="animate-spin" />}
            {submission.myScore ? 'Update score' : 'Save score'}
          </button>
        </div>
        {open && !complete && <p className="text-xs text-theme-text-muted mt-2 text-right">Score every criterion to save.</p>}
      </div>
    </div>
  );
}
