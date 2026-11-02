/**
 * suppli-58533: shared Telegram send helper for the Molto Benny bot.
 *
 * MOVED verbatim from admin-payout.routes.ts (where it was an inline
 * `sendTelegramMessage`) so the new host-inbound handler can reuse the exact
 * same send path — including the `withBennySignature` sign-off and the
 * `disable_web_page_preview` flag. Behavior is unchanged; admin-payout.routes.ts
 * now imports it from here.
 *
 * Uses `TELEGRAM_BOT_TOKEN` (the same token moltobene owns). Never throws —
 * returns a discriminated result so callers can surface per-channel success/
 * failure exactly as before.
 */
import { withBennySignature } from '../lib/bennySignature.js';
import { formatForTelegram, postTelegramMessage, toTelegramHtml, isParseEntitiesError } from '../lib/telegramFormat.js';

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  // Telegram parse mode: 'Auto' (default; **bold** etc. -> HTML), 'HTML',
  // 'Markdown' or 'None'. A parse-entities 400 is retried once as plain text.
  parseMode?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  try {
    const { status, json } = await postTelegramMessage(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, disable_web_page_preview: true },
      formatForTelegram(text, parseMode),
    );
    if (!json?.ok) {
      const detail = typeof json?.description === 'string' ? json.description.slice(0, 200) : '';
      return {
        ok: false,
        reason: `Telegram API returned ${json?.error_code ?? status}${detail ? `: ${detail}` : ''}`,
      };
    }
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      reason: `Telegram fetch failed: ${err?.message || String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Service-proxy senders (/api/service/telegram/*). Unlike sendTelegramMessage
// these surface Telegram's structured error (error_code / description /
// retry_after) so the caller can classify the outcome, and they use a timeout.
// Send-only: this module never touches updates or webhooks.
// ---------------------------------------------------------------------------

export type TelegramApiResult =
  | { ok: true; messageId?: number }
  | {
      ok: false;
      /** Env token missing: a config problem, nothing was sent. */
      notConfigured?: boolean;
      errorCode?: number;
      description?: string;
      retryAfter?: number;
      /** Timeout / network failure / unparseable body: delivery is unknown. */
      network?: boolean;
    };

const SERVICE_SEND_TIMEOUT_MS = 10_000;

async function callBotApi(method: string, payload: Record<string, unknown>): Promise<TelegramApiResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, notConfigured: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVICE_SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      return { ok: false, errorCode: resp.status, network: resp.status >= 500 };
    }
    if (body?.ok) return { ok: true, messageId: body.result?.message_id };
    return {
      ok: false,
      errorCode: body?.error_code ?? resp.status,
      description: typeof body?.description === 'string' ? body.description : undefined,
      retryAfter: body?.parameters?.retry_after,
    };
  } catch {
    return { ok: false, network: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Private message (plain unless `format: 'auto'`) with optional URL buttons; signed like every Benny message. */
export async function sendServiceDm(
  chatId: string,
  text: string,
  buttons?: { text: string; url: string }[][],
  opts: { format?: 'auto' } = {},
): Promise<TelegramApiResult> {
  const reply_markup = buttons && buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {};
  const base = { chat_id: chatId, disable_web_page_preview: true, ...reply_markup };
  if (opts.format !== 'auto') {
    return callBotApi('sendMessage', { ...base, text: withBennySignature(text) });
  }
  const html = await callBotApi('sendMessage', {
    ...base,
    text: withBennySignature(toTelegramHtml(text)),
    parse_mode: 'HTML',
  });
  if (!html.ok && isParseEntitiesError({ error_code: html.errorCode, description: html.description })) {
    return callBotApi('sendMessage', { ...base, text: withBennySignature(text) });
  }
  return html;
}

/** `typing` chat action: succeeds only if the user has started the bot. */
export function sendServiceTyping(chatId: string): Promise<TelegramApiResult> {
  return callBotApi('sendChatAction', { chat_id: chatId, action: 'typing' });
}
