/**
 * tonda-58293: shared sender for a city's Telegram GROUP chat.
 *
 * Looks up the per-city group chat_id in `city_telegram_groups` (keyed by
 * `cityKey = lower(trim(city))`) and sends a message via the Molto Benny bot
 * (TELEGRAM_BOT_TOKEN). The key behavior — missing from the old client-supplied
 * `groupChatId` paths — is that when Telegram reports the group was upgraded to
 * a supergroup (`parameters.migrate_to_chat_id`), we retry with the new id AND
 * persist it back to the table so the mapping never silently drifts again.
 *
 * Mirrors the fetch/retry shape in `telegram.routes.ts` `/broadcast` so all
 * group sends behave consistently.
 *
 * Returns a structured result instead of throwing; callers decide how to
 * surface skips/failures.
 */
import { prisma } from '../config/database.js';
import { getGppRegionByCityKey } from '../helpers/underbossScope.js';
import { withBennySignature } from '../lib/bennySignature.js';
import { refreshCityGroupFromMoltobene } from './moltobeneSync.js';

const BOT_API = 'https://api.telegram.org';

/**
 * tonda-58293 FIX #6: single shared helper for persisting a supergroup
 * migration to `city_telegram_groups`. Previously copy-pasted across
 * `sendToCityGroup`, the `/broadcast` handler, and `/groups/:cityKey/refresh`.
 *
 * Upserts the row keyed by cityKey: sets the new chatId, isSupergroup=true,
 * source='migration', region (GPP slug via FIX #1) so a freshly-created row
 * isn't NULL, and lastVerifiedAt=now(). Best-effort: never throws — a failed
 * persist must not flip a successful send to an error. Returns true on success.
 */
export async function persistCityGroupMigration(
  cityKey: string,
  newChatId: string | bigint,
): Promise<boolean> {
  const key = (cityKey || '').toLowerCase().trim();
  if (!key) return false;
  try {
    const region = await getGppRegionByCityKey(key);
    await prisma.cityTelegramGroup.upsert({
      where: { cityKey: key },
      create: {
        cityKey: key,
        chatId: BigInt(newChatId),
        isSupergroup: true,
        source: 'migration',
        region,
        lastVerifiedAt: new Date(),
      },
      update: {
        chatId: BigInt(newChatId),
        isSupergroup: true,
        source: 'migration',
        // Only backfill region when it's currently missing — never clobber a
        // value an admin/import already set.
        ...(region ? { region } : {}),
        lastVerifiedAt: new Date(),
      },
    });
    return true;
  } catch (err: any) {
    console.error(
      `[tonda-58293][city-group] failed to persist migration for ${key}:`,
      err?.message || err,
    );
    return false;
  }
}

export interface SendToCityGroupResult {
  ok: boolean;
  /** True when there is no group on file for the city (no row or null chat_id). */
  skipped?: boolean;
  /** Human-readable reason for a skip or failure. */
  reason?: string;
  /** The chat_id we ultimately sent to (string form), when known. */
  chatId?: string;
  /** Set when the group had migrated to a supergroup and we persisted the new id. */
  migratedTo?: string;
}

/**
 * Send `text` to the Telegram group chat registered for `cityKey`.
 *
 * @param cityKey  Already-normalized city key (caller should pass `lower(trim(city))`).
 * @param text     Message body.
 * @param parseMode Optional Telegram parse_mode ('HTML' | 'Markdown'); omit/None for plain.
 * @param replyMarkup Optional Telegram reply_markup (e.g. an inline_keyboard);
 *   bocconcini-58533 uses this to attach URL + copy_text connect buttons.
 */
