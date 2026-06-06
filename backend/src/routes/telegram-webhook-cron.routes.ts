// napoletana-58495: self-healing cron that re-registers the Telegram bot webhook
// if it's been cleared externally.
//
// Background: the @MoltoBeneBot webhook (https://api.rsv.pizza/api/telegram/webhook)
// keeps getting cleared by something polling getUpdates on the shared bot token.
// Telegram allows only ONE consumer per token — calling getUpdates silently
// deletes any registered webhook, which kills host /start linking + group-id
// collection with no error surfaced anywhere.
//
// This cron is a BACKSTOP, not a root-cause fix. It checks the current webhook
// registration every 15 minutes and re-registers it if it has drifted from the
// expected url. If another process is actively polling getUpdates, the webhook
// will keep getting cleared and this cron will only restore it intermittently
// (flapping). The real fix is to find/stop the other getUpdates consumer or move
// it onto a separate bot token.
//
// Mounted at /api/cron (see index.ts). Auth: same `Authorization: Bearer
// ${CRON_SECRET}` gate as the other crons (send-surveys, event-reminders).
//
// GET and POST are both accepted so this can be triggered the same way as the
// sibling crons regardless of how the Vercel cron / a manual smoke-test calls it.

import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';

const router = Router();

// The canonical inbound webhook url. Must match the route mounted at
// /api/telegram/webhook in index.ts. Public API host is api.rsv.pizza.
const EXPECTED_WEBHOOK_URL = 'https://api.rsv.pizza/api/telegram/webhook';

interface WebhookInfo {
  url?: string;
}

/**
 * Constant-time CRON_SECRET Bearer check, matching reminder.routes.ts.
 * Returns true when the request carries the correct secret.
 */
function isCronAuthed(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${cronSecret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Fetch the bot's current webhook registration. Throws on network/API error. */
async function getWebhookInfo(botToken: string): Promise<WebhookInfo> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const json: any = await resp.json();
  if (!json?.ok) {
    throw new Error(`getWebhookInfo failed: ${JSON.stringify(json)}`);
  }
  return json.result || {};
}

/** (Re-)register the webhook at the expected url. Throws on network/API error. */
async function setWebhook(botToken: string, secretToken: string): Promise<void> {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: EXPECTED_WEBHOOK_URL,
      secret_token: secretToken,
      // Restore the same update types the webhook handler consumes. We do NOT
      // pass drop_pending_updates — a heal should not discard real updates that
      // queued up while the webhook was missing.
      allowed_updates: ['message', 'my_chat_member'],
    }),
  });
  const json: any = await resp.json();
  if (!json?.ok) {
    throw new Error(`setWebhook failed: ${JSON.stringify(json)}`);
  }
}

async function handleEnsureWebhook(req: Request, res: Response): Promise<void> {
  if (!isCronAuthed(req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken || !webhookSecret) {
    console.warn(
      '[ensure-telegram-webhook] TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET not configured — skipping',
    );
    res.status(200).json({ ok: true, skipped: 'missing config' });
    return;
  }

  try {
    const info = await getWebhookInfo(botToken);
    const currentUrl = info.url || '';

    if (currentUrl === EXPECTED_WEBHOOK_URL) {
      res.status(200).json({ ok: true, action: 'ok' });
      return;
    }

    // Webhook drifted (cleared, or pointing somewhere unexpected) — re-register.
    await setWebhook(botToken, webhookSecret);
    console.warn(
      `[ensure-telegram-webhook] healed webhook: previousUrl=${JSON.stringify(
        currentUrl,
      )} -> ${EXPECTED_WEBHOOK_URL}`,
    );
    res.status(200).json({ ok: true, action: 'healed', previousUrl: currentUrl });
  } catch (err: any) {
    // Never throw — a non-200 makes Vercel cron retry-storm. Log and move on;
    // the next 15-minute tick will try again.
    console.error('[ensure-telegram-webhook] error:', err?.message || err);
    res.status(200).json({ ok: true, action: 'error', error: err?.message || String(err) });
  }
}

// Accept both GET (Vercel cron default) and POST (manual smoke-tests / parity
// with the send-surveys cron).
router.get('/ensure-telegram-webhook', handleEnsureWebhook);
router.post('/ensure-telegram-webhook', handleEnsureWebhook);

export default router;
