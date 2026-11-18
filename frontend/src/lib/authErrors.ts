/** Map raw server auth error strings to i18n keys (namespace `auth`). */
export function authErrorKey(message: string | null | undefined, context: 'verify' | 'send' = 'verify'): string {
  const m = (message || '').toLowerCase();
  if (/too many|rate|try again in|slow down/.test(m)) return 'errors.tooManyAttempts';
  if (/expire/.test(m)) return 'errors.codeExpired';
  if (context === 'verify' && /invalid|incorrect|wrong|not found|no matching/.test(m)) return 'errors.invalidCode';
  if (/network|failed to fetch|load failed/.test(m)) return 'errors.network';
  return context === 'verify' ? 'errors.verifyFailed' : 'errors.sendFailed';
}
