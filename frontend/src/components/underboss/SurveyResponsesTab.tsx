import { useEffect, useMemo, useState } from 'react';
import { Loader2, Download } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  AdminSurveyResponseRow,
  AdminSurveyResponsesResponse,
  getAdminSurveyResponses,
} from '../../lib/api';
import type { SurveyQuestion } from '../../lib/surveyQuestions';

/**
 * gnocchi-58507: admin-only "Survey Responses" tab on /underboss.
 *
 * Shows EVERY post-event survey response across all events (one row per
 * respondent) with a summary header (per-rating-question averages), client-side
 * region + text filters, an expandable per-row detail view, and a CSV export of
 * the currently-filtered rows. All data comes from a single
 * GET /api/admin/survey-responses call on mount.
 */

// Format a single answer value for display in the detail view.
function formatAnswer(q: SurveyQuestion, value: unknown): string {
  if (value === undefined || value === null) return '—';
  switch (q.type) {
    case 'yesno':
      return value === true ? 'Yes' : value === false ? 'No' : String(value);
    case 'rating':
      return typeof value === 'number' ? `${value} / ${q.scale ?? 5}` : String(value);
    case 'multiple':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'text':
    default:
      return String(value);
  }
}

// CSV-escape every field: wrap in double quotes + double internal quotes so
// commas / quotes / newlines in free text can't break the columns.
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Stringify an answer value for a CSV cell (arrays joined with "; ",
// booleans as Yes/No, everything else as a plain string).
function answerToCsv(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function SurveyResponsesTab() {
  // ---- Hooks (all above any early return — feedback_hooks_above_early_returns)
  const [data, setData] = useState<AdminSurveyResponsesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getAdminSurveyResponses();
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load survey responses');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const questions = data?.questionSet ?? [];
  const ratingQuestions = useMemo(
    () => questions.filter((q) => q.type === 'rating'),
    [questions]
  );

  // Distinct non-null region slugs present in the data, sorted.
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.responses ?? []) {
      if (r.event.region) set.add(r.event.region);
    }
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.responses ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (regionFilter && r.event.region !== regionFilter) return false;
      if (term) {
        const haystack = `${r.event.name} ${r.guestName} ${r.email ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [data, regionFilter, search]);

  // Summary stats recomputed from the currently-visible (filtered) rows so the
  // header tracks the active region/search filters instead of global totals.
  const summaryStats = useMemo(() => {
    const ratings: Record<string, { average: number | null; count: number }> = {};
    for (const q of ratingQuestions) {
      let sum = 0,
        count = 0;
      for (const r of filtered) {
        const v = r.answers[q.id];
        if (typeof v === 'number') {
          sum += v;
          count += 1;
        }
      }
      ratings[q.id] = { count, average: count > 0 ? Math.round((sum / count) * 100) / 100 : null };
    }
    return { responseCount: filtered.length, ratings };
  }, [filtered, ratingQuestions]);

  const handleExport = () => {
    const header: string[] = [
      'event_name',
      'event_slug',
      'region',
      'guest_name',
      'email',
      'submitted_at',
      'question_set_version',
    ];
    for (const q of questions) {
      header.push(q.id);
      if (q.allowOther) header.push(`${q.id}_other`);
    }

    const lines: string[] = [header.map(csvCell).join(',')];
    for (const r of filtered) {
      const cells: string[] = [
        r.event.name,
        r.event.slug,
        r.event.region ?? '',
        r.guestName,
        r.email ?? '',
        r.submittedAt,
        String(r.questionSetVersion),
      ];
      for (const q of questions) {
        cells.push(answerToCsv(r.answers[q.id]));
        if (q.allowOther) cells.push(answerToCsv(r.answers[`${q.id}_other`]));
      }
      lines.push(cells.map(csvCell).join(','));
    }

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'survey-responses.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---- Render (all hooks declared above)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={28} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }
  if (error) {
    return <div className="text-red-400 text-sm py-6">{error}</div>;
  }
  if (!data) return null;

  // colSpan = base columns (Event, Region, Guest, Email, Submitted) + one per
  // rating question + the trailing View column.
  const colCount = 5 + ratingQuestions.length + 1;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="border border-theme-stroke rounded-xl p-4 space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-theme-text">
            {summaryStats.responseCount} response{summaryStats.responseCount === 1 ? '' : 's'}
            {summaryStats.responseCount !== data.responses.length && (
              <span className="text-theme-text-faint font-normal"> of {data.responses.length}</span>
            )}
          </h3>
          {data.truncated && (
            <span className="text-xs text-theme-text-faint">Showing first 5000 responses.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {ratingQuestions.map((q) => {
            const stat = summaryStats.ratings[q.id];
            if (!stat || stat.average === null) return null;
            return (
              <div key={q.id} className="text-xs text-theme-text-muted">
                <span className="text-theme-text">{q.text}:</span>{' '}
                {stat.average} / {q.scale ?? 5}
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters + export */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none"
        >
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex-1 min-w-[12rem]">
          <IconInput
            placeholder="Search event, guest, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
          />
        </div>
        <button
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="px-3 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-theme-text-muted text-sm py-6">No responses yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-theme-text-muted border-b border-theme-stroke">
              <tr>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Region</th>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Submitted</th>
                {ratingQuestions.map((q) => (
                  <th key={q.id} className="py-2 pr-3" title={q.text}>
                    {q.text.length > 24 ? `${q.text.slice(0, 24)}…` : q.text}
                  </th>
                ))}
                <th className="py-2 pr-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const expanded = expandedId === r.id;
                return (
                  <ResponseRow
                    key={r.id}
                    row={r}
                    questions={questions}
                    ratingQuestions={ratingQuestions}
                    expanded={expanded}
                    colCount={colCount}
                    onToggle={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ResponseRowProps {
  row: AdminSurveyResponseRow;
  questions: SurveyQuestion[];
  ratingQuestions: SurveyQuestion[];
  expanded: boolean;
  colCount: number;
  onToggle: () => void;
}

function ResponseRow({
  row,
  questions,
  ratingQuestions,
  expanded,
  colCount,
  onToggle,
}: ResponseRowProps) {
  const submitted = (() => {
    const d = new Date(row.submittedAt);
    return Number.isNaN(d.getTime()) ? row.submittedAt : d.toLocaleDateString();
  })();

  return (
    <>
      <tr className="border-b border-theme-stroke/60">
        <td className="py-2 pr-3 align-top">
          {row.event.slug ? (
            <a
              href={`/${row.event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-theme-text hover:text-theme-text-secondary underline"
            >
              {row.event.name || row.event.slug}
            </a>
          ) : (
            <span className="text-theme-text">{row.event.name || '—'}</span>
          )}
        </td>
        <td className="py-2 pr-3 align-top text-theme-text-muted text-xs">
          {row.event.region ?? '—'}
        </td>
        <td className="py-2 pr-3 align-top text-theme-text">{row.guestName || '—'}</td>
        <td className="py-2 pr-3 align-top text-theme-text-muted text-xs">{row.email ?? '—'}</td>
        <td className="py-2 pr-3 align-top text-theme-text-muted text-xs">{submitted}</td>
        {ratingQuestions.map((q) => {
          const v = row.answers[q.id];
          return (
            <td key={q.id} className="py-2 pr-3 align-top text-theme-text-muted text-xs">
              {typeof v === 'number' ? `${v}★` : '—'}
            </td>
          );
        })}
        <td className="py-2 pr-3 align-top">
          <button
            onClick={onToggle}
            className="text-xs text-theme-text hover:text-theme-text-secondary underline"
          >
            {expanded ? 'Close' : 'View'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={colCount} className="bg-theme-surface/40 px-3 py-4 border-b border-theme-stroke">
            <div className="space-y-2 max-w-2xl">
              {questions.map((q) => {
                const main = formatAnswer(q, row.answers[q.id]);
                const other = q.allowOther ? row.answers[`${q.id}_other`] : undefined;
                return (
                  <div key={q.id}>
                    <p className="text-xs text-theme-text-muted">{q.text}</p>
                    <p className="text-sm text-theme-text">
                      {main}
                      {typeof other === 'string' && other.trim().length > 0 && (
                        <span className="text-theme-text-muted"> — “{other}”</span>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
