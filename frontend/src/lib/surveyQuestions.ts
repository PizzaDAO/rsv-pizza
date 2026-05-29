// romana-61204: Canonical post-event guest survey question set (frontend mirror).
//
// This MIRRORS backend/src/lib/surveyQuestions.ts — keep the two in sync.
// The server is the source of truth and re-validates every submission; this
// copy is used only to render the form when the API hasn't supplied a set yet
// and to type the answer shapes.

export type SurveyQuestionType = 'rating' | 'yesno' | 'multiple' | 'text';

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  text: string;
  scale?: number;     // for type 'rating' — max value (ratings are 1..scale)
  multi?: boolean;    // for type 'multiple' — true = multi-select
  options?: string[]; // for type 'multiple'
  allowOther?: boolean; // for type 'multiple' — when true and user picks "Other", a sibling `${id}_other` free-text field is persisted
}

export const SURVEY_QUESTION_SET_VERSION = 1;

export const SURVEY_QUESTION_SET: SurveyQuestion[] = [
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
    id: 'recommend',
    type: 'yesno',
    text: 'Would you come to another PizzaDAO event?',
  },
  {
    id: 'discovery',
    type: 'multiple',
    multi: false,
    text: 'How did you hear about this event?',
    options: ['A friend', 'Twitter/X', 'The organizer', 'Other'],
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

export type SurveyAnswerValue = number | boolean | string | string[];
export type SurveyAnswers = Record<string, SurveyAnswerValue>;
