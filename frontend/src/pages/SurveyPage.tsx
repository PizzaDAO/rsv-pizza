import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2, AlertCircle, CheckCircle2, Star, MessageSquare } from 'lucide-react';
import { Layout } from '../components/Layout';
import { IconInput } from '../components/IconInput';
import { Checkbox } from '../components/Checkbox';
import { fetchSurvey, submitSurvey, type SurveyFetchResponse } from '../lib/api';
import type { SurveyQuestion, SurveyAnswers, SurveyAnswerValue } from '../lib/surveyQuestions';

export function SurveyPage() {
  const { token } = useParams<{ token: string }>();

  // All hooks declared above any early return (rules-of-hooks).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SurveyFetchResponse | null>(null);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError('Invalid survey link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetchSurvey(token);
      setData(r);
      if (r.answers) setAnswers(r.answers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Survey not found.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const setAnswer = (id: string, value: SurveyAnswerValue) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const toggleMulti = (id: string, option: string) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [id]: next };
    });
  };

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitSurvey(token, answers);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit survey.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Renders below (all hooks already declared) ----

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#ff393a]" />
        </div>
      </Layout>
    );
  }

  if (error && !data) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="card p-8 max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-[#ff393a] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">Survey not found</h1>
            <p className="text-theme-text-muted">{error}</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (data && !data.surveyEnabled && !data.alreadySubmitted) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="card p-8 max-w-md text-center">
            <MessageSquare className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">Survey closed</h1>
            <p className="text-theme-text-muted">This survey is no longer accepting responses.</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (submitted) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="card p-8 max-w-md text-center">
            <CheckCircle2 className="w-16 h-16 text-[#2E7D32] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-theme-text mb-2">Thank you! 🍕</h1>
            <p className="text-theme-text-muted">
              Your feedback helps us throw better PizzaDAO events.
            </p>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="mt-4 text-sm text-theme-text-muted hover:text-theme-text underline"
            >
              Edit my answers
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const questions = data?.questionSet ?? [];

  return (
    <Layout>
      <Helmet>
        <title>{data ? `Survey · ${data.eventName}` : 'Survey'} | RSV.Pizza</title>
      </Helmet>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-theme-text mb-1">
            How was {data?.eventName}?
          </h1>
          <p className="text-theme-text-muted">
            {data?.firstName ? `Thanks for coming, ${data.firstName}! ` : ''}
            Tell us what you thought — it takes less than a minute.
          </p>
          {data?.alreadySubmitted && (
            <p className="text-xs text-theme-text-muted mt-2">
              You've already responded. You can update your answers below.
            </p>
          )}
        </div>

        <div className="space-y-6">
          {questions.map((q) => (
            <div key={q.id} className="card p-5">
              <p className="text-sm font-medium text-theme-text mb-3">{q.text}</p>
              <SurveyQuestionField
                question={q}
                value={answers[q.id]}
                onRating={(n) => setAnswer(q.id, n)}
                onYesNo={(b) => setAnswer(q.id, b)}
                onSingle={(opt) => setAnswer(q.id, opt)}
                onToggleMulti={(opt) => toggleMulti(q.id, opt)}
                onText={(s) => setAnswer(q.id, s)}
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="mt-4 text-sm text-[#ff393a] text-center">{error}</p>
        )}

        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Submitting…' : data?.alreadySubmitted ? 'Update answers' : 'Submit'}
          </button>
        </div>
      </div>
    </Layout>
  );
}

interface FieldProps {
  question: SurveyQuestion;
  value: SurveyAnswerValue | undefined;
  onRating: (n: number) => void;
  onYesNo: (b: boolean) => void;
  onSingle: (opt: string) => void;
  onToggleMulti: (opt: string) => void;
  onText: (s: string) => void;
}

const SurveyQuestionField: React.FC<FieldProps> = ({
  question,
  value,
  onRating,
  onYesNo,
  onSingle,
  onToggleMulti,
  onText,
}) => {
  if (question.type === 'rating') {
    const scale = question.scale ?? 5;
    const current = typeof value === 'number' ? value : 0;
    return (
      <div className="flex items-center gap-2">
        {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Rate ${n}`}
            onClick={() => onRating(n)}
            className="p-1 hover:scale-110 transition-transform"
          >
            <Star
              className={n <= current ? 'text-[#ff393a] fill-[#ff393a]' : 'text-theme-text-muted'}
              size={28}
            />
          </button>
        ))}
      </div>
    );
  }

  if (question.type === 'yesno') {
    return (
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onYesNo(true)}
          className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === true
              ? 'bg-[#ff393a] text-white border-[#ff393a]'
              : 'border-white/20 text-theme-text hover:border-white/40'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onYesNo(false)}
          className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === false
              ? 'bg-[#ff393a] text-white border-[#ff393a]'
              : 'border-white/20 text-theme-text hover:border-white/40'
          }`}
        >
          No
        </button>
      </div>
    );
  }

  if (question.type === 'multiple') {
    const options = question.options ?? [];
    if (question.multi) {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2">
          {options.map((opt) => (
            <Checkbox
              key={opt}
              checked={selected.includes(opt)}
              onChange={() => onToggleMulti(opt)}
              label={opt}
            />
          ))}
        </div>
      );
    }
    // single-select — radio-style buttons
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onSingle(opt)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              value === opt
                ? 'bg-[#ff393a] text-white border-[#ff393a]'
                : 'border-white/20 text-theme-text hover:border-white/40'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  // text
  return (
    <IconInput
      icon={MessageSquare}
      multiline
      rows={4}
      placeholder="Share your thoughts (optional)"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onText((e.target as HTMLTextAreaElement).value)}
    />
  );
};
