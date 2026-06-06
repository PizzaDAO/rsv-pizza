import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ChevronUp, ChevronDown, Plus, X, Save } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import {
  AdminSurveyQuestion,
  AdminSurveyQuestionsResponse,
  AdminSurveyQuestionInput,
  listAdminSurveyQuestions,
  createAdminSurveyQuestion,
  updateAdminSurveyQuestion,
  reorderAdminSurveyQuestions,
  updateAdminSurveyQuestionSet,
} from '../../lib/api';

/**
 * pugliese-58297: admin CRUD for the post-event guest survey question set.
 *
 * Single rendered tab on /underboss (gated to admin-only in UnderbossDashboard).
 * Lists every question, supports inline reorder via up/down arrows, active
 * toggle, and an expandable edit form for each row. Adds a footer panel for
 * the version bump.
 *
 * Hard delete is intentionally not supported in the UI — admins flip `active`
 * to hide a question, or run SQL when truly removing one. See plan.
 */

type DraftQuestion = {
  id: string;
  type: 'rating' | 'yesno' | 'multiple' | 'text';
  text: string;
  scale: number | null;
  multi: boolean;
  allowOther: boolean;
  options: string[];
  active: boolean;
};

const TYPE_LABELS: Record<DraftQuestion['type'], string> = {
  rating: 'Rating',
  yesno: 'Yes / No',
  multiple: 'Multiple choice',
  text: 'Free text',
};

function questionToDraft(q: AdminSurveyQuestion): DraftQuestion {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    scale: q.scale ?? null,
    multi: !!q.multi,
    allowOther: !!q.allowOther,
    options: Array.isArray(q.options) ? [...q.options] : [],
    active: q.active,
  };
}

