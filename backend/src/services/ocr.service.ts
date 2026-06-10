/**
 * Receipt OCR service for host payouts (arugula-38633).
 * Ported from pizza-faucet-v2/src/app/api/analyze-receipt/route.ts.
 *
 * Uses OpenAI gpt-4o vision with json_object response_format. Fetches the
 * image from a Supabase Storage public URL, base64-encodes it, and asks the
 * model to extract the receipt total + currency + confidence.
 *
 * Returns BOTH the parsed result AND the raw JSON string so callers can
 * persist it on `payout_documents.ocr_raw` for debugging low-confidence rows.
 *
 * formaggi-89172: also extracts per-line structured items (name, qty,
 * unitPrice, subtotal, category) so we can later aggregate average pizza
 * prices by country/city. Stored on `payout_documents.ocr_line_items` JSONB.
 */

import sharp from 'sharp';
import { getOpenAI } from '../lib/openai.js';
import { getCountryCode } from '../lib/countryCode.js';
import { getLlmModels } from '../lib/privateConfig.js';
import { sanitizePgString } from '../lib/sanitizePg.js';

// formaggi-89172: allowed categories. Keep in sync with the system prompt
// and the sanitizer below. `other` is the safe fallback for anything else.
const ALLOWED_CATEGORIES = [
  'pizza',
  'drink',
  'side',
  'dessert',
  'tax',
  'tip',
  'fee',
  'other',
] as const;
export type OcrLineItemCategory = (typeof ALLOWED_CATEGORIES)[number];

export interface OcrLineItem {
  name: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  category: OcrLineItemCategory;
}

export interface OcrResult {
  // mortadella-92103: currency can now be null when the receipt is ambiguous
  // (`$` symbol with no surrounding country/locale hint). Callers must treat
  // a null currency as "do not auto-convert" — `convertToUSD` will return
  // CURRENCY_UNRESOLVED instead of a passthrough.
  amount: number;
  currency: string | null;
  confidence: number;
  items?: string[];
  // formaggi-89172: new — structured line items + merchant/date for analytics.
  lineItems?: OcrLineItem[];
  merchant?: string | null;
  receiptDate?: string | null;
  // stracciatella-92114: optional model-supplied locator ("left half" / "top")
  // so the host can map each detected receipt back to its position in a
  // multi-receipt photo. Null for single-receipt images / older callers.
  boundingHint?: string | null;
  // bruschetta-58519: ISO-639-1 code of the receipt's PRINTED language
  // ("en","es","ja","uk"...); null if undeterminable. Lowercased.
  language?: string | null;
  // bruschetta-58519: ONE short ENGLISH sentence (≤140 chars from the model,
  // hard-capped 280) describing what the receipt is for, regardless of the
  // receipt's printed language. Null if undeterminable.
  summary?: string | null;
  raw: unknown;
}

// stracciatella-92114: hard caps to keep the multi-receipt prompt from
// blowing the token budget. A single photo realistically holds a handful of
// receipts; cap defensively and truncate per-receipt line items.
const MAX_DETECTED_RECEIPTS = 10;
const MAX_LINE_ITEMS_PER_RECEIPT = 60;

// bruschetta-58519 (Part A): downscale + auto-rotate target for the vision call.
// gpt-4o's high-detail tiling tops out well below this; 1568px on the long edge
// is OpenAI's recommended max useful dimension and shrinks tokens/cost without
// losing legibility. JPEG q85 is a good size/quality tradeoff for receipts.
const OCR_MAX_DIMENSION = 1568;
const OCR_JPEG_QUALITY = 85;

// bruschetta-58519 (Part C): sum(lineItems) vs reported amount cross-check.
// If the summed subtotals diverge from the grand total by more than this
// fraction, the extraction is suspect → clamp confidence so the row routes to
// low-confidence review AND triggers the cheap→strong model escalation.
const LINE_ITEM_SUM_TOLERANCE = 0.2;
// Confidence ceiling applied when the sum/total cross-check fails.
const LINE_ITEM_MISMATCH_CONFIDENCE_CAP = 0.49;

