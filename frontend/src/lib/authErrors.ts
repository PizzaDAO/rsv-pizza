/** Map raw server auth errors to i18n keys (namespace `auth`). Prefers the backend error code. */
export function authErrorKey(
  message: string | null | undefined,
  context: 'verify' | 'send' = 'verify',
  code?: string | null,
): string {
  if (code === 'CODE_SEND_LIMIT' || code === 'VERIFY_RATE_LIMITED') return 'errors.tooManyAttempts';
  if (code === 'TOKEN_EXPIRED') return 'errors.codeExpired';
  const m = (message || '').toLowerCase();
  if (/invalid email/.test(m)) return 'errors.invalidEmail';
  if (/too many|\brate[- ]?limit|try again in|slow down/.test(m)) return 'errors.tooManyAttempts';
  if (/expire/.test(m)) return 'errors.codeExpired';
  if (context === 'verify' && /invalid|incorrect|wrong|not found|no matching/.test(m)) return 'errors.invalidCode';
  if (/network|failed to fetch|load failed/.test(m)) return 'errors.network';
  return context === 'verify' ? 'errors.verifyFailed' : 'errors.sendFailed';
}
