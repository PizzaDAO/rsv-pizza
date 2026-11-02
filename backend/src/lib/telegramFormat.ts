/**
 * Telegram message formatting.
 *
 * Telegram's legacy Markdown only bolds a single `*x*` and returns a 400
 * "can't parse entities" for any stray `_` or `*`. Senders therefore write
 * light Markdown (`**bold**`, `*bold*`, `_italic_`, `[text](url)`) and we
 * convert it to Telegram HTML, which is forgiving and escapes cleanly.
 */
import { withBennySignature } from './bennySignature.js';

export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert light Markdown to Telegram HTML. Everything else is escaped.
 * Unbalanced markers, snake_case, 2*3*4 and underscores inside URLs stay literal.
 */
export function toTelegramHtml(text: string): string {
  const stash: string[] = [];
  const hold = (html: string) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let s = escapeTelegramHtml(text ?? '');

  // [text](url): http/https only. s is already escaped, so only quotes remain.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    hold(`<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`),
  );
  // Bare URLs are protected so `_` and `*` inside them are never touched.
  s = s.replace(/https?:\/\/[^\s<]+/g, (url) => hold(url));

  // Bold: **x** first, then single *x*.
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<![*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '<b>$1</b>');

  // Italic: __x__ first, then word-bounded _x_ (snake_case is left alone).
  s = s.replace(/(?<![\w_])__(?=\S)([^\n]*?\S)__(?![\w_])/g, '<i>$1</i>');
  s = s.replace(/(?<![\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '<i>$1</i>');

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)]);
}

/** True for Telegram's 400 "can't parse entities" family of errors. */
export function isParseEntitiesError(resp: any): boolean {
  if (!resp || resp.ok === true) return false;
  const desc = typeof resp.description === 'string' ? resp.description : '';
  return (
    (resp.error_code === 400 || resp.error_code === undefined) &&
    /can'?t parse entities|can'?t find end of the entity/i.test(desc)
  );
}

export interface TelegramFormatted {
  /** Signed text to send. */
  text: string;
  parse_mode?: string;
  /** Signed original text, used for the plain retry. */
  plain: string;
}

/**
 * Apply a parse mode to a message (after token substitution, before the
 * signature). 'Auto' (and no mode) converts to HTML; 'None' is plain;
 * explicit HTML/Markdown pass through unchanged.
 */
export function formatForTelegram(text: string, parseMode?: string): TelegramFormatted {
  const plain = withBennySignature(text);
  if (!parseMode || parseMode === 'Auto') {
    return { text: withBennySignature(toTelegramHtml(text)), parse_mode: 'HTML', plain };
  }
  if (parseMode === 'None') return { text: plain, plain };
  return { text: plain, parse_mode: parseMode, plain };
}

/**
 * POST sendMessage once; if Telegram rejects the entities, retry once as plain
 * text. `extra` holds chat_id and other fields (not text / parse_mode).
 * Returns the HTTP status and parsed JSON of the final attempt.
 */
export async function postTelegramMessage(
  url: string,
  extra: Record<string, unknown>,
  fmt: TelegramFormatted,
  init: { signal?: AbortSignal } = {},
): Promise<{ status: number; json: any }> {
  const post = async (text: string, parse_mode?: string) => {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...extra, text, ...(parse_mode && { parse_mode }) }),
      signal: init.signal,
    });
    let json: any = null;
    try {
      json = await resp.json();
    } catch {
      json = { ok: false, error_code: resp.status };
    }
    return { status: resp.status, json };
  };
  let r = await post(fmt.text, fmt.parse_mode);
  if (fmt.parse_mode && isParseEntitiesError(r.json)) {
    r = await post(fmt.plain);
  }
  return r;
}
