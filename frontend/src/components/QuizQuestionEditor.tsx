import React, { useState, useEffect } from 'react';
import { Trash2, Check, ChevronUp, ChevronDown, BookOpen } from 'lucide-react';
import { IconInput } from './IconInput';

interface QuizQuestionEditorProps {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
  isFromTemplate?: boolean;
  sponsorName?: string | null;
  onUpdate: (data: {
    question?: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
  }) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
}

export function QuizQuestionEditor({
  question,
  options,
  correctIndex,
  explanation,
  isFromTemplate,
  sponsorName,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: QuizQuestionEditorProps) {
  const [localQuestion, setLocalQuestion] = useState(question);
  const [localOptions, setLocalOptions] = useState<string[]>(
    options.length >= 4 ? options : [...options, ...Array(4 - options.length).fill('')]
  );
  const [localCorrectIndex, setLocalCorrectIndex] = useState(correctIndex);
  const [localExplanation, setLocalExplanation] = useState(explanation || '');

  // Sync from props when they change externally
  useEffect(() => {
    setLocalQuestion(question);
    setLocalOptions(options.length >= 4 ? options : [...options, ...Array(4 - options.length).fill('')]);
    setLocalCorrectIndex(correctIndex);
    setLocalExplanation(explanation || '');
  }, [question, JSON.stringify(options), correctIndex, explanation]);

  const handleBlur = () => {
    const filteredOptions = localOptions.map((o) => o.trim()).filter(Boolean);
    if (filteredOptions.length < 2) return; // Need at least 2 options

    const updates: any = {};
    if (localQuestion.trim() !== question) updates.question = localQuestion.trim();
    if (JSON.stringify(filteredOptions) !== JSON.stringify(options)) updates.options = filteredOptions;
    if (localCorrectIndex !== correctIndex) updates.correctIndex = localCorrectIndex;
    if (localExplanation.trim() !== (explanation || '')) updates.explanation = localExplanation.trim();

    if (Object.keys(updates).length > 0) {
      onUpdate(updates);
    }
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...localOptions];
    newOptions[index] = value;
    setLocalOptions(newOptions);
  };

  const handleCorrectSelect = (index: number) => {
    setLocalCorrectIndex(index);
    // Immediately save correct index change
    onUpdate({ correctIndex: index });
  };

  return (
    <div className="p-4 rounded-xl border border-theme-stroke bg-theme-surface space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isFromTemplate && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-blue-500/20 text-blue-400 border-blue-500/30 whitespace-nowrap">
              from template
            </span>
          )}
          {sponsorName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-purple-500/20 text-purple-400 border-purple-500/30 truncate">
              {sponsorName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onMoveUp && !isFirst && (
            <button
              type="button"
              onClick={onMoveUp}
              className="p-1 text-theme-text-faint hover:text-theme-text-muted transition-colors"
            >
              <ChevronUp size={14} />
            </button>
          )}
          {onMoveDown && !isLast && (
            <button
              type="button"
              onClick={onMoveDown}
              className="p-1 text-theme-text-faint hover:text-theme-text-muted transition-colors"
            >
              <ChevronDown size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="p-1 text-theme-text-faint hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Question */}
      <IconInput
        icon={BookOpen}
        value={localQuestion}
        onChange={(e) => setLocalQuestion(e.target.value)}
        onBlur={handleBlur}
        placeholder="Question text"
      />

      {/* Options with correct answer selector */}
      <div className="space-y-2">
        {localOptions.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleCorrectSelect(idx)}
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                localCorrectIndex === idx
                  ? 'border-[#39d98a] bg-[#39d98a]/20'
                  : 'border-theme-stroke hover:border-theme-text-muted'
              }`}
              title={localCorrectIndex === idx ? 'Correct answer' : 'Mark as correct'}
            >
              {localCorrectIndex === idx && <Check size={12} className="text-[#39d98a]" />}
            </button>
            <div className="flex-1">
              <IconInput
                value={opt}
                onChange={(e) => handleOptionChange(idx, e.target.value)}
                onBlur={handleBlur}
                placeholder={`Option ${String.fromCharCode(65 + idx)}`}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-theme-text-faint">Click the circle to mark the correct answer</p>
      </div>

      {/* Explanation */}
      <IconInput
        multiline
        value={localExplanation}
        onChange={(e) => setLocalExplanation(e.target.value)}
        onBlur={handleBlur}
        placeholder="Explanation shown after answering (optional)"
      />
    </div>
  );
}