// mortadella-92103: ISO-2 country → primary ISO-4217 currency. Used as a
// strong currency prior when the receipt symbol is ambiguous (most LATAM
// countries use `$`, which OCR otherwise misreads as USD). Keep this list
// conservative — only include codes where there's a single dominant
// currency. Multi-currency regions (EU members → EUR is fine; UA → UAH is
// fine; but countries with significant dollarization like Lebanon are
// intentionally omitted).
export const COUNTRY_TO_PRIMARY_CURRENCY: Record<string, string> = {
  // North America
  US: 'USD', CA: 'CAD', MX: 'MXN',
  // LATAM (the actual problem set — `$` ambiguity)
  AR: 'ARS', BO: 'BOB', BR: 'BRL', CL: 'CLP', CO: 'COP', CR: 'CRC',
  DO: 'DOP', EC: 'USD', GT: 'GTQ', HN: 'HNL', NI: 'NIO', PA: 'USD',
  PE: 'PEN', PY: 'PYG', SV: 'USD', UY: 'UYU', VE: 'VES',
  // Eurozone (EUR — €, but receipts in some regions still use `$` or `S`)
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR',
  LT: 'EUR', LU: 'EUR', LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR',
  SI: 'EUR', SK: 'EUR',
  // Rest of Europe
  GB: 'GBP', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', IS: 'ISK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD',
  UA: 'UAH', TR: 'TRY',
  // Asia-Pacific
  CN: 'CNY', JP: 'JPY', KR: 'KRW', IN: 'INR', ID: 'IDR', MY: 'MYR',
  PH: 'PHP', SG: 'SGD', TH: 'THB', VN: 'VND', TW: 'TWD', HK: 'HKD',
  AU: 'AUD', NZ: 'NZD', PK: 'PKR', BD: 'BDT', LK: 'LKR',
  // Middle East
  AE: 'AED', SA: 'SAR', IL: 'ILS', QA: 'QAR', KW: 'KWD', BH: 'BHD',
  // Africa
  EG: 'EGP', NG: 'NGN', ZA: 'ZAR', KE: 'KES', GH: 'GHS', MA: 'MAD',
  TN: 'TND', ET: 'ETB', UG: 'UGX', TZ: 'TZS', MW: 'MWK',
  // salame-92107: West African CFA franc (XOF) — 8 UEMOA members.
  BJ: 'XOF', BF: 'XOF', CI: 'XOF', GW: 'XOF', ML: 'XOF', NE: 'XOF',
  SN: 'XOF', TG: 'XOF',
  // salame-92107: Central African CFA franc (XAF) — 6 CEMAC members.
  CM: 'XAF', CF: 'XAF', TD: 'XAF', GQ: 'XAF', GA: 'XAF', CG: 'XAF',
};