export function SurveyQuestionsTab() {
  // ---- Hooks (all above any early return — feedback_hooks_above_early_returns)
  const [data, setData] = useState<AdminSurveyQuestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftQuestion>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});

  // "Add question" form
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<DraftQuestion>({
    id: '',
    type: 'yesno',
    text: '',
    scale: null,
    multi: false,
    allowOther: false,
    options: [],
    active: true,
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Version editor
  const [versionDraft, setVersionDraft] = useState<number | null>(null);
  const [versionSaving, setVersionSaving] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminSurveyQuestions('default');
      setData(res);
      setVersionDraft(res.version);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load survey questions';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orderedQuestions = useMemo(
    () => (data?.questions ? [...data.questions].sort((a, b) => a.position - b.position) : []),
    [data]
  );

  const handleExpand = useCallback(
    (q: AdminSurveyQuestion) => {
      setExpandedId((prev) => (prev === q.id ? null : q.id));
      setDrafts((prev) => {
        if (prev[q.id]) return prev;
        return { ...prev, [q.id]: questionToDraft(q) };
      });
      setRowError((prev) => ({ ...prev, [q.id]: null }));
    },
    []
  );

  const updateDraft = useCallback(
    (id: string, patch: Partial<DraftQuestion>) => {
      setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    },
    []
  );

  const handleTypeChange = useCallback(
    (id: string, nextType: DraftQuestion['type']) => {
      const current = drafts[id];
      if (!current) return;
      if (current.type === 'multiple' && nextType !== 'multiple' && current.options.length > 0) {
        const confirmed = window.confirm(
          'Changing the type away from multiple-choice will discard the option list. Continue?'
        );
        if (!confirmed) return;
      }
      const patch: Partial<DraftQuestion> = { type: nextType };
      if (nextType !== 'rating') patch.scale = null;
      if (nextType !== 'multiple') {
        patch.options = [];
        patch.multi = false;
        patch.allowOther = false;
      } else if (current.scale === null) {
        // leave as is
      }
      if (nextType === 'rating' && current.scale === null) {
        patch.scale = 5;
      }
      updateDraft(id, patch);
    },
    [drafts, updateDraft]
  );

  const buildPayload = (d: DraftQuestion): Partial<AdminSurveyQuestionInput> => {
    const payload: Partial<AdminSurveyQuestionInput> = {
      type: d.type,
      text: d.text,
      active: d.active,
    };
    if (d.type === 'rating') {
      payload.scale = d.scale ?? 5;
    } else if (d.type === 'multiple') {
      payload.options = d.options.filter((o) => o.trim().length > 0);
      payload.multi = d.multi;
      payload.allowOther = d.allowOther;
    }
    return payload;
  };

  const handleSaveRow = useCallback(
    async (id: string) => {
      const d = drafts[id];
      if (!d) return;
      setSaving((prev) => ({ ...prev, [id]: true }));
      setRowError((prev) => ({ ...prev, [id]: null }));
      try {
        await updateAdminSurveyQuestion(id, buildPayload(d), 'default');
        await load();
        setExpandedId(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        setRowError((prev) => ({ ...prev, [id]: message }));
      } finally {
        setSaving((prev) => ({ ...prev, [id]: false }));
      }
    },
    [drafts, load]
  );

  const handleToggleActive = useCallback(
    async (q: AdminSurveyQuestion) => {
      setSaving((prev) => ({ ...prev, [q.id]: true }));
      try {
        await updateAdminSurveyQuestion(q.id, { active: !q.active }, 'default');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Toggle failed';
        setRowError((prev) => ({ ...prev, [q.id]: message }));
      } finally {
        setSaving((prev) => ({ ...prev, [q.id]: false }));
      }
    },
    [load]
  );

  const handleMove = useCallback(
    async (id: string, direction: -1 | 1) => {
      if (!data) return;
      const ids = orderedQuestions.map((q) => q.id);
      const idx = ids.indexOf(id);
      if (idx < 0) return;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= ids.length) return;
      const next = [...ids];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      try {
        await reorderAdminSurveyQuestions(next, 'default');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Reorder failed';
        setError(message);
      }
    },
    [data, orderedQuestions, load]
  );

  const handleAddOption = useCallback(
    (id: string) => {
      const current = drafts[id];
      if (!current) return;
      updateDraft(id, { options: [...current.options, ''] });
    },
    [drafts, updateDraft]
  );

  const handleRemoveOption = useCallback(
    (id: string, optIdx: number) => {
      const current = drafts[id];
      if (!current) return;
      updateDraft(id, { options: current.options.filter((_, i) => i !== optIdx) });
    },
    [drafts, updateDraft]
  );

  const handleOptionChange = useCallback(
    (id: string, optIdx: number, value: string) => {
      const current = drafts[id];
      if (!current) return;
      const next = [...current.options];
      next[optIdx] = value;
      updateDraft(id, { options: next });
    },
    [drafts, updateDraft]
  );

  const handleCreate = useCallback(async () => {
    setAddSaving(true);
    setAddError(null);
    try {
      const payload: AdminSurveyQuestionInput = {
        id: addDraft.id.trim(),
        type: addDraft.type,
        text: addDraft.text,
        active: addDraft.active,
        questionSet: 'default',
      };
      if (addDraft.type === 'rating') payload.scale = addDraft.scale ?? 5;
      if (addDraft.type === 'multiple') {
        payload.options = addDraft.options.filter((o) => o.trim().length > 0);
        payload.multi = addDraft.multi;
        payload.allowOther = addDraft.allowOther;
      }
      await createAdminSurveyQuestion(payload);
      await load();
      setShowAdd(false);
      setAddDraft({
        id: '',
        type: 'yesno',
        text: '',
        scale: null,
        multi: false,
        allowOther: false,
        options: [],
        active: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Create failed';
      setAddError(message);
    } finally {
      setAddSaving(false);
    }
  }, [addDraft, load]);

  const handleSaveVersion = useCallback(async () => {
    if (versionDraft === null || versionDraft === data?.version) return;
    setVersionSaving(true);
    setVersionError(null);
    try {
      await updateAdminSurveyQuestionSet('default', { version: versionDraft });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setVersionError(message);
    } finally {
      setVersionSaving(false);
    }
  }, [versionDraft, data?.version, load]);

  // ---- Render (all hooks declared above)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={28} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-red-400 text-sm py-6">
        {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-theme-text-muted border-b border-theme-stroke">
            <tr>
              <th className="py-2 pr-3 w-16">#</th>
              <th className="py-2 pr-3">id / text</th>
              <th className="py-2 pr-3">type</th>
              <th className="py-2 pr-3">options</th>
              <th className="py-2 pr-3 w-24">active</th>
              <th className="py-2 pr-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {orderedQuestions.map((q, idx) => {
              const expanded = expandedId === q.id;
              const draft = drafts[q.id];
              const rowErr = rowError[q.id];
              const isSaving = saving[q.id];
              return (
                <FragmentRow
                  key={q.id}
                  q={q}
                  idx={idx}
                  total={orderedQuestions.length}
                  expanded={expanded}
                  draft={draft}
                  rowError={rowErr ?? null}
                  isSaving={!!isSaving}
                  onExpand={() => handleExpand(q)}
                  onMoveUp={() => handleMove(q.id, -1)}
                  onMoveDown={() => handleMove(q.id, 1)}
                  onToggleActive={() => handleToggleActive(q)}
                  onSave={() => handleSaveRow(q.id)}
                  onCancel={() => {
                    setExpandedId(null);
                    setDrafts((prev) => {
                      const next = { ...prev };
                      delete next[q.id];
                      return next;
                    });
                  }}
                  onTextChange={(value) => updateDraft(q.id, { text: value })}
                  onTypeChange={(value) => handleTypeChange(q.id, value)}
                  onScaleChange={(value) => updateDraft(q.id, { scale: value })}
                  onMultiChange={(value) => updateDraft(q.id, { multi: value })}
                  onAllowOtherChange={(value) => updateDraft(q.id, { allowOther: value })}
                  onActiveChange={(value) => updateDraft(q.id, { active: value })}
                  onAddOption={() => handleAddOption(q.id)}
                  onRemoveOption={(optIdx) => handleRemoveOption(q.id, optIdx)}
                  onOptionChange={(optIdx, value) => handleOptionChange(q.id, optIdx, value)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add question */}
      <div className="border border-theme-stroke rounded-xl p-4">
        {showAdd ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-theme-text">New question</h3>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setAddError(null);
                }}
                className="text-theme-text-muted hover:text-theme-text-secondary"
                aria-label="Cancel"
              >
                <X size={18} />
              </button>
            </div>
            <IconInput
              placeholder="id (lowercase snake_case, e.g. food_quality)"
              value={addDraft.id}
              onChange={(e) => setAddDraft({ ...addDraft, id: e.target.value })}
              className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
            <div className="flex gap-2">
              <select
                value={addDraft.type}
                onChange={(e) => {
                  const nextType = e.target.value as DraftQuestion['type'];
                  const patch: Partial<DraftQuestion> = { type: nextType };
                  if (nextType !== 'rating') patch.scale = null;
                  if (nextType !== 'multiple') {
                    patch.options = [];
                    patch.multi = false;
                    patch.allowOther = false;
                  }
                  if (nextType === 'rating') patch.scale = addDraft.scale ?? 5;
                  setAddDraft({ ...addDraft, ...patch });
                }}
                className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none"
              >
                {(Object.keys(TYPE_LABELS) as DraftQuestion['type'][]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              {addDraft.type === 'rating' && (
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={addDraft.scale ?? 5}
                  onChange={(e) => setAddDraft({ ...addDraft, scale: Number(e.target.value) })}
                  className="w-24 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
                />
              )}
            </div>
            <IconInput
              multiline
              rows={2}
              placeholder="Question prompt"
              value={addDraft.text}
              onChange={(e) => setAddDraft({ ...addDraft, text: e.target.value })}
              className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
            {addDraft.type === 'multiple' && (
              <OptionEditor
                options={addDraft.options}
                onAdd={() => setAddDraft({ ...addDraft, options: [...addDraft.options, ''] })}
                onChange={(i, v) => {
                  const next = [...addDraft.options];
                  next[i] = v;
                  setAddDraft({ ...addDraft, options: next });
                }}
                onRemove={(i) => setAddDraft({ ...addDraft, options: addDraft.options.filter((_, j) => j !== i) })}
              />
            )}
            {addDraft.type === 'multiple' && (
              <div className="flex flex-wrap gap-4">
                <Checkbox
                  checked={addDraft.multi}
                  onChange={() => setAddDraft({ ...addDraft, multi: !addDraft.multi })}
                  label="Multi-select"
                />
                <Checkbox
                  checked={addDraft.allowOther}
                  onChange={() => setAddDraft({ ...addDraft, allowOther: !addDraft.allowOther })}
                  label='Allow "Other" free text'
                />
              </div>
            )}
            <Checkbox
              checked={addDraft.active}
              onChange={() => setAddDraft({ ...addDraft, active: !addDraft.active })}
              label="Active"
            />
            {addError && <p className="text-sm text-red-400">{addError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={addSaving || !addDraft.id.trim() || !addDraft.text.trim()}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {addSaving ? 'Saving...' : 'Create question'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 text-theme-text hover:text-theme-text-secondary text-sm font-medium"
          >
            <Plus size={16} /> Add question
          </button>
        )}
      </div>

      {/* Version footer */}
      <div className="border border-theme-stroke rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs text-theme-text-muted">Question set version</p>
          <p className="text-xs text-theme-text-faint mt-0.5">
            Bump this when changes alter how answers should be interpreted; old responses
            are tagged with the version they were collected under.
          </p>
        </div>
        <input
          type="number"
          min={1}
          value={versionDraft ?? data.version}
          onChange={(e) => setVersionDraft(Number(e.target.value))}
          className="w-24 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
        />
        <button
          onClick={handleSaveVersion}
          disabled={versionSaving || versionDraft === null || versionDraft === data.version}
          className="px-3 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
        >
          <Save size={14} /> {versionSaving ? 'Saving...' : 'Save version'}
        </button>
        {versionError && <p className="text-sm text-red-400 basis-full">{versionError}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component — uses a <tr> with an optional <tr> beneath for the edit form
// (the wrapping React.Fragment is needed so the table semantics survive).
// ---------------------------------------------------------------------------

interface RowProps {
  q: AdminSurveyQuestion;
  idx: number;
  total: number;
  expanded: boolean;
  draft: DraftQuestion | undefined;
  rowError: string | null;
  isSaving: boolean;
  onExpand: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleActive: () => void;
  onSave: () => void;
  onCancel: () => void;
  onTextChange: (value: string) => void;
  onTypeChange: (value: DraftQuestion['type']) => void;
  onScaleChange: (value: number) => void;
  onMultiChange: (value: boolean) => void;
  onAllowOtherChange: (value: boolean) => void;
  onActiveChange: (value: boolean) => void;
  onAddOption: () => void;
  onRemoveOption: (idx: number) => void;
  onOptionChange: (idx: number, value: string) => void;
}

function FragmentRow(props: RowProps) {
  const {
    q,
    idx,
    total,
    expanded,
    draft,
    rowError,
    isSaving,
    onExpand,
    onMoveUp,
    onMoveDown,
    onToggleActive,
    onSave,
    onCancel,
    onTextChange,
    onTypeChange,
    onScaleChange,
    onMultiChange,
    onAllowOtherChange,
    onActiveChange,
    onAddOption,
    onRemoveOption,
    onOptionChange,
  } = props;

  const optionCount = Array.isArray(q.options) ? q.options.length : 0;
  const textPreview = q.text.length > 80 ? `${q.text.slice(0, 80)}...` : q.text;

  return (
    <>
      <tr className="border-b border-theme-stroke/60">
        <td className="py-2 pr-3 align-top">
          <div className="flex items-center gap-1">
            <span className="text-theme-text-muted w-6">{q.position}</span>
            <div className="flex flex-col">
              <button
                onClick={onMoveUp}
                disabled={idx === 0}
                className="text-theme-text-muted hover:text-theme-text disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={onMoveDown}
                disabled={idx === total - 1}
                className="text-theme-text-muted hover:text-theme-text disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        </td>
        <td className="py-2 pr-3 align-top">
          <button
            onClick={onExpand}
            className="text-left hover:text-theme-text-secondary"
          >
            <div className="text-theme-text font-mono text-xs">{q.id}</div>
            <div className="text-theme-text-muted text-xs mt-0.5">{textPreview}</div>
          </button>
        </td>
        <td className="py-2 pr-3 align-top">
          <span className="inline-block px-2 py-0.5 rounded-full bg-theme-surface text-theme-text text-xs border border-theme-stroke">
            {TYPE_LABELS[q.type]}
          </span>
        </td>
        <td className="py-2 pr-3 align-top text-theme-text-muted text-xs">
          {q.type === 'multiple' ? `${optionCount} option${optionCount === 1 ? '' : 's'}` : '—'}
        </td>
        <td className="py-2 pr-3 align-top">
          <Checkbox
            checked={q.active}
            onChange={onToggleActive}
            label=""
            disabled={isSaving}
          />
        </td>
        <td className="py-2 pr-3 align-top">
          <button
            onClick={onExpand}
            className="text-xs text-theme-text hover:text-theme-text-secondary underline"
          >
            {expanded ? 'Close' : 'Edit'}
          </button>
        </td>
      </tr>

      {expanded && draft && (
        <tr>
          <td colSpan={6} className="bg-theme-surface/40 px-3 py-4 border-b border-theme-stroke">
            <div className="space-y-3 max-w-2xl">
              <div>
                <p className="text-xs text-theme-text-muted mb-1">id</p>
                <input
                  type="text"
                  value={q.id}
                  readOnly
                  className="w-full bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text-muted font-mono focus:outline-none"
                />
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={draft.type}
                  onChange={(e) => onTypeChange(e.target.value as DraftQuestion['type'])}
                  className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none"
                >
                  {(Object.keys(TYPE_LABELS) as DraftQuestion['type'][]).map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
                {draft.type === 'rating' && (
                  <>
                    <span className="text-xs text-theme-text-muted">scale</span>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={draft.scale ?? 5}
                      onChange={(e) => onScaleChange(Number(e.target.value))}
                      className="w-24 bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none focus:border-theme-stroke-hover"
                    />
                  </>
                )}
              </div>
              <IconInput
                multiline
                rows={3}
                placeholder="Question prompt"
                value={draft.text}
                onChange={(e) => onTextChange(e.target.value)}
                className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
              />
              {draft.type === 'multiple' && (
                <>
                  <OptionEditor
                    options={draft.options}
                    onAdd={onAddOption}
                    onChange={onOptionChange}
                    onRemove={onRemoveOption}
                  />
                  <div className="flex flex-wrap gap-4">
                    <Checkbox
                      checked={draft.multi}
                      onChange={() => onMultiChange(!draft.multi)}
                      label="Multi-select"
                    />
                    <Checkbox
                      checked={draft.allowOther}
                      onChange={() => onAllowOtherChange(!draft.allowOther)}
                      label='Allow "Other" free text'
                    />
                  </div>
                </>
              )}
              <Checkbox
                checked={draft.active}
                onChange={() => onActiveChange(!draft.active)}
                label="Active"
              />
              {rowError && <p className="text-sm text-red-400">{rowError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={onSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={onCancel}
                  className="px-4 py-2 bg-theme-surface border border-theme-stroke hover:border-theme-stroke-hover text-theme-text text-sm font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface OptionEditorProps {
  options: string[];
  onAdd: () => void;
  onChange: (idx: number, value: string) => void;
  onRemove: (idx: number) => void;
}

function OptionEditor({ options, onAdd, onChange, onRemove }: OptionEditorProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-theme-text-muted">Options</p>
      {options.length === 0 && (
        <p className="text-xs text-theme-text-faint">No options yet.</p>
      )}
      {options.map((opt, i) => (
        <div key={i} className="flex gap-2 items-center">
          <IconInput
            placeholder={`Option ${i + 1}`}
            value={opt}
            onChange={(e) => onChange(i, e.target.value)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
          />
          <button
            onClick={() => onRemove(i)}
            className="text-theme-text-muted hover:text-red-400"
            aria-label={`Remove option ${i + 1}`}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <button
        onClick={onAdd}
        className="text-xs text-theme-text hover:text-theme-text-secondary underline flex items-center gap-1"
      >
        <Plus size={12} /> Add option
      </button>
    </div>
  );
}
