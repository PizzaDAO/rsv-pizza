/**
 * marinara-61455: vision-provider interface for the image-authenticity scorer.
 *
 * Each provider takes an image (as a base64 data URL) + a context hint and
 * returns a structured authenticity judgment. Providers are env-gated: a
 * provider whose API key is absent reports `available() === false` and is
 * skipped silently, so Phase 1 ships with only OPENAI_API_KEY configured.
 */

export type VisionVerdict = 'authentic' | 'suspicious' | 'likely_fake';

export interface VisionResult {
  /** Provider id that produced this result ('openai' | 'anthropic' | ...). */
  provider: string;
  verdict: VisionVerdict;
  /** Model self-reported confidence, 0-100. */
  confidence: number;
  /** Concrete tells the model observed (garbled text, melted edges, etc.). */
  observations: string[];
  /** Raw model response, retained for debugging. */
  raw?: unknown;
}

export interface VisionContext {
  /** 'receipt' | 'event_image' — steers the prompt's emphasis. */
  sourceKind: 'receipt' | 'event_image';
}

export interface VisionProvider {
  /** Stable id persisted on the check row's `provider` column. */
  id: string;
  /**
   * True when the provider's required env vars are present. Callers MUST skip
   * the provider silently when this is false so a missing optional key never
   * breaks the Phase 1 path.
   */
  available(): boolean;
  /**
   * Run the vision judgment. `imageDataUrl` is a base64 `data:` URL (already
   * fetched + encoded by the caller so providers don't each re-download).
   */
  analyze(imageDataUrl: string, ctx: VisionContext): Promise<VisionResult>;
}

/**
 * Shared prompt copy so every provider asks for the same concrete tells and the
 * same structured JSON shape. Keeps verdicts comparable across providers.
 */
export const VISION_SYSTEM_PROMPT = `You are an image-forensics assistant that judges whether an image is AI-GENERATED or DIGITALLY DOCTORED. You are given either a photo of a payment receipt or a host's event-cover image.

Look for concrete tells:
- AI generation: garbled / warped text and impossible glyphs (generators are bad at the dense text on receipts), inconsistent lighting and shadow directions, melted or smeared edges, nonsensical or duplicated patterns, anatomically impossible details.
- Doctoring / tampering: mismatched fonts or kerning on amount/total fields, baseline misalignment of edited numbers, cloned or duplicated regions, abrupt compression or noise discontinuities, halos around pasted elements.

Be calibrated: heavy compression, scanner artifacts, dark restaurant lighting, and screenshots are NOT by themselves evidence of fakery. Only flag concrete, image-grounded tells. When unsure, prefer "suspicious" over "likely_fake".

Return ONLY a JSON object:
{
  "verdict": "authentic" | "suspicious" | "likely_fake",
  "confidence": number (0-100, your confidence in the verdict),
  "observations": string[] (each a short, specific, image-grounded tell; empty if none)
}`;

export function visionUserPrompt(ctx: VisionContext): string {
  return ctx.sourceKind === 'receipt'
    ? 'Judge whether this receipt image is AI-generated or doctored. Pay special attention to the legibility and consistency of the printed text and the total/amount fields.'
    : 'Judge whether this event-cover image is AI-generated or doctored.';
}

/** Coerce an arbitrary parsed JSON blob into a safe VisionResult. */
export function coerceVisionResult(
  provider: string,
  parsed: unknown,
): Omit<VisionResult, 'provider'> {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const rawVerdict = typeof obj.verdict === 'string' ? obj.verdict.toLowerCase().trim() : '';
  const verdict: VisionVerdict =
    rawVerdict === 'likely_fake' || rawVerdict === 'suspicious' || rawVerdict === 'authentic'
      ? (rawVerdict as VisionVerdict)
      : 'suspicious';
  const confNum = Number(obj.confidence);
  const confidence = Number.isFinite(confNum) ? Math.max(0, Math.min(100, confNum)) : 50;
  const observations = Array.isArray(obj.observations)
    ? obj.observations
        .filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
        .map((o) => o.trim())
        .slice(0, 20)
    : [];
  return { verdict, confidence, observations, raw: parsed };
}
