// pugliese-58297: post-event guest survey question set, loaded from the DB.
//
// Previously this file held canonical question-set + version constants;
// today the question set lives in the `survey_question_sets` + `survey_questions`
// tables and is loaded via `loadQuestionSet()` (60s in-memory cache).
//
// The frontend `frontend/src/lib/surveyQuestions.ts` keeps only the shared
// TypeScript types. The /api/survey/:token response continues to include the
// full questionSet so SurveyPage renders against the current copy.

import { prisma } from '../config/database.js';

export type SurveyQuestionType = 'rating' | 'yesno' | 'multiple' | 'text';

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  text: string;
  scale?: number;     // for type 'rating' — max value (ratings are 1..scale)
  multi?: boolean;    // for type 'multiple' — true = multi-select, false/absent = single-select
  options?: string[]; // for type 'multiple'
  allowOther?: boolean; // for type 'multiple' — when true and user picks "Other", a sibling `${id}_other` free-text field is persisted
}

export type LoadedSet = {
  version: number;
  questions: SurveyQuestion[];
};

// ---------------------------------------------------------------------------
// In-memory cache: 60s TTL, keyed by question-set id.
// `refresh: true` bypasses + repopulates. Errors are re-thrown (no fallback).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 60_000;
const cache: Map<string, { value: LoadedSet; expiresAt: number }> = new Map();

export async function loadQuestionSet(
  setId: string = 'default',
  opts?: { refresh?: boolean }
): Promise<LoadedSet> {
  const now = Date.now();
  if (!opts?.refresh) {
    const hit = cache.get(setId);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  const set = await prisma.surveyQuestionSet.findUnique({
    where: { id: setId },
    include: {
      questions: {
        where: { active: true },
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!set) {
    throw new Error(`Survey question set "${setId}" not found`);
  }

  const questions: SurveyQuestion[] = set.questions.map((q) => {
    const out: SurveyQuestion = {
      id: q.id,
      type: q.type as SurveyQuestionType,
      text: q.text,
    };
    if (q.scale !== null && q.scale !== undefined) out.scale = q.scale;
    if (q.multi) out.multi = true;
    if (q.allowOther) out.allowOther = true;
    // `options` is stored as JSONB; treat missing/empty array as "no options".
    if (Array.isArray(q.options) && q.options.length > 0) {
      out.options = (q.options as unknown[]).filter(
        (x): x is string => typeof x === 'string'
      );
    }
    return out;
  });

  const value: LoadedSet = { version: set.version, questions };
  cache.set(setId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

/**
 * Validate + normalize a raw answers object against a loaded question set.
 * - Drops unknown question ids.
 * - Enforces per-type shape:
 *     rating   -> integer in [1, scale]
 *     yesno    -> boolean
 *     multiple (single) -> one of options
 *     multiple (multi)  -> subset of options (deduped, order-preserved)
 *     text     -> string (trimmed)
 * Invalid values for a known id are dropped (not stored).
 * Returns the cleaned answers object that should be persisted.
 */
export function validateSurveyAnswers(
  raw: unknown,
  questionSet: SurveyQuestion[]
): Record<string, number | boolean | string | string[]> {
  const out: Record<string, number | boolean | string | string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  const input = raw as Record<string, unknown>;

  for (const q of questionSet) {
    if (!(q.id in input)) continue;
    const v = input[q.id];

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
            // dedupe, preserve order
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

    // "Other" custom-text sibling key for questions that opt in via allowOther.
    // We only persist `${qid}_other` when the chosen value of `qid` is strictly
    // the literal string "Other" AND a non-empty trimmed string remains. This
    // strips stale `_other` values when the user switches their choice.
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
