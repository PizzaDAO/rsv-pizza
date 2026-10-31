/**
 * Webhook signing, Standard-Webhooks style, shared by the sender (pizza-mcp) and the receiver (rsv.pizza
 * copies this file). No dependencies beyond node:crypto.
 *
 *   Webhook-Id:        evt_...                 stable across retries: dedupe on it
 *   Webhook-Timestamp: unix seconds            fresh on every attempt
 *   Webhook-Signature: v1=<hex HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)>
 *
 * Verify against the RAW request body (before JSON.parse), reject timestamps more than 5 minutes off, compare
 * in constant time, and dedupe on Webhook-Id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_S = 300;

export function signWebhook(
  secret: string,
  id: string,
  timestamp: number | string,
  rawBody: string,
): string {
  return `v1=${createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("hex")}`;
}

export type WebhookVerdict =
  { ok: true; id: string } | { ok: false; reason: string };

/**
 * `headers` is any object with a case-insensitive `get` (Fetch Headers) or a plain lower-case record.
 * `secrets` may hold several (rotation): any match passes.
 */
export function verifyWebhook(
  secrets: string | string[],
  headers: Headers | Record<string, string | string[] | undefined>,
  rawBody: string,
  nowS: number = Math.floor(Date.now() / 1000),
): WebhookVerdict {
  const get = (k: string): string | undefined => {
    if (typeof (headers as Headers).get === "function")
      return (headers as Headers).get(k) ?? undefined;
    const rec = headers as Record<string, string | string[] | undefined>;
    const key = Object.keys(rec).find((h) => h.toLowerCase() === k);
    const v = key ? rec[key] : undefined;
    return Array.isArray(v) ? v[0] : v;
  };
  const id = get("webhook-id");
  const ts = get("webhook-timestamp");
  const sigs = get("webhook-signature");
  if (!id || !ts || !sigs) return { ok: false, reason: "missing headers" };
  const t = Number(ts);
  if (!Number.isInteger(t) || Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S)
    return { ok: false, reason: "timestamp outside tolerance" };
  const candidates = sigs.split(" ").filter((s) => s.startsWith("v1="));
  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    const want = Buffer.from(signWebhook(secret, id, ts, rawBody));
    for (const c of candidates) {
      const got = Buffer.from(c);
      if (got.length === want.length && timingSafeEqual(got, want))
        return { ok: true, id };
    }
  }
  return { ok: false, reason: "bad signature" };
}
