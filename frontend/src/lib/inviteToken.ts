/**
 * invite-verify: host invite emails link to the event with the invitee's guest capability
 * token as `?t=`. The RSVP form sends it back (`guestToken`) so the backend lets this
 * browser complete that invite without a login.
 *
 * On landing we move the token out of the address bar into sessionStorage (this tab only),
 * so it isn't left in the visible URL, copied into shared links, or kept in history.
 * It is never put in any third-party URL.
 */
const KEY = 'rsvpInviteToken';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Read `?t=` from the current URL (if any), stash it, and strip it from the address bar. */
export function captureInviteToken(): void {
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('t');
    if (!t) return;
    if (TOKEN_RE.test(t)) {
      try { sessionStorage.setItem(KEY, t); } catch { /* storage blocked: getInviteToken falls back to nothing */ }
    }
    url.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  } catch {
    // Never let URL handling break the page.
  }
}

/** The invite token captured in this tab, if any. */
export function getInviteToken(): string | null {
  try {
    const t = sessionStorage.getItem(KEY);
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}
