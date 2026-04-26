import React from 'react';
import { Loader2, ChevronLeft, Check, X, ExternalLink } from 'lucide-react';
import type { useRSVPForm } from '../hooks/useRSVPForm';

interface RSVPFormStep3Props {
  form: ReturnType<typeof useRSVPForm>;
  isEditing?: boolean;
}

export function RSVPFormStep3({ form, isEditing }: RSVPFormStep3Props) {
  const allAnswered = form.quizQuestions.length > 0 &&
    form.quizQuestions.every(q => form.quizAnswers[q.id] !== undefined);

  const handleOptionSelect = (questionId: string, optionIndex: number) => {
    if (form.quizSubmitted) return;
    form.setQuizAnswer(questionId, optionIndex);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAnswered) return;
    form.handleSubmit(e);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {form.quizQuestions.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-theme-text-muted" />
        </div>
      ) : (
        <>
          {form.quizQuestions.map((q, idx) => {
            const selectedIndex = form.quizAnswers[q.id];
            const result = form.quizResults?.results.find(r => r.questionId === q.id);
            const hasAnswered = selectedIndex !== undefined;

            return (
              <div
                key={q.id}
                className="p-4 rounded-xl border border-theme-stroke bg-theme-surface space-y-3"
              >
                {/* Question header with sponsor logo */}
                <div className="flex items-start gap-3">
                  {q.sponsor?.logoUrl ? (
                    <img
                      src={q.sponsor.logoUrl}
                      alt={q.sponsor.name}
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-theme-surface-hover flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-theme-text-muted">{idx + 1}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {q.sponsor && (
                      <p className="text-[11px] text-theme-text-muted mb-0.5">{q.sponsor.name}</p>
                    )}
                    <p className="text-sm font-medium text-theme-text">{q.question}</p>
                  </div>
                </div>

                {/* Options */}
                <div className="space-y-2 ml-10">
                  {q.options.map((option, optIdx) => {
                    const isSelected = selectedIndex === optIdx;
                    const isCorrect = result?.correctIndex === optIdx;
                    const isWrong = result && isSelected && !result.isCorrect && result.correctIndex !== optIdx;

                    let borderClass = 'border-theme-stroke';
                    let bgClass = 'bg-theme-surface hover:bg-theme-surface-hover';

                    if (result) {
                      // After submission — show results
                      if (isCorrect) {
                        borderClass = 'border-[#39d98a]/50';
                        bgClass = 'bg-[#39d98a]/10';
                      } else if (isWrong) {
                        borderClass = 'border-[#ff393a]/50';
                        bgClass = 'bg-[#ff393a]/10';
                      }
                    } else if (isSelected) {
                      // Before submission — selected state
                      borderClass = 'border-[#ff393a]';
                      bgClass = 'bg-[#ff393a]/10';
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleOptionSelect(q.id, optIdx)}
                        disabled={form.quizSubmitted}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${borderClass} ${bgClass} ${form.quizSubmitted ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          result
                            ? isCorrect
                              ? 'border-[#39d98a] bg-[#39d98a]/20'
                              : isWrong
                                ? 'border-[#ff393a] bg-[#ff393a]/20'
                                : 'border-theme-stroke'
                            : isSelected
                              ? 'border-[#ff393a] bg-[#ff393a]/20'
                              : 'border-theme-stroke'
                        }`}>
                          {result && isCorrect && <Check size={12} className="text-[#39d98a]" />}
                          {result && isWrong && <X size={12} className="text-[#ff393a]" />}
                          {!result && isSelected && <div className="w-2.5 h-2.5 rounded-full bg-[#ff393a]" />}
                        </div>
                        <span className={`text-sm ${
                          result && isCorrect ? 'text-[#39d98a] font-medium' :
                          result && isWrong ? 'text-[#ff393a]' :
                          'text-theme-text'
                        }`}>
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Explanation after submission */}
                {result && result.explanation && (
                  <div className="ml-10 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-300">{result.explanation}</p>
                  </div>
                )}

                {/* Learn more link when wrong */}
                {result && !result.isCorrect && q.sponsor?.website && (
                  <div className="ml-10">
                    <a
                      href={q.sponsor.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#ff393a] hover:text-[#ff393a]/80 transition-colors"
                    >
                      Learn more at {q.sponsor.name} <ExternalLink size={10} />
                    </a>
                  </div>
                )}
              </div>
            );
          })}

          {/* Score display after submission */}
          {form.quizResults && (
            <div className="p-4 rounded-xl border border-theme-stroke bg-theme-surface text-center">
              <p className="text-lg font-bold text-theme-text">
                {form.quizResults.totalCorrect} / {form.quizResults.totalQuestions} correct
              </p>
              <p className="text-sm text-theme-text-muted">
                {form.quizResults.score >= 80
                  ? 'Great job!'
                  : form.quizResults.score >= 50
                    ? 'Not bad!'
                    : 'Better luck next time!'}
              </p>
            </div>
          )}
        </>
      )}

      {/* Error display */}
      {form.error && (
        <div className="bg-[#ff393a]/10 border border-[#ff393a]/30 text-[#ff393a] p-3 rounded-xl text-sm">
          {form.error}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => form.setStep(2)}
          className="btn-secondary flex items-center gap-2"
          disabled={form.submitting}
        >
          <ChevronLeft size={18} />
          Back
        </button>
        <button
          type="submit"
          disabled={!allAnswered || form.submitting}
          className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          data-testid="rsvp-submit"
        >
          {form.submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Submitting...
            </>
          ) : (
            isEditing ? 'Edit RSVP' : 'RSVP'
          )}
        </button>
      </div>
    </form>
  );
}
