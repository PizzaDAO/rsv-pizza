// pugliese-58297: shared types for the post-event guest survey.
//
// The question set itself is no longer a frontend constant — it is loaded
// from the DB by the backend and delivered to SurveyPage via the
// /api/survey/:token response (`surveyData.questionSet`). This file keeps
// only the shape contracts so SurveyPage + types/api stay strongly typed.

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

export type SurveyAnswerValue = number | boolean | string | string[];
export type SurveyAnswers = Record<string, SurveyAnswerValue>;
