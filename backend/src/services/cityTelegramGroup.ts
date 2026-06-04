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

const BOT_API = 'https://api.telegram.org';

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
 */
export async function sendToCityGroup(
  cityKey: string,
  text: string,
  parseMode?: string,
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

  if (!row || row.chatId === null) {
    return { ok: false, skipped: true, reason: 'no city TG group set' };
  }

  const effectiveParseMode = parseMode && parseMode !== 'None' ? parseMode : undefined;

  const send = async (chatId: string) => {
    const resp = await fetch(`${BOT_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(effectiveParseMode && { parse_mode: effectiveParseMode }),
      }),
    });
    return resp.json() as Promise<any>;
  };

  const originalChatId = row.chatId.toString();

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
        try {
          await prisma.cityTelegramGroup.update({
            where: { cityKey: key },
            data: {
              chatId: BigInt(newChatId),
              isSupergroup: true,
              source: 'migration',
              lastVerifiedAt: new Date(),
            },
          });
        } catch (persistErr: any) {
          // Send succeeded; failing to persist must not flip the result to error.
          console.error(
            `[tonda-58293][city-group] failed to persist migration for ${key}:`,
            persistErr?.message || persistErr,
          );
        }
        return { ok: true, chatId: newChatId, migratedTo: newChatId };
      }

      return {
        ok: false,
        reason: result.description || 'Failed after migration retry',
        chatId: newChatId,
      };
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
