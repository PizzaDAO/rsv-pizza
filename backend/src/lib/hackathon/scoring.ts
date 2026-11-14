/**
 * Hackathon judging math (plans/hackathon-platform.md §5 "Score aggregation", PR 4). Pure,
 * unit-tested.
 *
 *   per judge:      total = 100 * sum(w_i * s_i / max_i) / sum(w_i)      (0-100, 2 decimals)
 *   per submission: mean of the counted judge totals, plus count and min/max spread
 *   ranking:        by mean desc; equal means share a rank (competition ranking 1,1,3);
 *                   unscored projects come last with rank null. Ties are shown, the host decides.
 *
 * Scores are whole numbers from 1 to the criterion's max_score (the host rubric UI says
 * "Score 1-N"). Every criterion of the rubric must be scored; unknown criteria are rejected.
 *
 * Rubric changes after scoring starts (enforced in hackathon.routes.ts):
 *   - deleting or adding a criterion, or changing a max score: blocked (409 RUBRIC_LOCKED),
 *     because existing scores would no longer cover the rubric or fit its scale;
 *   - changing a weight: allowed. Stored totals are recomputed from each score's stored
 *     per-criterion values in the same transaction, and the leaderboard always recomputes
 *     from criterion_scores with the current weights, so the two never disagree.
 *   - name / description: always editable.
 */
import { AppError } from '../../middleware/error.js';
import { optText } from './validate.js';

export interface CriterionLike {
  id: string;
  name?: string;
  weight: number;
  maxScore: number;
}

export type CriterionScores = Record<string, number>;

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');

export const COMMENT_MAX = 2000; // DB CHECK on private_comment / team_feedback

/** Weighted total 0-100 (2 decimals). Only criteria present in `scores` count; null when none. */
export function computeTotal(scores: CriterionScores, criteria: CriterionLike[]): number | null {
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (typeof s !== 'number' || !Number.isFinite(s) || c.maxScore <= 0) continue;
    num += c.weight * (Math.min(Math.max(s, 0), c.maxScore) / c.maxScore);
    den += c.weight;
  }
  if (den === 0) return null;
  return Math.round((10000 * num) / den) / 100;
}

/** True when every rubric criterion has a score. */
export function isComplete(scores: CriterionScores, criteria: CriterionLike[]): boolean {
  return criteria.every((c) => typeof scores[c.id] === 'number');
}

export interface ScoreInput {
  criterionScores: CriterionScores;
  total: number;
  privateComment: string | null;
  teamFeedback: string | null;
}

/** Validate a judge's PUT body against the current rubric. Throws 400. */
export function parseScoreInput(body: Record<string, unknown>, criteria: CriterionLike[]): ScoreInput {
  if (!criteria.length) throw new AppError('The rubric has no criteria yet, so projects cannot be scored.', 409, 'NO_RUBRIC');
  const raw = body.scores;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('scores must be an object of {criterionId: score}');
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const out: CriterionScores = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = byId.get(id);
    if (!c) throw bad('Unknown criterion in scores');
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > c.maxScore) {
      throw bad(`${c.name ?? 'Each criterion'} must be scored from 1 to ${c.maxScore}`);
    }
    out[id] = n;
  }
  const missing = criteria.filter((c) => out[c.id] === undefined);
  if (missing.length) throw bad(`Score every criterion (missing: ${missing.map((c) => c.name ?? c.id).join(', ')})`);
  const total = computeTotal(out, criteria);
  if (total === null || total < 0 || total > 100) throw bad('Invalid score');
  return {
    criterionScores: out,
    total,
    privateComment: optText(body.privateComment, 'Comment for hosts', COMMENT_MAX),
    teamFeedback: optText(body.teamFeedback, 'Feedback for the team', COMMENT_MAX),
  };
}

/** criterion_scores jsonb -> clean {id: int} (drops anything malformed). */
export function readCriterionScores(v: unknown): CriterionScores {
  const out: CriterionScores = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

// ---------------------------------------------------------------- leaderboard

export interface LbScore {
  judgeId: string;
  criterionScores: CriterionScores;
  /** false = the judge was removed; shown to the host but not averaged. */
  counted: boolean;
}

export interface LbSubmission {
  id: string;
  trackIds: string[];
}

export interface LbRow {
  submissionId: string;
  average: number | null;
  scoreCount: number;
  min: number | null;
  max: number | null;
  /** Mean raw score per criterion (2 decimals), over counted scores that have it. */
  criterionAverages: Record<string, number | null>;
  rank: number | null;
  tied: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function aggregateSubmission(submissionId: string, scores: LbScore[], criteria: CriterionLike[]): Omit<LbRow, 'rank' | 'tied'> {
  const counted = scores.filter((s) => s.counted);
  const totals = counted.map((s) => computeTotal(s.criterionScores, criteria)).filter((t): t is number => t !== null);
  const criterionAverages: Record<string, number | null> = {};
  for (const c of criteria) {
    const vals = counted.map((s) => s.criterionScores[c.id]).filter((v): v is number => typeof v === 'number');
    criterionAverages[c.id] = vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return {
    submissionId,
    average: totals.length ? r2(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
    scoreCount: totals.length,
    min: totals.length ? Math.min(...totals) : null,
    max: totals.length ? Math.max(...totals) : null,
    criterionAverages,
  };
}

/** Rank rows by average desc. Ties share a rank (1, 1, 3). Unscored: rank null, last. */
export function rankRows(rows: Array<Omit<LbRow, 'rank' | 'tied'>>): LbRow[] {
  const scored = rows.filter((r) => r.average !== null).sort((a, b) => (b.average! - a.average!) || (b.scoreCount - a.scoreCount));
  const unscored = rows.filter((r) => r.average === null);
  const out: LbRow[] = [];
  scored.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = prev && prev.average === r.average ? prev.rank! : i + 1;
    out.push({ ...r, rank, tied: false });
  });
  for (const r of out) r.tied = out.filter((x) => x.rank === r.rank).length > 1;
  return [...out, ...unscored.map((r) => ({ ...r, rank: null, tied: false }))];
}

/** Overall + per-track rankings. A project entered in several tracks ranks in each. */
export function buildLeaderboard(
  submissions: LbSubmission[],
  scoresBySubmission: Map<string, LbScore[]>,
  criteria: CriterionLike[],
  trackIds: string[],
): { overall: LbRow[]; tracks: Array<{ trackId: string; rows: LbRow[] }> } {
  const agg = new Map(submissions.map((s) => [s.id, aggregateSubmission(s.id, scoresBySubmission.get(s.id) ?? [], criteria)]));
  const overall = rankRows(submissions.map((s) => agg.get(s.id)!));
  const tracks = trackIds.map((trackId) => ({
    trackId,
    rows: rankRows(submissions.filter((s) => s.trackIds.includes(trackId)).map((s) => agg.get(s.id)!)),
  }));
  return { overall, tracks };
}