export function buildSystemPrompt(partyCountry?: string | null): string {
  const base = `You are a receipt analysis assistant. Extract the total amount and per-line items from the receipt image.
Return ONLY a JSON object with these fields:
- amount: number (the total amount paid, as a decimal number)
- currency: string (USD, EUR, INR, etc. - the ISO-4217 code as printed/implied by the receipt). If the currency is genuinely ambiguous (e.g. just a "$" symbol with no surrounding country/locale hint and no party-country prior), return "UNKNOWN". DO NOT default to USD when uncertain — "UNKNOWN" is correct.
- confidence: number (0-1, your confidence in the total extraction)
- merchant: string (restaurant/store name if visible, else null)
- receiptDate: string (YYYY-MM-DD if visible, else null)
- language: string (ISO-639-1 code of the receipt's PRINTED language, e.g. "en", "es", "ja", "uk"; null if you cannot determine it)
- summary: string (ONE short sentence IN ENGLISH, at most 140 characters, describing what was purchased / what this receipt is for — ALWAYS in English regardless of the receipt's printed language; null if undeterminable)
- lineItems: Array<{
    name: string,            // the item as printed on the receipt
    qty: number,             // quantity (default 1 if not visible)
    unitPrice: number,       // price per unit in the receipt's currency (use amount field's currency)
    subtotal: number,        // total for this line (qty * unitPrice, or what's printed)
    category: "pizza" | "drink" | "side" | "dessert" | "tax" | "tip" | "fee" | "other"
  }>
- items: string[] (legacy fallback — flat list of item names; will be deprecated)

Be exhaustive with lineItems — extract every line on the receipt. If a line is illegible, set name to "[illegible]" and other numeric fields to 0.
Use your best judgment for category. Default "other".
If the receipt is unreadable, return lineItems: [] and confidence: 0.

Always return valid JSON.`;

  // mortadella-92103: country prior. When the host's event has a known country
  // and that country has a single dominant ISO-4217 currency, prefer it for
  // ambiguous-symbol receipts (the `$` problem in MX/AR/CL/CO/UY/...).
  // calzone-58294: `parties.country` stores full English names (e.g. "Togo"),
  // not ISO-2. Naively slicing the first 2 chars mis-keyed the lookup
  // ("Togo"->"TO"=Tonga, "Mexico"->"ME"=Montenegro, "United States"->"UN") so
  // the prior never fired. Reuse the canonical name->ISO-2 normalizer, and keep
  // a back-compat fallback for any legacy caller that passes a bare ISO-2 code.
  const raw = typeof partyCountry === 'string' ? partyCountry.trim() : '';
  const code =
    getCountryCode(raw) ??
    (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : '');
  const primary = code ? COUNTRY_TO_PRIMARY_CURRENCY[code] : undefined;
  if (code && primary) {
    return `${base}\n\nContext: this receipt is from ${code}; the primary currency in ${code} is ${primary}. If the printed currency symbol is ambiguous (e.g. just "$"), prefer ${primary}. Only return USD if the receipt clearly shows USD (e.g. "USD", "US$", or an unambiguous US-based merchant).`;
  }
  return base;
}

/**
 * stracciatella-92114: multi-receipt system prompt. A single uploaded photo
 * may contain MULTIPLE separate receipts (e.g. two pizza receipts side by
 * side). This prompt asks the model to return `{ "receipts": Receipt[] }`
 * where each Receipt has the SAME fields as the single-receipt prompt, plus an
 * optional `boundingHint` locator.
 *
 * Bias = UNDER-SPLIT (locked decision): when the model is unsure whether
 * something is one receipt or two, it MUST treat it as ONE. The host can
 * manually split later; over-splitting double-counts money, which is worse.
 *
 * Reuses the same country-prior context block as the single-receipt prompt so
 * ambiguous `$` symbols still resolve to the local currency.
 */
export function buildMultiSystemPrompt(partyCountry?: string | null): string {
  // Reuse the single-receipt prompt's field contract + country prior, then
  // wrap it in the multi-receipt envelope + under-split instructions.
  const single = buildSystemPrompt(partyCountry);

  const multi = `You are a receipt analysis assistant. The uploaded image MAY contain MULTIPLE separate receipts (for example two pizza receipts photographed side by side, or stacked).

Return ONLY a JSON object of the form:
{ "receipts": Receipt[] }

Each Receipt object has EXACTLY the fields described below (amount, currency, confidence, merchant, receiptDate, language, summary, lineItems, items), PLUS one optional field:
- boundingHint: string | null (a short human locator for where this receipt sits in the image, e.g. "left half", "top", "right receipt". Null if there is only one receipt or you can't tell.)

CRITICAL splitting rules (UNDER-SPLIT — when unsure, MERGE):
- Return one Receipt per DISTINCT transaction / DISTINCT grand total.
- If pieces of the image clearly belong to the SAME transaction (same merchant header, a continuous list of items, a single grand total spanning them), MERGE them into ONE Receipt. NEVER double-count the same purchase.
- When you are UNSURE whether you are looking at one receipt or two, prefer treating it as ONE receipt.
- If the image contains exactly one receipt, return an array of ONE Receipt.
- If NO legible receipt is present, return { "receipts": [] }.

The per-Receipt field contract (fields, currency rules, lineItems schema, country prior) is exactly as follows:

${single}

Reminder: wrap the result as { "receipts": [ ... ] }. Always return valid JSON.`;

  return multi;
}

/**
 * Fetch an image from a public URL and convert to a base64 data URL.
 * Suitable for passing as `image_url.url` to OpenAI vision endpoints.
 */
