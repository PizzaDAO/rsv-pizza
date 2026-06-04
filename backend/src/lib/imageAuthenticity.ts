/**
 * marinara-61455: image-authenticity (AI-generated / doctored) scorer.
 *
 * A manual, admin-triggered tool that judges whether a payment-receipt image or
 * a host event-cover image is AI-generated or doctored. Advisory only — it
 * surfaces a verdict + confidence + concrete reasons for a human reviewer; it
 * NEVER auto-rejects.
 *
 * Mirrors the weighted-signal shape of `fakeDetection.ts`: each pass is a
 * function returning `{ id, name, fired, weight, detail, evidence? }`; fired
 * weights are summed, capped at 100, and mapped to a tiered verdict.
 *
 * Passes (cheapest-first):
 *   1. Metadata / provenance  — generator/editor software tags + C2PA presence.
 *      ⚠️ Presence is a STRONG positive signal; ABSENCE of EXIF is weak (our
 *      Supabase re-encode + screenshots + chat compression all strip it), so
 *      missing EXIF never dominates the score.
 *   2. LLM vision verdict     — the PRIMARY judgment (OpenAI gpt-4o), behind a
 *      provider interface so a Claude / 3rd-party second opinion can join later.
 *   3. Receipt-math sanity    — (receipts only) line items not summing to the
 *      total is a cheap, hard-to-fake tampering signal.
 *   4. ELA overlay (Phase 2)  — a downloadable error-level-analysis artifact for
 *      the admin. NOT scored (too noisy to auto-verdict reliably).
 *   5. Second opinion (Phase 2) — env-gated Claude / Sightengine providers as a
 *      tie-breaker on `suspicious` verdicts. Off unless their key is set.
 */

import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import {
  primaryVisionProvider,
  secondOpinionProviders,
  VisionResult,
  VisionVerdict,
} from './providers/index.js';

// ============================================
// Types
// ============================================

export type SourceKind = 'receipt' | 'event_image';
export type AuthenticityVerdict = VisionVerdict; // 'authentic' | 'suspicious' | 'likely_fake'

