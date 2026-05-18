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
 */

import { getOpenAI } from '../lib/openai.js';

export interface OcrResult {
  amount: number;
  currency: string;
  confidence: number;
  items?: string[];
  raw: unknown;
}

const SYSTEM_PROMPT = `You are a receipt analysis assistant. Extract the total amount from the receipt image.
Return ONLY a JSON object with these fields:
- amount: number (the total amount paid, as a decimal number)
- currency: string (USD, EUR, etc. - default to USD if unclear)
- confidence: number (0-1, your confidence in the extraction)
- items: string[] (optional list of food items if visible)

If you cannot determine the total, estimate from visible items. Always return valid JSON.`;

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
 * Send a receipt image to OpenAI gpt-4o vision and parse the response.
 * Does NOT do currency conversion — call `convertToUSD` separately.
 *
 * Throws on network/auth/parse errors. Callers (e.g. the bulk endpoint) should
 * wrap in `Promise.allSettled` so one bad receipt doesn't fail the whole batch.
 */
export async function analyzeReceipt(imageUrl: string): Promise<OcrResult> {
  const base64Image = await imageUrlToBase64DataUrl(imageUrl);

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract the total amount from this receipt.' },
          { type: 'image_url', image_url: { url: base64Image } },
        ],
      },
    ],
    max_tokens: 500,
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
  const currency = typeof parsed.currency === 'string' && parsed.currency.length > 0
    ? parsed.currency
    : 'USD';
  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0;

  if (!Number.isFinite(amount)) {
    throw new Error(`OpenAI returned non-numeric amount: ${JSON.stringify(parsed)}`);
  }

  return {
    amount,
    currency,
    confidence,
    items: Array.isArray(parsed.items) ? parsed.items.filter((s: unknown) => typeof s === 'string') : undefined,
    raw: parsed,
  };
}
