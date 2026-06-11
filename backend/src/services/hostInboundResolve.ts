/**
 * suppli-58533: host DM submissions to Molto Benny.
 *
 * A host can REPLY to the bot in Telegram (send a photo, or type a number) and
 * have it added to their event. moltobene captures the inbound DM and forwards
 * `{ chatId, fileId|text }` to POST /api/telegram/host-inbound, which uses the
 * helpers in this file to (1) resolve which party the chatId belongs to, and
 * (2) download the photo bytes from Telegram (RSV.Pizza holds the same
 * TELEGRAM_BOT_TOKEN as the bot, so it can call getFile + download itself).
 */
import { prisma } from '../config/database.js';

/**
 * Result of resolving a chatId to a party.
 *
 *  - `{ kind: 'party', party }`     → unambiguous single host party.
 *  - `{ kind: 'ambiguous', slug? }` → ≥2 plausible parties (the handler tells
 *                                     the host to use the web link and stops).
 *  - `{ kind: 'none' }`             → no party matches the chatId (reply nothing).
 */
export type ResolvedHostParty =
  | { kind: 'party'; party: HostInboundParty }
  | { kind: 'ambiguous'; slug: string | null }
  | { kind: 'none' };

export interface HostInboundParty {
  id: string;
  name: string;
  customUrl: string | null;
  inviteCode: string;
  country: string | null;
  date: Date | null;
  underbossStatus: string;
  receiptsReminderSentAt: Date | null;
  photoReminderSentAt: Date | null;
  walletReminderSentAt: Date | null;
  attendanceReminderSentAt: Date | null;
  hostTelegramLinkToken: string | null;
  user: { id: string; email: string } | null;
}

const PARTY_SELECT = {
  id: true,
  name: true,
  customUrl: true,
  inviteCode: true,
  country: true,
  date: true,
  underbossStatus: true,
  receiptsReminderSentAt: true,
  photoReminderSentAt: true,
  walletReminderSentAt: true,
  attendanceReminderSentAt: true,
  hostTelegramLinkToken: true,
  user: { select: { id: true, email: true } },
} as const;

/** Most-recent reminder timestamp across all four reminder kinds (or null). */
function maxReminder(p: HostInboundParty): number | null {
  const ts = [
    p.receiptsReminderSentAt,
    p.photoReminderSentAt,
    p.walletReminderSentAt,
    p.attendanceReminderSentAt,
  ]
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  return ts.length > 0 ? Math.max(...ts) : null;
}

function slugOf(p: HostInboundParty): string | null {
  return p.customUrl || p.inviteCode || null;
}

/**
 * Resolve the party a host's Telegram chatId belongs to.
 *
 * `parties.host_telegram_chat_id` is NOT unique — one chatId can map to many
 * parties (a host running multiple cities/years). Selection order:
 *   1. If exactly one party matches → that party.
 *   2. Pick the party with the MOST RECENT reminder
 *      (max of receipts/photo/wallet/attendance reminder timestamps).
 *   3. If none have a reminder timestamp, pick the most recent APPROVED party
 *      (by event date desc, then createdAt desc).
 *   4. If still a genuine tie (≥2 equally-ranked) → ambiguous.
 *   5. No party matches the chatId at all → none.
 */
