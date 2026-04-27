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

  const checkResult = form.quizCheckResults;
  const hasChecked = !!checkResult;
  const allCorrect = form.quizAllCorrect;

  const handleOptionSelect = (questionId: string, optionIndex: number) => {
    if (allCorrect) return; // Lock options once all correct
    form.setQuizAnswer(questionId, optionIndex);
  };

  const handleCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allAnswered) return;
    form.checkQuiz();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allCorrect) return;
    form.handleSubmit(e);
  };

  return (
    <form onSubmit={allCorrect ? handleSubmit : handleCheck} className="space-y-4">
      {form.quizQuestions.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-theme-text-muted" />
        </div>
      ) : (
        <>
          {form.quizQuestions.map((q) => {
            const selectedIndex = form.quizAnswers[q.id];
            const result = checkResult?.results.find(r => r.questionId === q.id);

            return (
              <div
                key={q.id}
                className="p-4 rounded-xl border border-theme-stroke bg-theme-surface space-y-3"
              >
                {/* Question header with sponsor logo */}
                <div className="space-y-2">
                  {q.sponsor?.logoUrl ? (
                    <img
                      src={q.sponsor.logoUrl}
                      alt={q.sponsor.name}
                      className="h-8 max-w-[160px] object-contain"
                    />
                  ) : q.sponsor ? (
                    <p className="text-sm font-semibold text-theme-text">{q.sponsor.name}</p>
                  ) : null}
                  <p className="text-sm font-medium text-theme-text">{q.question}</p>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {q.options.map((option, optIdx) => {
                    const isSelected = selectedIndex === optIdx;
                    const isCorrectAnswer = result?.isCorrect && isSelected;
                    const isWrong = result && isSelected && !result.isCorrect;

                    let borderClass = 'border-theme-stroke';
                    let bgClass = 'bg-theme-surface hover:bg-theme-surface-hover';

                    if (result) {
                      if (isCorrectAnswer) {
                        borderClass = 'border-[#39d98a]/50';
                        bgClass = 'bg-[#39d98a]/10';
                      } else if (isWrong) {
                        borderClass = 'border-[#ff393a]/50';
                        bgClass = 'bg-[#ff393a]/10';
                      }
                    } else if (isSelected) {
                      borderClass = 'border-[#ff393a]';
                      bgClass = 'bg-[#ff393a]/10';
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleOptionSelect(q.id, optIdx)}
                        disabled={allCorrect}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${borderClass} ${bgClass} ${allCorrect ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          result
                            ? isCorrectAnswer
                              ? 'border-[#39d98a] bg-[#39d98a]/20'
                              : isWrong
                                ? 'border-[#ff393a] bg-[#ff393a]/20'
                                : 'border-theme-stroke'
                            : isSelected
                              ? 'border-[#ff393a] bg-[#ff393a]/20'
                              : 'border-theme-stroke'
                        }`}>
                          {result && isCorrectAnswer && <Check size={12} className="text-[#39d98a]" />}
                          {result && isWrong && <X size={12} className="text-[#ff393a]" />}
                          {!result && isSelected && <div className="w-2.5 h-2.5 rounded-full bg-[#ff393a]" />}
                        </div>
                        <span className={`text-sm ${
                          result && isCorrectAnswer ? 'text-[#39d98a] font-medium' :
                          result && isWrong ? 'text-[#ff393a]' :
                          'text-theme-text'
                        }`}>
                          {option}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Result feedback */}
                {result && result.isCorrect && (
                  <div className="p-3 rounded-lg bg-[#39d98a]/10 border border-[#39d98a]/30">
                    <p className="text-sm text-[#39d98a] font-medium">
                      Correct!{result.explanation ? ` ${result.explanation}.` : ''}
                      {(q.sponsor?.website || q.sponsor?.brandTwitter) && (
                        <>
                          {q.sponsor.website && (
                            <>
                              {' '}Visit {q.sponsor.name || 'them'} at{' '}
                              <a href={q.sponsor.website} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{q.sponsor.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>
                            </>
                          )}
                          {q.sponsor.website && q.sponsor.brandTwitter && ' and '}
                          {q.sponsor.brandTwitter && (
                            <>
                              {!q.sponsor.website && ' '}follow at{' '}
                              <a href={`https://x.com/${q.sponsor.brandTwitter.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">@{q.sponsor.brandTwitter.replace(/^@/, '')}</a>
                            </>
                          )}
                          .
                        </>
                      )}
                    </p>
                  </div>
                )}

                {result && !result.isCorrect && (
                  <div className="p-3 rounded-lg bg-[#ff393a]/10 border border-[#ff393a]/30">
                    <p className="text-sm text-[#ff393a] font-medium">
                      Incorrect!{' '}
                      {(q.sponsor?.website || q.sponsor?.brandTwitter) ? (
                        <>
                          Check{' '}
                          {q.sponsor.website && (
                            <a href={q.sponsor.website} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">{q.sponsor.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>
                          )}
                          {q.sponsor.website && q.sponsor.brandTwitter && ' or '}
                          {q.sponsor.brandTwitter && (
                            <a href={`https://x.com/${q.sponsor.brandTwitter.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">@{q.sponsor.brandTwitter.replace(/^@/, '')}</a>
                          )}
                          {' '}for hints.
                        </>
                      ) : 'Try again.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Score summary — only show when multiple questions */}
          {hasChecked && !allCorrect && checkResult.totalQuestions > 1 && (
            <div className="p-3 rounded-xl bg-[#ff393a]/10 border border-[#ff393a]/30 text-center">
              <p className="text-sm text-[#ff393a] font-medium">
                {checkResult.totalCorrect} / {checkResult.totalQuestions} correct — fix your answers and try again
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
          disabled={form.submitting || form.checkingQuiz}
        >
          <ChevronLeft size={18} />
          Back
        </button>

        {allCorrect ? (
          <button
            type="submit"
            disabled={form.submitting}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
            data-testid="rsvp-submit"
          >
            {form.submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Submitting...
              </>
            ) : (
              isEditing ? 'Edit RSVP' : 'Submit RSVP'
            )}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!allAnswered || form.checkingQuiz}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {form.checkingQuiz ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Checking...
              </>
            ) : (
              'Check Answers'
            )}
          </button>
        )}
      </div>
    </form>
  );
}
