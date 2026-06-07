import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Send, RefreshCw, MessageSquare } from 'lucide-react';
import { Checkbox } from './Checkbox';
import {
  sendSurvey,
  getSurveyResults,
  type SurveyResults,
} from '../lib/api';
import { updateParty } from '../lib/supabase';
import { usePizza } from '../contexts/PizzaContext';

interface SurveyTabProps {
  partyId: string;
  surveyEnabled: boolean;
}

export const SurveyTab: React.FC<SurveyTabProps> = ({ partyId, surveyEnabled: initialEnabled }) => {
  // All hooks declared above any early return (rules-of-hooks).
  const { mergeParty } = usePizza();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [audience, setAudience] = useState<'rsvped' | 'checkedin' | 'approved'>('rsvped');

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getSurveyResults(partyId);
      setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load survey results');
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  const handleToggle = async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    mergeParty({ surveyEnabled: newValue });
    const ok = await updateParty(partyId, { survey_enabled: newValue });
    if (!ok) {
      // Revert on failure
      setEnabled(!newValue);
      mergeParty({ surveyEnabled: !newValue });
    }
  };

  const handleSend = async () => {
    setSending(true);
    setSendResult(null);
    setError(null);
    try {
      const r = await sendSurvey(partyId, audience);
      setSendResult(r);
      await loadResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send survey');
    } finally {
      setSending(false);
    }
  };

  const qById = (id: string) => results?.questionSet.find(q => q.id === id);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-2">
          <MessageSquare className="w-5 h-5 text-[#ff393a]" />
          <h2 className="text-xl font-bold text-theme-text">Post-Event Survey</h2>
        </div>
        <p className="text-sm text-theme-text-muted mb-4">
          Email your guests a short survey after the event. It sends automatically the
          morning after the event, and you can also send it manually any time.
        </p>

        <Checkbox
          checked={enabled}
          onChange={handleToggle}
          label="Survey enabled for this event"
        />

        <div className="mt-5">
          <div className="inline-flex flex-wrap gap-2">
            {([
              ['rsvped', "RSVP'd yes"],
              ['checkedin', 'Checked-in'],
              ['approved', 'Approved only'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setAudience(value)}
                className={
                  audience === value
                    ? 'btn-primary text-sm px-3 py-1.5'
                    : 'text-sm px-3 py-1.5 rounded-lg border border-white/10 text-theme-text-muted hover:text-theme-text'
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-theme-text-muted">
            {audience === 'checkedin'
              ? 'Sends only to guests checked in at the event.'
              : audience === 'approved'
                ? 'Sends only to host-approved guests.'
                : "Sends to everyone who RSVP'd yes (excludes rejected guests)."}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !enabled}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending…' : 'Send survey now'}
          </button>
          <button
            type="button"
            onClick={loadResults}
            disabled={loading}
            className="text-sm text-theme-text-muted hover:text-theme-text inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh results
          </button>
        </div>

        {!enabled && (
          <p className="mt-3 text-xs text-theme-text-muted">
            Enable the survey to send it. Disabling stops new responses from being accepted.
          </p>
        )}

        {sendResult && (
          <p className="mt-3 text-sm text-theme-text">
            Sent {sendResult.sent}{sendResult.failed ? `, ${sendResult.failed} failed` : ''}
            {sendResult.skipped ? `, ${sendResult.skipped} skipped (no email)` : ''}.
          </p>
        )}
      </div>

      {error && (
        <div className="card p-4 border border-[#ff393a]/40">
          <p className="text-sm text-[#ff393a]">{error}</p>
        </div>
      )}

      <div className="card p-6">
        <h3 className="text-lg font-bold text-theme-text mb-4">
          Results{results ? ` (${results.responseCount} response${results.responseCount === 1 ? '' : 's'})` : ''}
        </h3>

        {loading && !results ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[#ff393a]" />
          </div>
        ) : !results || results.responseCount === 0 ? (
          <p className="text-sm text-theme-text-muted">No responses yet.</p>
        ) : (
          <div className="space-y-6">
            {/* Ratings */}
            {Object.entries(results.ratings).map(([id, r]) => (
              <div key={id}>
                <p className="text-sm font-medium text-theme-text">{qById(id)?.text || id}</p>
                <p className="text-sm text-theme-text-muted">
                  {r.average != null ? `Average: ${r.average} / ${qById(id)?.scale ?? 5}` : 'No ratings'} ({r.count})
                </p>
              </div>
            ))}

            {/* Yes/No */}
            {Object.entries(results.yesno).map(([id, yn]) => (
              <div key={id}>
                <p className="text-sm font-medium text-theme-text">{qById(id)?.text || id}</p>
                <p className="text-sm text-theme-text-muted">Yes: {yn.yes} · No: {yn.no}</p>
              </div>
            ))}

            {/* Multiple choice distributions */}
            {Object.entries(results.multiple).map(([id, dist]) => (
              <div key={id}>
                <p className="text-sm font-medium text-theme-text mb-1">{qById(id)?.text || id}</p>
                <ul className="space-y-0.5">
                  {Object.entries(dist).map(([opt, count]) => (
                    <li key={opt} className="text-sm text-theme-text-muted flex justify-between max-w-xs">
                      <span>{opt}</span>
                      <span>{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Free-text comments */}
            {Object.entries(results.comments).map(([id, list]) => (
              <div key={id}>
                <p className="text-sm font-medium text-theme-text mb-1">{qById(id)?.text || id}</p>
                {list.length === 0 ? (
                  <p className="text-sm text-theme-text-muted">No comments.</p>
                ) : (
                  <ul className="space-y-2">
                    {list.map((c, i) => (
                      <li key={i} className="text-sm text-theme-text bg-white/5 rounded-lg px-3 py-2 whitespace-pre-wrap">
                        {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
