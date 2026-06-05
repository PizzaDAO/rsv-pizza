/**
 * montanara-83726: Molto Benny's sign-off.
 *
 * Every Telegram message the Molto Benny bot sends — /underboss broadcasts,
 * /payments payout + team notifications, host announcements, and the bot's own
 * command replies — ends with this signature so Benny always signs off with his
 * eyes-on-the-pizza mark.
 *
 * Idempotent: text that already ends with the signature is returned unchanged,
 * so callers composing pre-signed text never double up.
 */
export const BENNY_SIGNATURE = '👁️🍕👁️';

export function withBennySignature(text: string): string {
  const base = typeof text === 'string' ? text : '';
  if (base.trimEnd().endsWith(BENNY_SIGNATURE)) return base;
  return `${base}\n\n${BENNY_SIGNATURE}`;
}