async function imageUrlToBase64DataUrl(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch image (HTTP ${response.status}) from ${imageUrl}`);
  }
  const arrayBuf = await response.arrayBuffer();
  const originalContentType = response.headers.get('content-type') || 'image/jpeg';
  const originalBuf = Buffer.from(arrayBuf);

  // bruschetta-58519 (Part A): downscale + auto-rotate before sending to the
  // vision model. `.rotate()` (no arg) applies the EXIF orientation so sideways
  // phone photos read upright; resize-inside caps the long edge at 1568px; jpeg
  // q85 shrinks the payload. Cheaper tokens + more reliable extraction.
  //
  // LANDMINE: sharp CANNOT decode HEIC on Vercel (libheif not bundled). ANY
  // failure here MUST fall back to the ORIGINAL bytes + content-type so OCR
  // still runs — preprocessing must never break extraction.
  try {
    const processed = await sharp(originalBuf)
      .rotate()
      .resize({
        width: OCR_MAX_DIMENSION,
        height: OCR_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: OCR_JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${processed.toString('base64')}`;
  } catch (err) {
    // sharp couldn't decode (HEIC/HDR/corrupt) — send the original untouched.
    console.warn(
      `[ocr] sharp preprocess failed for ${imageUrl}; falling back to original bytes (${originalContentType}):`,
      err instanceof Error ? err.message : err,
    );
    return `data:${originalContentType};base64,${originalBuf.toString('base64')}`;
  }
}

/**
 * formaggi-89172: defensively sanitize the model's `lineItems` array.
 * Drops rows that don't have at least a name; clamps numeric fields to
 * non-negative finite numbers; coerces category into the allowed enum.
 */
function sanitizeLineItems(raw: unknown): OcrLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OcrLineItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    // Name is required; coerce non-strings, fall back to placeholder.
    // fontina-58504: sanitize NUL / unpaired surrogates so the line-item name
    // can't 500 the payout_documents JSONB insert (mirrors stracchino-49640).
    const rawName = e.name;
    const name = typeof rawName === 'string' && rawName.trim().length > 0
      ? sanitizePgString(rawName.trim())
      : '[illegible]';

    const qtyNum = Number(e.qty);
    const qty = Number.isFinite(qtyNum) && qtyNum >= 0 ? qtyNum : 1;

    const unitNum = Number(e.unitPrice);
    const unitPrice = Number.isFinite(unitNum) && unitNum >= 0 ? unitNum : 0;

    const subNum = Number(e.subtotal);
    const subtotal = Number.isFinite(subNum) && subNum >= 0
      ? subNum
      : qty * unitPrice;

    const rawCategory = typeof e.category === 'string'
      ? e.category.toLowerCase().trim()
      : 'other';
    const category: OcrLineItemCategory = (ALLOWED_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as OcrLineItemCategory)
      : 'other';

    out.push({ name, qty, unitPrice, subtotal, category });
  }
  return out;
}

/**
 * Send a receipt image to OpenAI gpt-4o vision and parse the response.
 * Does NOT do currency conversion — call `convertToUSD` separately.
 *
 * Throws on network/auth/parse errors. Callers (e.g. the bulk endpoint) should
 * wrap in `Promise.allSettled` so one bad receipt doesn't fail the whole batch.
 */
/**
 * mortadella-92103: now accepts an optional `partyCountry` (a full English
 * country name as stored on `parties.country`, e.g. "Togo", or a bare ISO-2
 * code). When the receipt symbol is ambiguous, the country prior steers OCR
 * toward the local primary currency instead of silently defaulting to USD.
 * calzone-58294: normalized via getCountryCode so full names resolve correctly.
 *
 * Back-compat shim: callers passing a string (legacy `analyzeReceipt(url)`)
 * still work — the function accepts either a string or `{ imageUrl, partyCountry }`.
 */
/**
 * Parse + sanitize a SINGLE receipt object (the gpt-4o per-receipt shape) into
 * an `OcrResult`. Extracted from the old `analyzeReceipt` body so both the
 * single-receipt and multi-receipt code paths share identical sanitization.
 *
 * Throws if the object is missing a finite `amount` (mirrors the historical
 * single-receipt contract). The multi-receipt caller catches per-receipt so
 * one bad element doesn't fail the whole image.
 */
