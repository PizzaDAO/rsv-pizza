/**
 * invite-verify: POST /api/auth/verify-code binds the code to the email it was sent to
 * (the code-only lookup is legacy and being removed). The email is remembered for this
 * tab when the code is requested, so the code-entry page can send it.
 */
const KEY = 'authCodeEmail';

export function rememberAuthCodeEmail(email: string): void {
  try { sessionStorage.setItem(KEY, email.trim().toLowerCase()); } catch { /* storage blocked: the verify page asks for it */ }
}

export function getAuthCodeEmail(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The ONE place the frontend calls POST /api/auth/verify-code. It always sends the email the
 * code was sent to, so the backend checks the code against that address (the code-only
 * lookup is legacy). A guard test fails if any other file calls the endpoint directly.
 */
export function postVerifyCode(code: string, email: string, extra: { name?: string } = {}): Promise<Response> {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3006';
  return fetch(`${apiUrl}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, email: email.trim().toLowerCase(), ...(extra.name ? { name: extra.name } : {}) }),
  });
}

export function clearAuthCodeEmail(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
