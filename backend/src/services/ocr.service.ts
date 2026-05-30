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

import { getOpenAI } from '../lib/openai.js';

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
  raw: unknown;
}

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

function buildSystemPrompt(partyCountry?: string | null): string {
  const base = `You are a receipt analysis assistant. Extract the total amount and per-line items from the receipt image.
Return ONLY a JSON object with these fields:
- amount: number (the total amount paid, as a decimal number)
- currency: string (USD, EUR, INR, etc. - the ISO-4217 code as printed/implied by the receipt). If the currency is genuinely ambiguous (e.g. just a "$" symbol with no surrounding country/locale hint and no party-country prior), return "UNKNOWN". DO NOT default to USD when uncertain — "UNKNOWN" is correct.
- confidence: number (0-1, your confidence in the total extraction)
- merchant: string (restaurant/store name if visible, else null)
- receiptDate: string (YYYY-MM-DD if visible, else null)
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
  const code = typeof partyCountry === 'string'
    ? partyCountry.trim().toUpperCase().slice(0, 2)
    : '';
  const primary = code ? COUNTRY_TO_PRIMARY_CURRENCY[code] : undefined;
  if (code && primary) {
    return `${base}\n\nContext: this receipt is from ${code}; the primary currency in ${code} is ${primary}. If the printed currency symbol is ambiguous (e.g. just "$"), prefer ${primary}. Only return USD if the receipt clearly shows USD (e.g. "USD", "US$", or an unambiguous US-based merchant).`;
  }
  return base;
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
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return `data:${contentType};base64,${base64}`;
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
    const rawName = e.name;
    const name = typeof rawName === 'string' && rawName.trim().length > 0
      ? rawName.trim()
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
 * mortadella-92103: now accepts an optional `partyCountry` (ISO-2). When the
 * receipt symbol is ambiguous, the country prior steers OCR toward the local
 * primary currency instead of silently defaulting to USD.
 *
 * Back-compat shim: callers passing a string (legacy `analyzeReceipt(url)`)
 * still work — the function accepts either a string or `{ imageUrl, partyCountry }`.
 */
export async function analyzeReceipt(
  arg: string | { imageUrl: string; partyCountry?: string | null },
): Promise<OcrResult> {
  const imageUrl = typeof arg === 'string' ? arg : arg.imageUrl;
  const partyCountry = typeof arg === 'string' ? null : (arg.partyCountry ?? null);
  const base64Image = await imageUrlToBase64DataUrl(imageUrl);

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: buildSystemPrompt(partyCountry) },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the total amount and per-line items from this receipt.' },
          { type: 'image_url', image_url: { url: base64Image } },
        ],
      },
    ],
    // formaggi-89172: bumped from 500 → 1500 to fit the per-line items array.
    // Receipts with 10–20 lines were getting truncated mid-JSON otherwise.
    max_tokens: 1500,
    response_format: { type: 'json_object' },
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

  // Validate minimum shape
  const amount = typeof parsed.amount === 'number' ? parsed.amount : Number(parsed.amount);
  // mortadella-92103: do NOT default to USD on ambiguity. When the model
  // returns missing/empty/'UNKNOWN' currency, surface `null` so the caller
  // refuses to auto-convert (CURRENCY_UNRESOLVED on the doc; admin/host must
  // pick the correct code via the override dropdown).
  const rawCurrency = typeof parsed.currency === 'string' ? parsed.currency.trim() : '';
  const currency: string | null =
    rawCurrency.length === 0 || rawCurrency.toUpperCase() === 'UNKNOWN'
      ? null
      : rawCurrency;
  const modelConfidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;
  // Clamp confidence to 0.49 when currency is unresolved so the UI consistently
  // surfaces it as "low" and asks for review.
  const confidence = currency === null ? Math.min(modelConfidence, 0.49) : modelConfidence;

  if (!Number.isFinite(amount)) {
    throw new Error(`OpenAI returned non-numeric amount: ${JSON.stringify(parsed)}`);
  }

  // formaggi-89172: merchant + receiptDate are best-effort. Coerce missing/
  // empty strings to null so the JSONB row has consistent shape.
  const merchant = typeof parsed.merchant === 'string' && parsed.merchant.trim().length > 0
    ? parsed.merchant.trim()
    : null;
  const receiptDate = typeof parsed.receiptDate === 'string' && parsed.receiptDate.trim().length > 0
    ? parsed.receiptDate.trim()
    : null;

  return {
    amount,
    currency,
    confidence,
    items: Array.isArray(parsed.items) ? parsed.items.filter((s: unknown) => typeof s === 'string') : undefined,
    lineItems: sanitizeLineItems(parsed.lineItems),
    merchant,
    receiptDate,
    raw: parsed,
  };
}