export function parseSingleReceipt(parsed: any): OcrResult {
  // Validate minimum shape
  const amount = typeof parsed?.amount === 'number' ? parsed.amount : Number(parsed?.amount);
  // mortadella-92103: do NOT default to USD on ambiguity. When the model
  // returns missing/empty/'UNKNOWN' currency, surface `null` so the caller
  // refuses to auto-convert (CURRENCY_UNRESOLVED on the doc; admin/host must
  // pick the correct code via the override dropdown).
  const rawCurrency = typeof parsed?.currency === 'string' ? parsed.currency.trim() : '';
  const currency: string | null =
    rawCurrency.length === 0 || rawCurrency.toUpperCase() === 'UNKNOWN'
      ? null
      : rawCurrency;
  const modelConfidence = typeof parsed?.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;
  // Clamp confidence to 0.49 when currency is unresolved so the UI consistently
  // surfaces it as "low" and asks for review. bruschetta-58519: this is the
  // pre-sum-check confidence; the Part-C line-item cross-check may clamp it
  // further below (after lineItems are computed).
  const confidenceBeforeSumCheck = currency === null ? Math.min(modelConfidence, 0.49) : modelConfidence;

  if (!Number.isFinite(amount)) {
    throw new Error(`OpenAI returned non-numeric amount: ${JSON.stringify(parsed)}`);
  }

  // formaggi-89172: merchant + receiptDate are best-effort. Coerce missing/
  // empty strings to null so the JSONB row has consistent shape.
  // fontina-58504: run free-form model strings through sanitizePgString at the
  // source so every consumer that persists ocr.merchant / ocr.boundingHint to
  // payout_documents gets NUL/surrogate-free values (mirrors stracchino-49640).
  const merchant = typeof parsed?.merchant === 'string' && parsed.merchant.trim().length > 0
    ? sanitizePgString(parsed.merchant.trim())
    : null;
  const receiptDate = typeof parsed?.receiptDate === 'string' && parsed.receiptDate.trim().length > 0
    ? parsed.receiptDate.trim()
    : null;
  // stracciatella-92114: optional locator for multi-receipt photos.
  const boundingHint = typeof parsed?.boundingHint === 'string' && parsed.boundingHint.trim().length > 0
    ? sanitizePgString(parsed.boundingHint.trim().slice(0, 120))
    : null;

  // bruschetta-58519 (Part B): receipt language (ISO-639-1) + English summary.
  // Sanitize free-form model strings (NUL/surrogate JSONB-500 guard), lowercase
  // the language code, and hard-cap the summary at 280 chars (the model is asked
  // for ≤140 but we defend against runaway output before it hits ocr_summary).
  const rawLanguage = typeof parsed?.language === 'string' ? parsed.language.trim() : '';
  const language: string | null =
    rawLanguage.length > 0 ? sanitizePgString(rawLanguage.toLowerCase()) : null;
  const rawSummary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  const summary: string | null =
    rawSummary.length > 0 ? sanitizePgString(rawSummary.slice(0, 280)) : null;

  // stracciatella-92114: truncate per-receipt line items to keep token + DB
  // sizes bounded when several receipts share one image.
  const lineItems = sanitizeLineItems(parsed?.lineItems).slice(0, MAX_LINE_ITEMS_PER_RECEIPT);

  // bruschetta-58519 (Part C): sum(lineItems) ≈ amount cross-check. When we have
  // both line items and a positive total, a large divergence between the summed
  // subtotals and the reported grand total signals a misread total (or missed
  // lines). Clamp confidence so the row routes to low-confidence review and the
  // cheap→strong model escalation fires. We deliberately do NOT mutate `amount`
  // — the model's grand total is usually the most reliable single number, and we
  // never want a silent money change.
  let confidence = confidenceBeforeSumCheck;
  if (lineItems.length > 0 && amount > 0) {
    const sum = lineItems.reduce((acc, li) => acc + (Number.isFinite(li.subtotal) ? li.subtotal : 0), 0);
    if (Math.abs(sum - amount) / amount > LINE_ITEM_SUM_TOLERANCE) {
      confidence = Math.min(confidence, LINE_ITEM_MISMATCH_CONFIDENCE_CAP);
    }
  }

  return {
    amount,
    currency,
    confidence,
    items: Array.isArray(parsed?.items)
      ? parsed.items.filter((s: unknown): s is string => typeof s === 'string').map((s: string) => sanitizePgString(s))
      : undefined,
    lineItems,
    merchant,
    receiptDate,
    boundingHint,
    language,
    summary,
    raw: parsed,
  };
}

