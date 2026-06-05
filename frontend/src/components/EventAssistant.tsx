import React, { useState } from 'react';
import { Sparkles, Send, Loader2, CheckCircle2 } from 'lucide-react';
import { usePizza } from '../contexts/PizzaContext';
import { IconInput } from './IconInput';
import { Checkbox } from './Checkbox';
import {
  eventAssistant,
  updatePartyApi,
  type AssistantProposedChange,
  type AssistantHistoryTurn,
} from '../lib/api';
import type { Party } from '../types';

/**
 * arancini-58492: Natural-language Event Assistant.
 *
 * A host types a plain-English instruction; gpt-4o (server-side) proposes a
 * structured diff of editable fields. The host reviews a per-change toggle list
 * (default ON) and applies the accepted subset through the existing trusted
 * PATCH path (`updatePartyApi`). The LLM never writes to the DB.
 */

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export const EventAssistant: React.FC = () => {
  const { party, mergeParty } = usePizza();
  const [instruction, setInstruction] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposed, setProposed] = useState<AssistantProposedChange[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  if (!party) return null;

  const handleSend = async () => {
    const text = instruction.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setApplied(false);
    setProposed([]);
    setAccepted({});

    const history: AssistantHistoryTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInstruction('');

    try {
      const res = await eventAssistant(party.id, text, history);
      const assistantText = res.clarifyingQuestion
        ? `${res.assistantMessage}\n\n${res.clarifyingQuestion}`
        : res.assistantMessage;
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }]);
      setProposed(res.proposedChanges || []);
      // Default every proposed change to ON.
      const initial: Record<string, boolean> = {};
      for (const c of res.proposedChanges || []) initial[c.key] = true;
      setAccepted(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const toApply = proposed.filter((c) => accepted[c.key]);
    if (toApply.length === 0 || applying) return;

    setApplying(true);
    setError(null);
    setApplied(false);

    // Build a camelCase patch for the trusted PATCH path. updatePartyApi throws
    // on failure (e.g. custom_url uniqueness), so we surface the message inline.
    const camelPatch: Record<string, unknown> = {};
    for (const c of toApply) camelPatch[snakeToCamel(c.key)] = c.value;

    try {
      await updatePartyApi(party.id, camelPatch as any);
      // Merge into context in place — no refetch (avoids the page-reload feel).
      mergeParty(camelPatch as Partial<Party>);
      setApplied(true);
      setProposed([]);
      setAccepted({});
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Applied ${toApply.length} change${toApply.length === 1 ? '' : 's'}.`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply changes.');
    } finally {
      setApplying(false);
    }
  };

  const selectedCount = proposed.filter((c) => accepted[c.key]).length;

  return (
    <div className="mb-6 rounded-xl border border-theme-stroke bg-theme-surface p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={18} className="text-[#ff393a]" />
        <h3 className="font-medium text-theme-text text-sm">Event Assistant</h3>
        <span className="text-xs text-theme-text-muted">— describe a change in plain English</span>
      </div>

      {messages.length > 0 && (
        <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-3 py-2 whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-theme-stroke/40 text-theme-text ml-8'
                  : 'bg-theme-stroke/20 text-theme-text-secondary mr-8'
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <IconInput
            icon={Sparkles}
            multiline
            rows={2}
            placeholder='e.g. "Move the event to next Saturday at 6pm and add gluten-free as a dietary option"'
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={loading}
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={loading || !instruction.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          <span className="hidden sm:inline">Ask</span>
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-[#ff393a]">{error}</p>}

      {applied && (
        <div className="mt-3 flex items-center gap-2 text-sm text-green-500">
          <CheckCircle2 size={16} />
          Changes applied.
        </div>
      )}

      {proposed.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-theme-text-muted mb-2">
            Review the proposed changes and toggle the ones you want to apply:
          </p>
          <div className="space-y-2">
            {proposed.map((c) => (
              <div
                key={c.key}
                className="rounded-lg border border-theme-stroke px-3 py-2"
                title={c.reason || undefined}
              >
                <Checkbox
                  checked={accepted[c.key] ?? true}
                  onChange={() => setAccepted((prev) => ({ ...prev, [c.key]: !(prev[c.key] ?? true) }))}
                  label={c.label}
                  labelClassName="text-sm font-medium text-theme-text"
                />
                <div className="mt-1 ml-6 text-xs text-theme-text-secondary flex flex-wrap items-center gap-1">
                  <span className="text-theme-text-muted line-through">{c.currentDisplay}</span>
                  <span className="text-theme-text-muted">→</span>
                  <span className="text-theme-text">{c.proposedDisplay}</span>
                </div>
                {c.reason && <p className="mt-1 ml-6 text-xs text-theme-text-muted">{c.reason}</p>}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff393a] text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {applying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Apply selected ({selectedCount})
          </button>
        </div>
      )}
    </div>
  );
};
