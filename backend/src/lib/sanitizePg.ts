/**
 * stracchino-49640: strip characters Postgres rejects in jsonb / text columns —
 * NUL bytes ( ) and unpaired UTF-16 surrogates. gpt-4o OCR output of some
 * receipts contains these, which 500'd payout submission at the DB insert
 * (jsonb / text cannot represent   or a lone surrogate). Apply to every
 * free-form OCR-derived value before it is persisted.
 *
 * `\p{Cs}` with the /u flag matches ONLY unpaired surrogate code points — valid
 * astral characters (emoji etc.) are decoded as single non-Cs code points and
 * are preserved.
 */
export function sanitizePgString(s: string): string {
  return s.replace(/ /g, '').replace(/\p{Cs}/gu, '');
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