export interface AuthenticitySignal {
  id: string;
  name: string;
  fired: boolean;
  weight: number;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface OcrLineItemLike {
  subtotal?: number | null;
  ineligible?: boolean | null;
}

export interface AuthenticityInput {
  imageUrl: string;
  sourceKind: SourceKind;
  /** Receipts only — used by the receipt-math pass. */
  ocrLineItems?: OcrLineItemLike[] | null;
  ocrAmount?: number | null;
}

export interface AuthenticityResult {
  verdict: AuthenticityVerdict;
  score: number;
  signals: AuthenticitySignal[];
  /** Headline vision provider's structured output. */
  vision: VisionResult | null;
  /** Any env-gated second-opinion results that ran. */
  secondOpinions: VisionResult[];
  provider: string;
  /** Phase 2 ELA overlay public URL, when generation + upload succeeded. */
  elaArtifactUrl: string | null;
  /** Flattened reasons array persisted to the check row's `reasons` jsonb. */
  reasons: unknown;
}

// ============================================
// Weights (tunable without code surgery)
// ============================================

export const WEIGHTS = {
  // Metadata / provenance.
  generator_software_tag: 55, // DALL-E / Midjourney / SD / Firefly etc.
  editor_software_tag: 25, // Photoshop / GIMP — doctoring-capable editor.
  c2pa_ai_manifest: 60, // Content Credentials declaring AI generation.
  missing_exif: 4, // weak — re-encodes/screenshots strip EXIF.
  // Vision verdict (primary).
  vision_likely_fake: 60,
  vision_suspicious: 30,
  // Receipt math.
  receipt_math_mismatch: 25,
} as const;

// ============================================
// Verdict tiering
// ============================================

export function verdictFromScore(score: number): AuthenticityVerdict {
  if (score >= 60) return 'likely_fake';
  if (score >= 30) return 'suspicious';
  return 'authentic';
}

// ============================================
// Pass 1 — metadata / provenance
// ============================================

// Generator software / model markers (AI image generators). Lowercased.
const GENERATOR_MARKERS = [
  'dall-e',
  'dall·e',
  'dalle',
  'midjourney',
  'stable diffusion',
  'stablediffusion',
  'stable-diffusion',
  'adobe firefly',
  'firefly',
  'sdxl',
  'comfyui',
  'automatic1111',
  'invokeai',
  'leonardo.ai',
  'ideogram',
];

// Image-EDITOR markers (doctoring-capable). Lowercased.
const EDITOR_MARKERS = [
  'adobe photoshop',
  'photoshop',
  'gimp',
  'pixlr',
  'affinity photo',
  'paint.net',
];

// C2PA / Content Credentials manifest markers.
const C2PA_MARKERS = ['c2pa', 'contentcredentials', 'content credentials', 'jumbf', 'cai:'];

export interface MetadataScan {
  hasExif: boolean;
  generatorHits: string[];
  editorHits: string[];
  c2paHit: boolean;
  software: string | null;
}

/**
 * Scan a raw image buffer for provenance markers. We look at the EXIF block
 * (via sharp metadata) AND scan the head/tail of the raw bytes for ASCII
 * software/C2PA markers — this catches XMP `xmp:CreatorTool`, PNG `tEXt`
 * `Software`, JFIF comments, and C2PA/JUMBF boxes without pulling in a heavy
 * EXIF/C2PA parsing dependency.
 */
export async function scanImageMetadata(buffer: Buffer): Promise<MetadataScan> {
  let hasExif = false;
  let software: string | null = null;
  try {
    const meta = await sharp(buffer).metadata();
    hasExif = !!meta.exif && meta.exif.length > 0;
    // sharp exposes the raw EXIF buffer; decode it as latin1 so we can substring
    // it alongside any embedded XMP. (We are looking for ASCII software tags.)
    if (meta.exif) {
      const exifText = meta.exif.toString('latin1');
      const swMatch = /Software\x00*([\x20-\x7e]{2,64})/.exec(exifText);
      if (swMatch) software = swMatch[1].trim();
    }
  } catch {
    // sharp can't parse — treat as no EXIF; the vision pass still runs.
    hasExif = false;
  }

  // Scan a bounded window of the raw bytes for ASCII markers (XMP + PNG tEXt +
  // C2PA boxes typically live near the head; cap the scan to stay cheap).
  const head = buffer.subarray(0, Math.min(buffer.length, 256 * 1024)).toString('latin1').toLowerCase();
  const tail = buffer.subarray(Math.max(0, buffer.length - 64 * 1024)).toString('latin1').toLowerCase();
  const haystack = `${software ? software.toLowerCase() + ' ' : ''}${head}\n${tail}`;

  const generatorHits = GENERATOR_MARKERS.filter((m) => haystack.includes(m));
  const editorHits = EDITOR_MARKERS.filter((m) => haystack.includes(m));
  const c2paHit = C2PA_MARKERS.some((m) => haystack.includes(m));

  return { hasExif, generatorHits, editorHits, c2paHit, software };
}

export function metadataSignals(scan: MetadataScan): AuthenticitySignal[] {
  const signals: AuthenticitySignal[] = [];

  signals.push({
    id: 'generator_software_tag',
    name: 'AI-generator software tag',
    fired: scan.generatorHits.length > 0,
    weight: WEIGHTS.generator_software_tag,
    detail: scan.generatorHits.length
      ? `Image metadata references AI generator(s): ${scan.generatorHits.join(', ')}.`
      : 'No AI-generator software tag found in metadata.',
    evidence: { generatorHits: scan.generatorHits, software: scan.software },
  });

  signals.push({
    id: 'editor_software_tag',
    name: 'Image-editor software tag',
    fired: scan.editorHits.length > 0,
    weight: WEIGHTS.editor_software_tag,
    detail: scan.editorHits.length
      ? `Image was processed by editor(s): ${scan.editorHits.join(', ')} (doctoring-capable).`
      : 'No image-editor software tag found in metadata.',
    evidence: { editorHits: scan.editorHits },
  });

  signals.push({
    id: 'c2pa_ai_manifest',
    name: 'C2PA / Content Credentials manifest',
    fired: scan.c2paHit,
    weight: WEIGHTS.c2pa_ai_manifest,
    detail: scan.c2paHit
      ? 'A C2PA / Content-Credentials manifest is present — inspect it for an AI-generation assertion.'
      : 'No C2PA / Content-Credentials manifest detected.',
  });

  // ⚠️ Absence of EXIF is a WEAK signal (Supabase re-encode, screenshots, and
  // chat-app compression all strip it). Low weight by design — never condemn on
  // missing EXIF alone.
  signals.push({
    id: 'missing_exif',
    name: 'No camera EXIF metadata',
    fired: !scan.hasExif,
    weight: WEIGHTS.missing_exif,
    detail: !scan.hasExif
      ? 'No EXIF metadata (weak signal — re-encodes, screenshots, and chat compression strip it too).'
      : 'EXIF metadata present.',
  });

  return signals;
}

// ============================================
// Pass 3 — receipt-math sanity
// ============================================

/**
 * Line items not summing to the receipt total (within tolerance) is a cheap,
 * hard-to-fake tampering signal. Skips when we don't have both line items and a
 * total. Only counts eligible (non-`ineligible`) lines, matching the reviewer's
 * own sum semantics.
 */
export function receiptMathSignal(
  lineItems: OcrLineItemLike[] | null | undefined,
  ocrAmount: number | null | undefined,
): AuthenticitySignal {
  const id = 'receipt_math_mismatch';
  const name = 'Receipt line items do not sum to total';

  if (!lineItems || lineItems.length === 0 || ocrAmount == null || !Number.isFinite(ocrAmount)) {
    return {
      id,
      name,
      fired: false,
      weight: WEIGHTS.receipt_math_mismatch,
      detail: 'Not enough data to check receipt math (need line items + a total).',
    };
  }

  const lineSum = lineItems.reduce((sum, li) => {
    if (li?.ineligible === true) return sum;
    const v = Number(li?.subtotal);
    return sum + (Number.isFinite(v) && v >= 0 ? v : 0);
  }, 0);

  // Tolerance: the larger of $0.50 or 2% of the total (covers rounding + minor
  // unparsed fees/tax without false-firing on legitimate receipts).
  const tolerance = Math.max(0.5, Math.abs(ocrAmount) * 0.02);
  const diff = Math.abs(lineSum - ocrAmount);
  const fired = diff > tolerance;

  return {
    id,
    name,
    fired,
    weight: WEIGHTS.receipt_math_mismatch,
    detail: fired
      ? `Line items sum to ${lineSum.toFixed(2)} but the stated total is ${ocrAmount.toFixed(2)} (off by ${diff.toFixed(2)}, tolerance ${tolerance.toFixed(2)}).`
      : `Line items sum to ${lineSum.toFixed(2)}, consistent with the total ${ocrAmount.toFixed(2)}.`,
    evidence: { lineSum, ocrAmount, diff, tolerance },
  };
}

// ============================================
// Pass 2 — vision verdict signals
// ============================================

export function visionSignals(vision: VisionResult | null): AuthenticitySignal[] {
  if (!vision) {
    return [
      {
        id: 'vision_verdict',
        name: 'Vision model verdict',
        fired: false,
        weight: 0,
        detail: 'Vision model did not return a verdict.',
      },
    ];
  }
  const fakeWeight =
    vision.verdict === 'likely_fake'
      ? WEIGHTS.vision_likely_fake
      : vision.verdict === 'suspicious'
        ? WEIGHTS.vision_suspicious
        : 0;
  return [
    {
      id: 'vision_verdict',
      name: `Vision model verdict (${vision.provider})`,
      fired: vision.verdict !== 'authentic',
      weight: fakeWeight,
      detail: `Vision model verdict: ${vision.verdict} (confidence ${vision.confidence}%).${
        vision.observations.length ? ' Tells: ' + vision.observations.join('; ') : ''
      }`,
      evidence: { verdict: vision.verdict, confidence: vision.confidence, observations: vision.observations },
    },
  ];
}

// ============================================
// Pass 4 — ELA overlay (Phase 2)
// ============================================

const ELA_BUCKET = 'event-images';

/**
 * Generate an error-level-analysis overlay and upload it to the event-images
 * bucket. Recompress the image at a fixed JPEG quality, take the absolute
 * per-pixel difference against the original, and normalise it so tampered /
 * spliced regions (which compress differently) stand out. Returns the public
 * URL of the uploaded PNG, or null on any failure (best-effort artifact —
 * never blocks the verdict).
 */
export async function generateElaArtifact(
  buffer: Buffer,
  imageUrl: string,
): Promise<string | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  try {
    // Normalise both sides to a common pixel grid so the diff lines up even if
    // the original is a PNG / odd dimensions.
    const base = sharp(buffer).removeAlpha();
    const meta = await base.metadata();
    const width = Math.min(meta.width ?? 1024, 1600);

    const original = await sharp(buffer)
      .removeAlpha()
      .resize({ width, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Recompress at a known quality, then decode back to raw to diff.
    const recompressed = await sharp(buffer)
      .removeAlpha()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
    const recompressedRaw = await sharp(recompressed)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const a = original.data;
    const b = recompressedRaw.data;
    const len = Math.min(a.length, b.length);
    const diff = Buffer.alloc(len);
    let maxDiff = 1;
    for (let i = 0; i < len; i++) {
      const d = Math.abs(a[i] - b[i]);
      diff[i] = d;
      if (d > maxDiff) maxDiff = d;
    }
    // Amplify so subtle differences are visible.
    const scale = 255 / maxDiff;
    for (let i = 0; i < len; i++) {
      diff[i] = Math.min(255, Math.round(diff[i] * scale));
    }

    const overlayPng = await sharp(diff, {
      raw: { width: original.info.width, height: original.info.height, channels: original.info.channels },
    })
      .png()
      .toBuffer();

    const supabase = createClient(supabaseUrl, serviceKey);
    const safe = imageUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-24) || 'img';
    const fileName = `image-authenticity/ela-${Date.now()}-${safe}.png`;
    const { error } = await supabase.storage
      .from(ELA_BUCKET)
      .upload(fileName, overlayPng, { cacheControl: '3600', upsert: false, contentType: 'image/png' });
    if (error) {
      return null;
    }
    const { data } = supabase.storage.from(ELA_BUCKET).getPublicUrl(fileName);
    return data.publicUrl ?? null;
  } catch {
    return null;
  }
}

// ============================================
// Helpers
// ============================================

/** Fetch an image from a public URL → base64 data URL (for vision providers). */
export async function imageUrlToBase64DataUrl(imageUrl: string): Promise<{ dataUrl: string; buffer: Buffer }> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch image (HTTP ${response.status}) from ${imageUrl}`);
  }
  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const base64 = buffer.toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return { dataUrl: `data:${contentType};base64,${base64}`, buffer };
}

// ============================================
// Aggregator
// ============================================

/**
 * Run all passes for one image and produce a cached-shape result. Network /
 * model errors in any one pass are caught so a single failing pass never sinks
 * the whole check — the verdict degrades gracefully (e.g. if vision throws, the
 * metadata + receipt-math signals still produce a score).
 */
export async function scoreImageAuthenticity(input: AuthenticityInput): Promise<AuthenticityResult> {
  const { dataUrl, buffer } = await imageUrlToBase64DataUrl(input.imageUrl);

  // Pass 1 — metadata (deterministic, ~free).
  let metaScan: MetadataScan;
  try {
    metaScan = await scanImageMetadata(buffer);
  } catch {
    metaScan = { hasExif: false, generatorHits: [], editorHits: [], c2paHit: false, software: null };
  }
  const metaSigs = metadataSignals(metaScan);

  // Pass 2 — primary vision verdict.
  let vision: VisionResult | null = null;
  let visionError: string | null = null;
  if (primaryVisionProvider.available()) {
    try {
      vision = await primaryVisionProvider.analyze(dataUrl, { sourceKind: input.sourceKind });
    } catch (err: any) {
      visionError = err?.message || 'vision provider failed';
    }
  } else {
    visionError = 'primary vision provider unavailable (OPENAI_API_KEY not set)';
  }
  const visionSigs = visionSignals(vision);

  // Pass 3 — receipt math (receipts only).
  const mathSig =
    input.sourceKind === 'receipt'
      ? receiptMathSignal(input.ocrLineItems, input.ocrAmount)
      : null;

  // Pass 5 — second opinions (env-gated). Run only the available ones; a
  // disagreement nudges the score up via the suspicious weight.
  const secondOpinions: VisionResult[] = [];
  for (const p of secondOpinionProviders) {
    if (!p.available()) continue;
    try {
      // Sightengine needs a public URL; others take the data URL. Pass the URL
      // for sightengine and the data URL otherwise.
      const arg = p.id === 'sightengine' ? input.imageUrl : dataUrl;
      const r = await p.analyze(arg, { sourceKind: input.sourceKind });
      secondOpinions.push(r);
    } catch {
      // Dormant / failing second opinion never blocks the verdict.
    }
  }
  const secondOpinionSigs: AuthenticitySignal[] = secondOpinions
    .filter((r) => r.verdict !== 'authentic')
    .map((r) => ({
      id: `second_opinion_${r.provider}`,
      name: `Second opinion (${r.provider})`,
      fired: true,
      weight: r.verdict === 'likely_fake' ? WEIGHTS.vision_suspicious : 12,
      detail: `${r.provider} second opinion: ${r.verdict} (${r.confidence}%).${
        r.observations.length ? ' ' + r.observations.join('; ') : ''
      }`,
      evidence: { verdict: r.verdict, confidence: r.confidence },
    }));

  // Pass 4 — ELA artifact (best-effort, unscored).
  const elaArtifactUrl = await generateElaArtifact(buffer, input.imageUrl);

  const signals: AuthenticitySignal[] = [
    ...metaSigs,
    ...visionSigs,
    ...(mathSig ? [mathSig] : []),
    ...secondOpinionSigs,
  ];

  const score = Math.min(
    100,
    signals.filter((s) => s.fired).reduce((sum, s) => sum + s.weight, 0),
  );
  const verdict = verdictFromScore(score);

  return {
    verdict,
    score,
    signals,
    vision,
    secondOpinions,
    provider: vision?.provider ?? primaryVisionProvider.id,
    elaArtifactUrl,
    reasons: {
      signals,
      vision,
      secondOpinions,
      metadata: metaScan,
      visionError,
    },
  };
}
