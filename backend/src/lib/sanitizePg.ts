/**
 * stracchino-49640: strip characters Postgres rejects in jsonb / text columns:
 * NUL bytes (code point zero) and unpaired UTF-16 surrogates. gpt-4o OCR output
 * of some receipts contains these, which 500'd payout submission at the DB
 * insert (jsonb / text cannot represent a NUL or a lone surrogate). Apply to
 * every free-form OCR-derived value before it is persisted.
 *
 * The NUL matcher is built via String.fromCharCode(0) rather than a literal
 * control char or a regex escape literal, because both have been corrupted by
 * editor / transport transcoding (a literal NUL once silently became a space,
 * which stripped every space from OCR text instead of removing NULs).
 *
 * The second replace uses the Cs Unicode property with the /u flag, which
 * matches ONLY unpaired surrogate code points: valid astral characters (emoji
 * etc.) decode as single non-surrogate code points and are preserved.
 */
const NUL = String.fromCharCode(0);

export function sanitizePgString(s: string): string {
  return s.split(NUL).join('').replace(/\p{Cs}/gu, '');
}

/** Recursively sanitize all strings inside a JSON-serializable value. */
export function sanitizeForPg<T>(value: T): T {
  if (typeof value === 'string') return sanitizePgString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeForPg(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForPg(v);
    }
    return out as T;
  }
  return value;
}
