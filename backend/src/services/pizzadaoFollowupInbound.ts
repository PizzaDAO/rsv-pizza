/**
 * Forward a Telegram DM that rsv-pizza has no use for to PizzaDAO, in case it is a reply to a
 * follow-up message sent by the same bot (one shared bot; a separate service owns its webhook and
 * forwards DMs to /api/telegram/host-inbound).
 *
 * Off unless PIZZADAO_FOLLOWUP_INBOUND_ENABLED=1 and PIZZADAO_FOLLOWUP_INBOUND_KEY is set. Never
 * throws: any failure, timeout or "not claimed" answer returns null, and the caller carries on with
 * its existing behaviour. Never logs message text or the key. Send-only: this module does not touch
 * Telegram updates or webhooks.
 */

export const DEFAULT_FOLLOWUP_INBOUND_URL = 'https://app.pizzadao.org/api/followups/inbound';
export const FOLLOWUP_INBOUND_TIMEOUT_MS = 5000;

export type FollowupForward = { claimed: true; ack: string } | null;

export function followupInboundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIZZADAO_FOLLOWUP_INBOUND_ENABLED === '1' && !!env.PIZZADAO_FOLLOWUP_INBOUND_KEY?.trim();
}

/** Stable per (chat, text, minute): only identical text resent within a minute collapses. */
export async function fallbackExternalKey(chatId: string, text: string, now = Date.now()): Promise<string> {
  const { createHash } = await import('crypto');
  const h = createHash('sha256').update(text).digest('hex').slice(0, 24);
  return `telegram:${chatId}:${h}:${Math.floor(now / 60000)}`.slice(0, 120);
}

/**
 * Returns { claimed: true, ack } when PizzaDAO saved the message as a reply (ack may be '' = send
 * nothing), or null in every other case. Only private chats (positive chat id) and non-command text.
 */
export async function tryForwardFollowUpReply(
  chatId: string,
  msg: { kind: 'text'; text: string; messageId?: number | string } | { kind: 'photo' },
  opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<FollowupForward> {
  const env = opts.env ?? process.env;
  try {
    if (!followupInboundEnabled(env)) return null;
    if (!/^\d{1,25}$/.test(chatId)) return null; // private chats only (group ids are negative)
    let text = '';
    let externalKey: string;
    if (msg.kind === 'text') {
      text = (msg.text ?? '').trim();
      if (!text || text.startsWith('/')) return null; // never forward commands
      externalKey =
        msg.messageId !== undefined && `${msg.messageId}`.trim() !== ''
          ? `telegram:${chatId}:${`${msg.messageId}`.trim()}`.slice(0, 120)
          : await fallbackExternalKey(chatId, text, opts.now);
    } else {
      externalKey = await fallbackExternalKey(chatId, 'photo', opts.now);
    }
    const url = env.PIZZADAO_FOLLOWUP_INBOUND_URL?.trim() || DEFAULT_FOLLOWUP_INBOUND_URL;
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PIZZADAO_FOLLOWUP_INBOUND_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ senderId: chatId, kind: msg.kind, ...(msg.kind === 'text' ? { text } : {}), externalKey }),
      signal: AbortSignal.timeout(FOLLOWUP_INBOUND_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { claimed?: unknown; ack?: unknown } | null;
    if (j?.claimed !== true) return null;
    return { claimed: true, ack: typeof j.ack === 'string' ? j.ack : '' };
  } catch {
    return null;
  }
}
