/**
 * sec-edge-functions: legacy AI order calls placed through the retired `ai-phone-order` edge
 * function could read a virtual card aloud. Before any transcript reaches a browser or our DB,
 * mask anything shaped like a card number (13-19 digits with optional spaces/dashes).
 *
 * The CVC cannot be recognised generically, so callers withhold transcripts and recordings
 * entirely for calls that carried a card (see blandCallHadCard).
 */
const REDACTED = '[redacted]';

export function redactCardNumbers(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/(?<!\d)\d(?:[\s-]*\d){12,18}(?!\d)/g, REDACTED);
}

/**
 * True when a Bland call object (webhook payload or GET /v1/calls/:id) may have carried a card.
 * The old edge function set `metadata.hasPaymentCard`. Fails closed when metadata is missing.
 */
export function blandCallHadCard(call: { metadata?: unknown } | null | undefined): boolean {
  const md = call?.metadata;
  if (!md || typeof md !== 'object') return true;
  const m = md as Record<string, unknown>;
  return m.hasPaymentCard === true || m.hasPaymentCard === 'true' || typeof m.virtualCardId === 'string';
}

/** Transcript safe to show: null for card calls, card-number-masked otherwise. */
export function safeTranscript(
  transcript: string | null | undefined,
  call: { metadata?: unknown } | null | undefined
): string | null {
  if (!transcript) return null;
  if (blandCallHadCard(call)) return null;
  return redactCardNumbers(transcript);
}