export async function sendToCityGroup(
  cityKey: string,
  text: string,
  parseMode?: string,
  replyMarkup?: Record<string, unknown>,
): Promise<SendToCityGroupResult> {
  const key = (cityKey || '').toLowerCase().trim();
  if (!key) {
    return { ok: false, skipped: true, reason: 'no city TG group set' };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, reason: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const row = await prisma.cityTelegramGroup.findUnique({
    where: { cityKey: key },
    select: { chatId: true },
  });

  // provola-58505 (lazy on-demand sync): the scheduled bulk sync was retired.
  // If there's no row / null chat_id, ask moltobene (the authoritative owner of
  // the bot's group membership) for this city's chat_id exactly ONCE. If it
  // can't tell us, fall back to the existing skip result.
  let chatId: bigint | null = row?.chatId ?? null;
  // Guard so we only ever hit moltobene one time per send (here OR after a
  // not-found send failure below — never both).
  let refreshAttempted = false;
  if (chatId === null) {
    refreshAttempted = true;
    chatId = await refreshCityGroupFromMoltobene(key);
    if (chatId === null) {
      return { ok: false, skipped: true, reason: 'no city TG group set' };
    }
  }

  const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;

  const send = async (sendChatId: string) => {
    const resp = await fetch(`${BOT_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: sendChatId,
        text: withBennySignature(text),
        disable_web_page_preview: true,
        ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
        ...(replyMarkup && { reply_markup: replyMarkup }),
      }),
    });
    return resp.json() as Promise<any>;
  };

  // provola-58505: a chat-not-found style failure means our stored id is stale
  // (group recreated/migrated and re-reported by moltobene under a new id). We
  // re-pull from moltobene once and retry. "bot was kicked" is NOT included —
  // a fresh id won't fix a removed bot.
  const isChatNotFound = (result: any): boolean => {
    const code = result?.error_code;
    const desc: string = result?.description || '';
    return (
      code === 400 &&
      /chat not found|chat_id is empty|group chat was deactivated|peer_id_invalid/i.test(desc)
    );
  };

  let originalChatId = chatId.toString();

  try {
    let result = await send(originalChatId);

    // Auto-retry + PERSIST if the group was upgraded to a supergroup.
    if (!result.ok && result.parameters?.migrate_to_chat_id) {
      const newChatId = String(result.parameters.migrate_to_chat_id);
      console.log(
        `[tonda-58293][city-group] ${key} migrated ${originalChatId} -> ${newChatId}, retrying...`,
      );
      result = await send(newChatId);

      if (result.ok) {
        // Send succeeded; failing to persist must not flip the result to error.
        await persistCityGroupMigration(key, newChatId);
        return { ok: true, chatId: newChatId, migratedTo: newChatId };
      }

      return {
        ok: false,
        reason: result.description || 'Failed after migration retry',
        chatId: newChatId,
      };
    }

    // provola-58505: stale-id recovery. If the send failed because the chat is
    // gone, re-pull this city's id from moltobene once and retry the send.
    if (!result.ok && !refreshAttempted && isChatNotFound(result)) {
      refreshAttempted = true;
      const refreshed = await refreshCityGroupFromMoltobene(key);
      if (refreshed !== null && refreshed.toString() !== originalChatId) {
        console.log(
          `[provola-58505][city-group] ${key} chat not found; refreshed id -> ${refreshed}, retrying...`,
        );
        originalChatId = refreshed.toString();
        result = await send(originalChatId);
      }
    }

    if (result.ok) {
      // Touch last_verified_at so we know the mapping is still live.
      try {
        await prisma.cityTelegramGroup.update({
          where: { cityKey: key },
          data: { lastVerifiedAt: new Date() },
        });
      } catch (touchErr: any) {
        console.error(
          `[tonda-58293][city-group] failed to touch last_verified_at for ${key}:`,
          touchErr?.message || touchErr,
        );
      }
      return { ok: true, chatId: originalChatId };
    }

    return {
      ok: false,
      reason: result.description || 'Unknown Telegram error',
      chatId: originalChatId,
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.message || 'Network error',
      chatId: originalChatId,
    };
  }
}
