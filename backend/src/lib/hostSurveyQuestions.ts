// panzerotti-58527: post-event HOST survey question set, loaded from the DB.
//
// Mirrors backend/src/lib/surveyQuestions.ts (the guest loader) but reads the
// `host_survey_question_sets` + `host_survey_questions` tables. The frontend
// `frontend/src/lib/surveyQuestions.ts` shared types are reused (identical
// shapes). The /api/host-survey/:token response includes the full question set
// so HostSurveyPage renders against the current copy.
//
// In ADDITION to the DB-loaded set, `buildHostSurveyQuestions(party)` prepends a
// synthetic `guests_attended` question when the party has no estimated
// attendance, so we can capture the headcount post-event. That synthetic
// question is NEVER written to the host_survey_questions table.

import { prisma } from '../config/database.js';

export type HostSurveyQuestionType = 'rating' | 'yesno' | 'multiple' | 'text';

export interface HostSurveyQuestion {
  id: string;
  type: HostSurveyQuestionType;
  text: string;
  scale?: number;
  multi?: boolean;
  options?: string[];
  allowOther?: boolean;
}

export type LoadedHostSet = {
  version: number;
  questions: HostSurveyQuestion[];
};

// Synthetic question id captured iff the party has no estimatedAttendance. It is
// a `text` question (there is no numeric type) validated as an integer >= 0.
export const GUESTS_ATTENDED_ID = 'guests_attended';

// ---------------------------------------------------------------------------
// In-memory cache: 60s TTL, keyed by question-set id. `refresh: true` bypasses.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;
const cache: Map<string, { value: LoadedHostSet; expiresAt: number }> = new Map();

export async function loadHostQuestionSet(
  setId: string = 'default',
  opts?: { refresh?: boolean }
): Promise<LoadedHostSet> {
  const now = Date.now();
  if (!opts?.refresh) {
    const hit = cache.get(setId);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  const set = await prisma.hostSurveyQuestionSet.findUnique({
    where: { id: setId },
    include: {
      questions: {
        where: { active: true },
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!set) {
    throw new Error(`Host survey question set "${setId}" not found`);
  }

  const questions: HostSurveyQuestion[] = set.questions.map((q) => {
    const out: HostSurveyQuestion = {
      id: q.id,
      type: q.type as HostSurveyQuestionType,
      text: q.text,
    };
    if (q.scale !== null && q.scale !== undefined) out.scale = q.scale;
    if (q.multi) out.multi = true;
    if (q.allowOther) out.allowOther = true;
    if (Array.isArray(q.options) && q.options.length > 0) {
      out.options = (q.options as unknown[]).filter(
        (x): x is string => typeof x === 'string'
      );
    }
    return out;
  });

  const value: LoadedHostSet = { version: set.version, questions };
  cache.set(setId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// The synthetic guests-attended question (rendered as a numeric input on the
// frontend; stored as a stringified integer in answers).
function guestsAttendedQuestion(): HostSurveyQuestion {
  return {
    id: GUESTS_ATTENDED_ID,
    type: 'text',
    text: 'How many guests attended?',
  };
}

/**
 * Build the host question list to RENDER + VALIDATE against for a given party.
 * Loads the default DB set and prepends the synthetic `guests_attended`
 * question (as the FIRST question) ONLY when `party.estimatedAttendance` is
 * null. Both the public GET (render) and POST (validate) MUST call this against
 * the SAME party so the conditional question is accepted iff it was shown.
 */
export async function buildHostSurveyQuestions(
  party: { estimatedAttendance?: number | null },
  opts?: { refresh?: boolean }
): Promise<LoadedHostSet> {
  const base = await loadHostQuestionSet('default', opts);
  if (party.estimatedAttendance === null || party.estimatedAttendance === undefined) {
    return {
      version: base.version,
      questions: [guestsAttendedQuestion(), ...base.questions],
    };
  }
  return base;
}

/**
 * Validate + normalize a raw answers object against a loaded host question set.
 * Same per-type rules as the guest validator, plus a special case for the
 * synthetic `guests_attended` question: a non-negative integer kept as a string
 * (it is a `text`-typed question with numeric semantics).
 * Invalid values for a known id are dropped (not stored).
 */
export function validateHostSurveyAnswers(
  raw: unknown,
  questionSet: HostSurveyQuestion[]
): Record<string, number | boolean | string | string[]> {
  const out: Record<string, number | boolean | string | string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  const input = raw as Record<string, unknown>;

  for (const q of questionSet) {
    if (!(q.id in input)) continue;
    const v = input[q.id];

    // Synthetic numeric-text question: accept a non-negative integer (stored as
    // a string so it round-trips through the generic `text` answer shape).
    if (q.id === GUESTS_ATTENDED_ID) {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (Number.isInteger(n) && n >= 0) {
        out[q.id] = String(n);
      }
      continue;
    }

    switch (q.type) {
      case 'rating': {
        const scale = q.scale ?? 5;
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= scale) {
          out[q.id] = n;
        }
        break;
      }
      case 'yesno': {
        if (typeof v === 'boolean') {
          out[q.id] = v;
        }
        break;
      }
      case 'multiple': {
        const options = q.options ?? [];
        if (q.multi) {
          if (Array.isArray(v)) {
            const subset = v.filter(
              (x): x is string => typeof x === 'string' && options.includes(x)
            );
            const seen = new Set<string>();
            const deduped = subset.filter((x) => {
              if (seen.has(x)) return false;
              seen.add(x);
              return true;
            });
            out[q.id] = deduped;
          }
        } else {
          if (typeof v === 'string' && options.includes(v)) {
            out[q.id] = v;
          }
        }
        break;
      }
      case 'text': {
        if (typeof v === 'string') {
          out[q.id] = v.trim().slice(0, 5000);
        }
        break;
      }
    }

    if (q.allowOther) {
      const otherKey = `${q.id}_other`;
      const rawOther = input[otherKey];
      if (typeof rawOther === 'string' && out[q.id] === 'Other') {
        const trimmed = rawOther.trim();
        if (trimmed.length > 0) {
          out[otherKey] = trimmed.slice(0, 200);
        }
      }
    }
  }

  return out;
}
