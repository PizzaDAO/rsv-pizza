/**
 * Logged-out "create event" drafts. The form is persisted to localStorage (not sessionStorage) so
 * it survives the email code / magic link opening in another tab. Drafts expire after 24h and are
 * cleared on a successful create.
 */
const KEY = 'pendingEventDraft';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredDraft {
  savedAt: number;
  ownerEmail?: string;
  data: Record<string, unknown>;
}

export function saveEventDraft(data: Record<string, unknown>, now = Date.now()): void {
  try {
    const stored: StoredDraft = { savedAt: now, data };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch { /* storage blocked: the draft just won't survive the auth round trip */ }
}

export function loadEventDraft(now = Date.now()): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.data || typeof parsed.data !== 'object') {
      localStorage.removeItem(KEY);
      return null;
    }
    if (now - parsed.savedAt > DRAFT_TTL_MS || now < parsed.savedAt - 60_000) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function hasEventDraft(now = Date.now()): boolean {
  return loadEventDraft(now) !== null;
}

export function clearEventDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Bind the draft to the account that just signed in (so another user on this browser never sees it). */
export function stampEventDraftOwner(email: string | null | undefined): void {
  if (!email) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredDraft;
    parsed.ownerEmail = email.trim().toLowerCase();
    localStorage.setItem(KEY, JSON.stringify(parsed));
  } catch { /* ignore */ }
}

/** The draft, but only if it is anonymous or belongs to `email`; a draft owned by someone else is cleared. */
export function loadEventDraftFor(email: string | null | undefined, now = Date.now()): Record<string, unknown> | null {
  const data = loadEventDraft(now);
  if (!data) return null;
  try {
    const owner = (JSON.parse(localStorage.getItem(KEY) || '{}') as StoredDraft).ownerEmail;
    if (owner && owner !== (email || '').trim().toLowerCase()) {
      clearEventDraft();
      return null;
    }
  } catch { /* ignore */ }
  return data;
}