/**
 * stracciatella-92114: multi-receipt OCR. Sends the image to gpt-4o asking for
 * `{ receipts: Receipt[] }` and returns ONE `OcrResult` per detected receipt
 * (capped at `MAX_DETECTED_RECEIPTS`). Under-split bias lives in the prompt.
 *
 * Robustness:
 * - If the model returns a bare legacy single-receipt object (no `receipts`
 *   key), it's wrapped as a single-element array.
 * - Each receipt is parsed independently; an individual element that fails
 *   sanitization (e.g. non-numeric amount) is skipped rather than failing the
 *   whole image.
 * - No legible receipt → empty array. The route maps that to
 *   `NO_RECEIPT_DETECTED`.
 *
 * Does NOT do currency conversion — call `convertToUSD` per element.
 * Throws only on network/auth/non-JSON errors (parity with `analyzeReceipt`).
 */
/**
 * bruschetta-58519 (Part D): strict Structured-Outputs JSON schema for the
 * multi-receipt envelope `{ receipts: Receipt[] }`. Strict mode requires:
 *   - `additionalProperties: false` on EVERY object,
 *   - EVERY property listed in `required`,
 *   - nullable fields typed as `["string","null"]` / `["number","null"]`.
 * The model is forced to emit exactly this shape; our bare-object/bare-array
 * fallback in the parser stays as insurance against provider drift.
 */
const RECEIPTS_JSON_SCHEMA: {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
} = {
  name: 'receipts_envelope',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['receipts'],
    properties: {
      receipts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'amount',
            'currency',
            'confidence',
            'merchant',
            'receiptDate',
            'boundingHint',
            'language',
            'summary',
            'lineItems',
            'items',
          ],
          properties: {
            amount: { type: 'number' },
            currency: { type: ['string', 'null'] },
            confidence: { type: 'number' },
            merchant: { type: ['string', 'null'] },
            receiptDate: { type: ['string', 'null'] },
            boundingHint: { type: ['string', 'null'] },
            language: { type: ['string', 'null'] },
            summary: { type: ['string', 'null'] },
            lineItems: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'qty', 'unitPrice', 'subtotal', 'category'],
                properties: {
                  name: { type: 'string' },
                  qty: { type: 'number' },
                  unitPrice: { type: 'number' },
                  subtotal: { type: 'number' },
                  category: {
                    type: 'string',
                    enum: [...ALLOWED_CATEGORIES],
                  },
                },
              },
            },
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

/**
 * bruschetta-58519 (Part E): run ONE vision pass with a specific model and
 * return the parsed `OcrResult[]`. Shared by the cheap first pass and the
 * strong escalation pass so both use the identical prompt + strict schema +
 * normalization/fallback logic.
 */
async function runOcrPass(
  model: string,
  base64Image: string,
  partyCountry: string | null,
): Promise<OcrResult[]> {
  const response = await getOpenAI().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildMultiSystemPrompt(partyCountry) },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'This image may contain one or more receipts. Extract each distinct receipt, following the under-split rules. Return { "receipts": [...] }.',
          },
          { type: 'image_url', image_url: { url: base64Image } },
        ],
      },
    ],
    // stracciatella-92114: bumped 1500 → 4000 to fit multiple receipts each
    // with their own per-line items array without mid-JSON truncation.
    max_tokens: 4000,
    // bruschetta-58519 (Part D): strict Structured Outputs. The bare-object /
    // bare-array parse fallback below remains as insurance.
    response_format: {
      type: 'json_schema',
      json_schema: RECEIPTS_JSON_SCHEMA,
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response content from OpenAI');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`OpenAI returned non-JSON content: ${content.slice(0, 200)}`);
  }

  // Normalize to an array of raw receipt objects.
  let rawReceipts: any[];
  if (Array.isArray(parsed?.receipts)) {
    rawReceipts = parsed.receipts;
  } else if (Array.isArray(parsed)) {
    // Model returned a bare array.
    rawReceipts = parsed;
  } else if (parsed && typeof parsed === 'object') {
    // Robustness: model ignored the envelope and returned a bare legacy
    // single-receipt object. Wrap it as a single-element array.
    rawReceipts = [parsed];
  } else {
    rawReceipts = [];
  }

  const capped = rawReceipts.slice(0, MAX_DETECTED_RECEIPTS);
  const out: OcrResult[] = [];
  for (const r of capped) {
    try {
      out.push(parseSingleReceipt(r));
    } catch {
      // Skip an unparseable element; keep siblings. An entirely empty result
      // is surfaced as NO_RECEIPT_DETECTED by the route.
    }
  }
  return out;
}

