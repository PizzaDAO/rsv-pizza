// romana-61204: Canonical post-event guest survey question set.
//
// This is the SINGLE SOURCE OF TRUTH for the question set on the backend.
// It is MIRRORED in frontend/src/lib/surveyQuestions.ts — keep the two in sync.
// Bump SURVEY_QUESTION_SET_VERSION whenever the set changes so stored responses
// can be interpreted against the version they were collected under.

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

export const SURVEY_QUESTION_SET_VERSION = 3;

export const SURVEY_QUESTION_SET: SurveyQuestion[] = [
  {
    id: 'attended',
    type: 'yesno',
    text: 'Did you attend the event?',
  },
  {
    id: 'overall_rating',
    type: 'rating',
    scale: 5,
    text: 'How would you rate the event overall?',
  },
  {
    id: 'pizza_rating',
    type: 'rating',
    scale: 5,
    text: 'How was the pizza?',
  },
  {
    id: 'enough_pizza',
    type: 'yesno',
    text: 'Was there enough pizza?',
  },
  {
    id: 'recommend',
    type: 'yesno',
    text: 'Would you come to another PizzaDAO event?',
  },
  {
    id: 'discovery',
    type: 'multiple',
    multi: false,
    text: 'How did you hear about this event?',
    options: ['A friend', 'Twitter/X', 'The organizer', 'Brave Browser', 'Other'],
    allowOther: true,
  },
  {
    id: 'highlight',
    type: 'multiple',
    multi: true,
    text: 'What did you enjoy most?',
    options: ['The pizza', 'The people', 'The talks / program', 'The vibe'],
  },
  {
    id: 'comments',
    type: 'text',
    text: "Anything else you'd like to share?",
  },
];

/**
 * Validate + normalize a raw answers object against the canonical question set.
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
  raw: unknown
): Record<string, number | boolean | string | string[]> {
  const out: Record<string, number | boolean | string | string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  const input = raw as Record<string, unknown>;

  for (const q of SURVEY_QUESTION_SET) {
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
