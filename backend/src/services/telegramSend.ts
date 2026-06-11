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

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  // suppli-58533: optional Telegram parse_mode ('HTML' | 'Markdown'). Default
  // stays plain text so existing callers are unaffected; only the per-type
  // reminder copy (which embeds an inline <a> "DM them to me" link) opts in.
  parseMode?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }
  const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: withBennySignature(text),
        disable_web_page_preview: true,
        ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
      }),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.text();
        detail = body.slice(0, 200);
      } catch {
        // ignore — surface just the status
      }
      return {
        ok: false,
        reason: `Telegram API returned ${resp.status}${detail ? `: ${detail}` : ''}`,
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