/**
 * bruschetta-58519 (Part E): decide whether the cheap first pass is weak enough
 * to justify re-running on the stronger model. ESCALATE when ANY parsed receipt
 * has a missing/non-positive amount, null currency, sub-0.6 confidence (which
 * also captures the Part-C sum/total mismatch, since that clamps confidence to
 * 0.49), OR when zero receipts were parsed at all.
 */
function shouldEscalateOcr(results: OcrResult[]): boolean {
  if (results.length === 0) return true;
  return results.some(
    (r) =>
      !(typeof r.amount === 'number' && r.amount > 0) ||
      r.currency === null ||
      r.confidence < 0.6,
  );
}

export async function analyzeReceiptMulti(
  arg: string | { imageUrl: string; partyCountry?: string | null },
): Promise<OcrResult[]> {
  const imageUrl = typeof arg === 'string' ? arg : arg.imageUrl;
  const partyCountry = typeof arg === 'string' ? null : (arg.partyCountry ?? null);
  const base64Image = await imageUrlToBase64DataUrl(imageUrl);
  const models = await getLlmModels();

  // bruschetta-58519 (Part E): cost routing. First pass on the cheap model;
  // escalate to the strong `ocr` model only when the cheap result looks weak.
  // KILL SWITCH: when app_config sets `llm.models.ocrCheap` == `ocr` ("gpt-4o"),
  // the first pass is already strong, so nothing escalates — routing is
  // effectively disabled with no deploy.
  const firstPass = await runOcrPass(models.ocrCheap, base64Image, partyCountry);

  if (models.ocrCheap !== models.ocr && shouldEscalateOcr(firstPass)) {
    try {
      return await runOcrPass(models.ocr, base64Image, partyCountry);
    } catch (err) {
      // Escalation failed (network/auth/parse) — keep the cheap result rather
      // than failing the whole image.
      console.warn(
        `[ocr] escalation to ${models.ocr} failed for ${imageUrl}; keeping cheap (${models.ocrCheap}) result:`,
        err instanceof Error ? err.message : err,
      );
      return firstPass;
    }
  }

  return firstPass;
}

/**
 * Send a single receipt image to gpt-4o and return ONE `OcrResult`.
 *
 * stracciatella-92114: now a thin wrapper over `analyzeReceiptMulti` that
 * returns the FIRST detected receipt — preserving the historical single-object
 * contract for every existing caller (admin retry/re-OCR, line-item backfill,
 * the FX-trusted fast path). When the image has multiple receipts this returns
 * only the first; multi-detection happens exclusively at original upload via
 * `analyzeReceiptMulti`. When NO receipt is legible, returns a NO_RECEIPT-style
 * empty result ($0, null currency, confidence 0) rather than throwing — mirrors
 * the way the rest of the pipeline signals an OCR miss via the row's amount.
 */
export async function analyzeReceipt(
  arg: string | { imageUrl: string; partyCountry?: string | null },
): Promise<OcrResult> {
  const results = await analyzeReceiptMulti(arg);
  if (results.length === 0) {
    return {
      amount: 0,
      currency: null,
      confidence: 0,
      items: undefined,
      lineItems: [],
      merchant: null,
      receiptDate: null,
      boundingHint: null,
      language: null,
      summary: null,
      raw: { receipts: [] },
    };
  }
  return results[0];
}
