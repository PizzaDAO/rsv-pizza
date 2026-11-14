/**
 * Event-assistant log redaction. The assistant's query log (event_assistant_log) must never hold a
 * plaintext event password: the proposed `password` change carries the new value (the frontend
 * needs it to apply the change, so it is only redacted in the LOG copy), and the host's own
 * instruction / earlier chat turns contain the same text. scripts/scrub-assistant-log-passwords.cjs
 * mirrors this logic for already-stored rows; keep the two in sync.
 */

export const REDACTED = '[redacted]';

/** "password is hunter2", "set the password to: 'hunter2'", "password=hunter2" -> keeps the lead-in. */
const PASSWORD_PHRASE = /(\bpass(?:word|code|phrase)\b\s*(?:is|to|as|=|:)\s*)(["'“‘]?)([^\s"'”’]+)(["'”’]?)/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Secret strings carried by `password` entries of a proposedChanges array. */
export function collectPasswordSecrets(proposedChanges: unknown): string[] {
  if (!Array.isArray(proposedChanges)) return [];
  const out: string[] = [];
  for (const c of proposedChanges) {
    if (c && typeof c === 'object' && (c as any).key === 'password') {
      const v = (c as any).value;
      if (typeof v === 'string' && v.length > 0 && v !== REDACTED) out.push(v);
    }
  }
  return out;
}

/** Redact known secrets, then any "password is X"-style phrase. */
export function redactText(text: string, secrets: string[] = []): string {
  let t = text;
  for (const s of secrets) {
    if (s) t = t.replace(new RegExp(escapeRegExp(s), 'g'), REDACTED);
  }
  return t.replace(PASSWORD_PHRASE, (m, lead, q1, val, q2) => (val === REDACTED ? m : `${lead}${q1}${REDACTED}${q2}`));
}

/** Redact the `value` of every password change. */
export function redactProposedChanges<T>(proposedChanges: T): T {
  if (!Array.isArray(proposedChanges)) return proposedChanges;
  return proposedChanges.map((c) =>
    c && typeof c === 'object' && (c as any).key === 'password' && typeof (c as any).value === 'string'
      ? { ...(c as any), value: REDACTED }
      : c,
  ) as unknown as T;
}

export interface AssistantLogFields {
  instruction: string;
  history?: Array<{ role: string; content: string }> | null;
  proposedChanges: unknown;
  clarifyingQuestion?: string | null;
}

/** Returns a copy of the log fields that is safe to persist. */
export function redactAssistantLogFields<T extends AssistantLogFields>(f: T): T {
  const secrets = collectPasswordSecrets(f.proposedChanges);
  return {
    ...f,
    instruction: redactText(f.instruction, secrets),
    history: f.history ? f.history.map((h) => ({ ...h, content: redactText(h.content, secrets) })) : f.history,
    proposedChanges: redactProposedChanges(f.proposedChanges),
    clarifyingQuestion:
      typeof f.clarifyingQuestion === 'string' ? redactText(f.clarifyingQuestion, secrets) : f.clarifyingQuestion,
  };
}
