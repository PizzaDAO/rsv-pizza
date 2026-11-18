/**
 * Logged-out "create event" drafts. The form is persisted to localStorage (not sessionStorage) so
 * it survives the email code / magic link opening in another tab. Drafts expire after 24h and are
 * cleared on a successful create.
 */
const KEY = 'pendingEventDraft';
/** Series create flows keep their own draft per series slug, in the same shape. */
export const SERIES_DRAFT_PREFIX = 'pendingSeriesCreate:';
export const seriesDraftKey = (slug: string): string => `${SERIES_DRAFT_PREFIX}${slug}`;
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredDraft {
  savedAt: number;
  ownerEmail?: string;
  data: Record<string, unknown>;
}

export function saveEventDraft(data: Record<string, unknown>, now = Date.now(), key: string = KEY): void {
  try {
    const stored: StoredDraft = { savedAt: now, data };
    localStorage.setItem(key, JSON.stringify(stored));
  } catch { /* storage blocked: the draft just won't survive the auth round trip */ }
}

export function loadEventDraft(now = Date.now(), key: string = KEY): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.data || typeof parsed.data !== 'object') {
      localStorage.removeItem(key);
      return null;
    }
    if (now - parsed.savedAt > DRAFT_TTL_MS || now < parsed.savedAt - 60_000) {
      localStorage.removeItem(key);
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

export function clearEventDraft(key: string = KEY): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function stampKey(key: string, owner: string): void {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  const parsed = JSON.parse(raw) as StoredDraft;
  parsed.ownerEmail = owner;
  localStorage.setItem(key, JSON.stringify(parsed));
}

/** Bind the draft(s) to the account that just signed in (so another user on this browser never sees them). */
export function stampEventDraftOwner(email: string | null | undefined): void {
  if (!email) return;
  const owner = email.trim().toLowerCase();
  try {
    const keys = [KEY];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SERIES_DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      try { stampKey(k, owner); } catch { /* ignore a corrupt entry */ }
    }
  } catch { /* ignore */ }
}

/** The draft, but only if it is anonymous or belongs to `email`; a draft owned by someone else is cleared. */
export function loadEventDraftFor(email: string | null | undefined, now = Date.now(), key: string = KEY): Record<string, unknown> | null {
  const data = loadEventDraft(now, key);
  if (!data) return null;
  try {
    const owner = (JSON.parse(localStorage.getItem(key) || '{}') as StoredDraft).ownerEmail;
    if (owner && owner !== (email || '').trim().toLowerCase()) {
      clearEventDraft(key);
      return null;
    }
  } catch { /* ignore */ }
  return data;
}
