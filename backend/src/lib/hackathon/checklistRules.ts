/**
 * Checklist auto rules backed by hackathon state (plans/hackathon-platform.md §9). Computed by
 * GET /:partyId/checklist. PR 2 ships the three setup rules, PR 4 judging_closed, PR 5 results_revealed
 * (results revealed; photos stay manual) and prizes_paid (>= 1 award and every award paid or
 * not_applicable: zero awards is not "all paid"). A disabled (or missing) hackathon completes nothing.
 */
export const HACKATHON_AUTO_RULES = [
  'hackathon_published',
  'hackathon_submissions_ready',
  'hackathon_judges_added',
  'hackathon_judging_closed',
  'hackathon_results_revealed',
  'hackathon_prizes_paid',
] as const;

export type HackathonAutoRule = (typeof HACKATHON_AUTO_RULES)[number];

export interface HackathonChecklistInput {
  publishedAt: Date | null;
  disabledAt: Date | null;
  submissionDeadline: Date | null;
  trackCount: number;
  prizeCount: number;
  criterionCount: number;
  activeJudgeCount: number;
  /** PR 4. Optional so older callers default to "not closed". */
  judgingStatus?: string | null;
  /** PR 5. Optional so older callers default to "not done". */
  resultsRevealedAt?: Date | null;
  awardCount?: number;
  /** Awards still unpaid or pending. */
  openPayoutCount?: number;
}

export function hackathonAutoStates(h: HackathonChecklistInput | null): Record<HackathonAutoRule, boolean> {
  if (!h || h.disabledAt) {
    return {
      hackathon_published: false,
      hackathon_submissions_ready: false,
      hackathon_judges_added: false,
      hackathon_judging_closed: false,
      hackathon_results_revealed: false,
      hackathon_prizes_paid: false,
    };
  }
  return {
    hackathon_published: !!h.publishedAt && h.trackCount >= 1 && h.prizeCount >= 1,
    hackathon_submissions_ready: !!h.submissionDeadline && h.criterionCount >= 1,
    hackathon_judges_added: h.activeJudgeCount >= 1,
    hackathon_judging_closed: h.judgingStatus === 'closed',
    hackathon_results_revealed: !!h.resultsRevealedAt,
    hackathon_prizes_paid: (h.awardCount ?? 0) >= 1 && (h.openPayoutCount ?? 1) === 0,
  };
}
