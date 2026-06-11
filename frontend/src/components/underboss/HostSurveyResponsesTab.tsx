import { useEffect, useMemo, useState } from 'react';
import { Loader2, Download, Send } from 'lucide-react';
import { IconInput } from '../IconInput';
import {
  HostSurveyResponseRow,
  HostSurveyResponsesResponse,
  HostSurveySendScope,
  getHostSurveyResponses,
  exportHostSurveyResponsesCsv,
  sendHostSurvey,
} from '../../lib/api';
import type { SurveyQuestion } from '../../lib/surveyQuestions';

/**
 * panzerotti-58527: "Host Survey Responses" tab on /underboss.
 *
 * City-scoped per-respondent host survey responses (one row per party) with a
 * region filter + text search + a server-rendered CSV export, plus a "Send host
 * survey" control with an audience picker (all / by city / by status) POSTing to
 * /api/underboss/host-survey/send.
 *
 * Clone of SurveyResponsesTab (guest), adapted to the host shape.
 */

const SEND_STATUSES = ['pending', 'approved', 'rejected', 'listed', 'hidden'];

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

export function HostSurveyResponsesTab() {
  // ---- Hooks (all above any early return — feedback_hooks_above_early_returns)
  const [data, setData] = useState<HostSurveyResponsesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Send control state.
  const [sendScope, setSendScope] = useState<HostSurveySendScope>('all');
  const [sendCities, setSendCities] = useState('');
  const [sendStatuses, setSendStatuses] = useState<string[]>(['approved']);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getHostSurveyResponses();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load host survey responses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getHostSurveyResponses();
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load host survey responses');
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
        const haystack = `${r.event.name} ${r.hostName} ${r.email}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [data, regionFilter, search]);

  const handleSend = async () => {
    setSending(true);
    setSendResult(null);
    setSendError(null);
    try {
      const body: { scope: HostSurveySendScope; cityIds?: string[]; statuses?: string[] } = {
        scope: sendScope,
      };
      if (sendScope === 'city') {
        body.cityIds = sendCities
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
      } else if (sendScope === 'status') {
        body.statuses = sendStatuses;
      }
      const res = await sendHostSurvey(body);
      setSendResult(`Sent ${res.sent}, skipped ${res.skipped}, failed ${res.failed}.`);
      // Refresh responses so newly-stamped rows can show up over time.
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportHostSurveyResponsesCsv();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV export failed');
    }
  };

  // ---- Render (all hooks declared above)
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={28} className="animate-spin text-theme-text-muted" />
      </div>
    );
  }

  const colCount = 5 + ratingQuestions.length + 1;

  return (
    <div className="space-y-6">
      {/* Send host survey */}
      <div className="border border-theme-stroke rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-theme-text">Send host survey</h3>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={sendScope}
            onChange={(e) => setSendScope(e.target.value as HostSurveySendScope)}
            className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text focus:outline-none"
          >
            <option value="all">All events in scope</option>
            <option value="city">By city</option>
            <option value="status">By status</option>
          </select>

          {sendScope === 'city' && (
            <div className="flex-1 min-w-[14rem]">
              <IconInput
                placeholder="City names, comma-separated (e.g. Lagos, Manila)"
                value={sendCities}
                onChange={(e) => setSendCities(e.target.value)}
                className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none"
              />
            </div>
          )}

          {sendScope === 'status' && (
            <div className="flex flex-wrap gap-2">
              {SEND_STATUSES.map((s) => {
                const on = sendStatuses.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSendStatuses((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                      )
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      on
                        ? 'bg-[#ff393a] text-white border-[#ff393a]'
                        : 'border-theme-stroke text-theme-text-muted hover:text-theme-text'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={sending}
            className="px-3 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
          </button>
        </div>
        <p className="text-xs text-theme-text-faint">
          Emails the primary host of each matching event. Events with no host email are skipped.
          Already-sent events are re-sent (one response row, no duplicates).
        </p>
        {sendResult && <p className="text-xs text-green-400">{sendResult}</p>}
        {sendError && <p className="text-xs text-red-400">{sendError}</p>}
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      {/* Responses */}
      <div className="space-y-4">
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
              placeholder="Search event, host, or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-theme-surface border border-theme-stroke rounded-lg px-3 py-2 text-sm text-theme-text placeholder:text-theme-text-faint focus:outline-none focus:border-theme-stroke-hover"
            />
          </div>
          <button
            onClick={handleExport}
            disabled={(data?.responses ?? []).length === 0}
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
                  <th className="py-2 pr-3">Host</th>
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
                {filtered.map((r) => (
                  <ResponseRow
                    key={r.id}
                    row={r}
                    questions={questions}
                    ratingQuestions={ratingQuestions}
                    expanded={expandedId === r.id}
                    colCount={colCount}
                    onToggle={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface ResponseRowProps {
  row: HostSurveyResponseRow;
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
    if (!row.submittedAt) return '—';
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
        <td className="py-2 pr-3 align-top text-theme-text">{row.hostName || '—'}</td>
        <td className="py-2 pr-3 align-top text-theme-text-muted text-xs">{row.email || '—'}</td>
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