export async function resolveHostPartyByChatId(
  chatId: number | bigint,
): Promise<ResolvedHostParty> {
  let chatIdBig: bigint;
  try {
    chatIdBig = BigInt(chatId);
  } catch {
    return { kind: 'none' };
  }

  const parties = (await prisma.party.findMany({
    where: { hostTelegramChatId: chatIdBig },
    select: PARTY_SELECT,
    orderBy: { createdAt: 'desc' },
  })) as unknown as HostInboundParty[];

  if (parties.length === 0) return { kind: 'none' };
  if (parties.length === 1) return { kind: 'party', party: parties[0] };

  // (2) Prefer the party with the most recent reminder.
  const withReminder = parties
    .map((p) => ({ p, r: maxReminder(p) }))
    .filter((x): x is { p: HostInboundParty; r: number } => x.r != null);

  if (withReminder.length > 0) {
    const maxR = Math.max(...withReminder.map((x) => x.r));
    const top = withReminder.filter((x) => x.r === maxR);
    if (top.length === 1) return { kind: 'party', party: top[0].p };
    // Genuine tie on reminder timestamp → ambiguous.
    return { kind: 'ambiguous', slug: slugOf(top[0].p) };
  }

  // (3) No reminders anywhere → most recent APPROVED party.
  const approved = parties.filter((p) => p.underbossStatus === 'approved');
  const pool = approved.length > 0 ? approved : parties;

  const sorted = [...pool].sort((a, b) => {
    const ad = a.date ? a.date.getTime() : 0;
    const bd = b.date ? b.date.getTime() : 0;
    return bd - ad; // most recent event date first
  });

  // If the top two share the same event date we can't disambiguate cleanly —
  // call it ambiguous so we don't guess and add a photo to the wrong event.
  if (
    sorted.length >= 2 &&
    (sorted[0].date?.getTime() ?? 0) === (sorted[1].date?.getTime() ?? 0)
  ) {
    return { kind: 'ambiguous', slug: slugOf(sorted[0]) };
  }

  return { kind: 'party', party: sorted[0] };
}

export interface DownloadedTelegramFile {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Download a Telegram file by `fileId` using the bot token.
 *
 *   GET https://api.telegram.org/bot{TOKEN}/getFile?file_id=... → result.file_path
 *   GET https://api.telegram.org/file/bot{TOKEN}/{file_path}     → raw bytes
 *
 * If `imageBase64` is supplied instead, decode that and skip the network round
 * trips (cheap hedge — moltobene can inline small images).
 *
 * Throws on misconfiguration / Telegram errors so the caller can surface a
 * graceful failure to the host.
 */
export async function downloadTelegramFile(
  fileId: string,
  imageBase64?: string,
): Promise<DownloadedTelegramFile> {
  // Fast path: caller already inlined the bytes.
  if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
    // Strip an optional data-URL prefix ("data:image/jpeg;base64,...").
    let mimeType = 'image/jpeg';
    let b64 = imageBase64;
    const dataUrlMatch = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(imageBase64);
    if (dataUrlMatch) {
      if (dataUrlMatch[1]) mimeType = dataUrlMatch[1];
      b64 = dataUrlMatch[2];
    }
    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length === 0) {
      throw new Error('imageBase64 decoded to zero bytes');
    }
    const ext = mimeType.split('/')[1] || 'jpg';
    return { buffer, mimeType, fileName: `tg-${Date.now()}.${ext}` };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }

  const getFileResp = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!getFileResp.ok) {
    throw new Error(`Telegram getFile returned ${getFileResp.status}`);
  }
  const getFileJson = (await getFileResp.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
  };
  const filePath = getFileJson?.result?.file_path;
  if (!getFileJson?.ok || !filePath) {
    throw new Error('Telegram getFile returned no file_path');
  }

  const fileResp = await fetch(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
    { signal: AbortSignal.timeout(20000) },
  );
  if (!fileResp.ok) {
    throw new Error(`Telegram file download returned ${fileResp.status}`);
  }
  const arrayBuf = await fileResp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length === 0) {
    throw new Error('Telegram file download returned zero bytes');
  }

  // Infer mime/extension from the file_path suffix (Telegram preserves it).
  const lowerPath = filePath.toLowerCase();
  let mimeType = 'image/jpeg';
  if (lowerPath.endsWith('.png')) mimeType = 'image/png';
  else if (lowerPath.endsWith('.webp')) mimeType = 'image/webp';
  else if (lowerPath.endsWith('.heic')) mimeType = 'image/heic';
  else if (lowerPath.endsWith('.heif')) mimeType = 'image/heif';
  else if (lowerPath.endsWith('.gif')) mimeType = 'image/gif';
  const ext = filePath.split('.').pop() || 'jpg';
  const fileName = `tg-${Date.now()}.${ext}`;

  return { buffer, mimeType, fileName };
}
