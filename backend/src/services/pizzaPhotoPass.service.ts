/**
 * sfincione-40417: photo size pass for the Pizza Price Index.
 *
 * Per party: send gpt-4o (`getLlmModels().visionPrimary`) the party's pizza
 * photos (payout `kind='pizza'` uploads first, then approved gallery photos)
 * plus its still-unsized pizza lines, and ask for the pizza's size as a RATIO
 * to an allowed reference object (plates, cans, phones; never boxes). The
 * diameter is computed here, and estimates with an implausible USD/cm^2 dropped.
 *
 * The result is only a SUGGESTION: it is stored in `pizza_line_items.photo_estimate`
 * and never written to diameter_cm / area_cm2, so it can't reach the index until
 * a reviewer accepts it in the queue (which makes it a manual, verified size).
 * Pure prompt/parse helpers are exported for tests; runPhotoPass is the driver.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { getOpenAI } from '../lib/openai.js';
import { getLlmModels } from '../lib/privateConfig.js';
import { imageUrlToBase64DataUrl } from './ocr.service.js';

export const PHOTO_CONFIDENCE_CAP = 0.6;
export const MAX_PHOTOS_PER_PARTY = 6;
const MAX_LINES_PER_PARTY = 40;
const MAX_REFERENCE_LINES = 10;
/** Formats the vision model accepts (HEIC etc. would fail the whole request). */
const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_ATTEMPTS = 3;

export interface PhotoEstimate {
  shape: 'round' | 'rect';
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  confidence: number;
  photoUrl: string | null;
  note: string;
  model: string;
  at: string;
}

export interface PhotoPassLine {
  i: number;
  photo: number | null;
  shape: 'round' | 'rect';
  diameterCm: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  confidence: number;
  note: string;
}

/**
 * Scale references the model may measure against (cm). Pizza boxes are NOT on
 * the list: a box is sized to its pizza, so "measured against the box" is
 * circular, and the first prod run showed it collapsing to a default 30 cm.
 */
export const REFERENCE_SIZES_CM = {
  dinner_plate: 26,
  side_plate: 20,
  can_height: 12.2,
  can_width: 6.6,
  bottle_500ml_height: 21,
  bottle_1500ml_height: 32,
  palm_width: 8.5,
  phone_length: 15,
  a4_long_side: 29.7,
  standard_door_width: 85,
} as const;
export type ReferenceKey = keyof typeof REFERENCE_SIZES_CM;

/** Plausible USD per cm^2 (same band as the review editor's sanity warning). */
export const SANE_USD_PER_CM2 = { min: 0.002, max: 0.2 } as const;

export const PHOTO_PASS_SYSTEM = `You MEASURE pizzas in event photos against a known reference object, for a pizza price study.
You get the event's country, the pizzeria (if known), the receipt's pizza lines with NO known size (index i, name, qty, unit price, currency, unitPriceUsd), some lines from the same event whose size IS known, and up to 6 photos numbered 0..n-1 in the order given.
Allowed reference objects (key: real size): ${Object.entries(REFERENCE_SIZES_CM).map(([k, v]) => `${k} ${v} cm`).join(', ')}.
For a line you can measure: pick ONE reference object that is in the same photo, close to the pizza and at a similar distance from the camera, and report "ratio" = pizza diameter / reference size (for rectangular pizzas "lengthRatio" and "widthRatio"). Do the comparison visually, step by step; do NOT start from a typical pizza size.
Rules:
- Measure only a WHOLE (or nearly whole) pizza seen from above or at a moderate angle. A single slice, a half-eaten pie, an empty box, or a pizza far in the background cannot be measured: set "wholePizzaVisible": false and return null.
- NEVER use a pizza box, another pizza, or a typical size as the reference. If no allowed reference is clearly visible next to the pizza, return null for that line. Null is the right answer for most crowd shots.
- Match pizzas to lines carefully. If the photos show pizzas of clearly different sizes, larger pizzas belong to higher-priced lines. A giant party pizza is not the same pizza as a cheap menu line.
- confidence 0..1: how sure you are of the measurement (most should be 0.3-0.6).
- photo: the photo index you measured in. note: at most 80 characters saying what you compared.
Return ONLY JSON: { "lines": [ { "i": number, "photo": number|null, "wholePizzaVisible": boolean, "ref": string|null, "shape": "round"|"rect"|null, "ratio": number|null, "lengthRatio": number|null, "widthRatio": number|null, "confidence": number, "note": string } ] }`;

const dim = (v: number, min: number, max: number): number | null =>
  Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 10) / 10 : null;
const pos = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

/**
 * Tolerant parse. Sizes are computed here from ratio x reference size, so the
 * model can't hand back a remembered "typical" diameter; entries without an
 * allowed reference or with an implausible size are dropped.
 */
export function parsePhotoPassResponse(
  content: string | null | undefined,
  validIndexes: Set<number>,
  photoCount: number,
): PhotoPassLine[] {
  if (!content) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const arr: unknown[] = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const out: PhotoPassLine[] = [];
  const seen = new Set<number>();
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const i = Number(r.i);
    if (!Number.isInteger(i) || !validIndexes.has(i) || seen.has(i)) continue;
    // Slices, half-eaten pies and empty boxes measured as "pizzas" were the other prod failure.
    if (r.wholePizzaVisible !== true) continue;
    const ref = typeof r.ref === 'string' && r.ref in REFERENCE_SIZES_CM ? (r.ref as ReferenceKey) : null;
    if (!ref) continue;
    const refCm = REFERENCE_SIZES_CM[ref];
    const p = Number(r.photo);
    const photo = Number.isInteger(p) && p >= 0 && p < photoCount ? p : null;
    const conf = Number(r.confidence);
    const confidence = Math.round(Math.min(Number.isFinite(conf) ? Math.max(conf, 0) : 0.3, PHOTO_CONFIDENCE_CAP) * 100) / 100;
    const note = `${typeof r.note === 'string' ? r.note.slice(0, 80) : ''} [${ref.replace(/_/g, ' ')}]`.trim();
    if (r.shape === 'rect') {
      const lengthCm = dim(pos(r.lengthRatio) * refCm, 10, 200);
      const widthCm = dim(pos(r.widthRatio) * refCm, 10, 200);
      if (lengthCm === null || widthCm === null) continue;
      seen.add(i);
      out.push({ i, photo, shape: 'rect', diameterCm: null, lengthCm, widthCm, confidence, note });
    } else {
      const diameterCm = dim(pos(r.ratio) * refCm, 10, 120);
      if (diameterCm === null) continue;
      seen.add(i);
      out.push({ i, photo, shape: 'round', diameterCm, lengthCm: null, widthCm: null, confidence, note });
    }
  }
  return out;
}

/** Drop an estimate whose implied USD/cm^2 is outside the sanity band (e.g. a giant pizza matched to a cheap line). */
export function priceIsPlausible(l: PhotoPassLine, unitPriceUsd: number): boolean {
  const area = l.shape === 'rect'
    ? (l.lengthCm ?? 0) * (l.widthCm ?? 0)
    : Math.PI * ((l.diameterCm ?? 0) / 2) ** 2;
  if (!(area > 0) || !(unitPriceUsd > 0)) return false;
  const per = unitPriceUsd / area;
  return per >= SANE_USD_PER_CM2.min && per <= SANE_USD_PER_CM2.max;
}

export function toPhotoEstimate(l: PhotoPassLine, photoUrls: string[], model: string, at: Date): PhotoEstimate {
  return {
    shape: l.shape, diameterCm: l.diameterCm, lengthCm: l.lengthCm, widthCm: l.widthCm,
    confidence: l.confidence, photoUrl: l.photo !== null ? photoUrls[l.photo] ?? null : null,
    note: l.note, model, at: at.toISOString(),
  };
}

/** Reads a stored estimate back, or null if missing/malformed. */
export function readPhotoEstimate(v: unknown): PhotoEstimate | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (r.shape !== 'round' && r.shape !== 'rect') return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const est: PhotoEstimate = {
    shape: r.shape, diameterCm: num(r.diameterCm), lengthCm: num(r.lengthCm), widthCm: num(r.widthCm),
    confidence: num(r.confidence) ?? 0, photoUrl: typeof r.photoUrl === 'string' ? r.photoUrl : null,
    note: typeof r.note === 'string' ? r.note : '', model: typeof r.model === 'string' ? r.model : '',
    at: typeof r.at === 'string' ? r.at : '',
  };
  if (est.shape === 'round' ? est.diameterCm === null : est.lengthCm === null || est.widthCm === null) return null;
  return est;
}

// ---------------------------------------------------------------------------
// Photo selection (shared with the review queue)
// ---------------------------------------------------------------------------

/** Pizza-kind payout uploads for each party, oldest first. */
export async function payoutPizzaPhotos(partyIds: string[], perParty: number): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (partyIds.length === 0) return out;
  const rows = await prisma.payoutDocument.findMany({
    where: { kind: 'pizza', partyId: { in: partyIds }, mimeType: { in: PHOTO_MIMES } },
    select: { partyId: true, url: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    const a = out.get(r.partyId) ?? [];
    if (a.length < perParty && !a.includes(r.url)) a.push(r.url);
    out.set(r.partyId, a);
  }
  return out;
}

/** Approved gallery photos, pizza-captioned/tagged first, then starred. */
export async function galleryPhotos(partyIds: string[], perParty: number): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (partyIds.length === 0) return out;
  const rows = await prisma.$queryRaw<Array<{ party_id: string; url: string }>>(Prisma.sql`
    SELECT party_id, url FROM (
      SELECT party_id, url, row_number() OVER (
        PARTITION BY party_id
        ORDER BY (coalesce(caption, '') ILIKE '%pizza%' OR 'pizza' = ANY(tags)) DESC, starred DESC, created_at
      ) AS rn
      FROM photos
      WHERE party_id = ANY(${partyIds}::uuid[]) AND status = 'approved' AND deleted_at IS NULL
        AND mime_type = ANY(${PHOTO_MIMES}::text[])
    ) x WHERE rn <= ${perParty} ORDER BY party_id, rn`);
  for (const r of rows) {
    const a = out.get(r.party_id) ?? [];
    a.push(r.url);
    out.set(r.party_id, a);
  }
  return out;
}

/** Up to `max` photos for one party: payout pizza photos, then gallery fill. */
export function pickPhotos(payout: string[], gallery: string[], max = MAX_PHOTOS_PER_PARTY): string[] {
  const out: string[] = [];
  for (const u of [...payout, ...gallery]) {
    if (out.length >= max) break;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface PhotoPassResult {
  dryRun: boolean;
  model: string;
  candidates: number;
  processed: number;
  remaining: number;
  linesInserted: number;
  linesUpdated: number;
  errors: Array<{ documentId: string; error: string }>;
  partyIds: string[];
  skippedBackoff: number;
}

const NEEDS_SIZE = Prisma.sql`li.area_cm2 IS NULL AND NOT li.excluded AND NOT li.is_bundle
  AND li.verified_at IS NULL AND li.photo_estimate IS NULL
  AND d.is_duplicate = false AND d.ineligible = false`;

/**
 * FROM/WHERE for parties the photo pass should (re)visit: unsized lines with no
 * suggestion, readable photos, and either never passed or a line created/changed
 * since the last pass. `explicit` (admin re-run by id) skips the pass and back-off
 * gates; `scope` is an extra condition on parties alias `p` (underboss scoping).
 */
export function photoCandidatesSql(opts: {
  partyIds?: string[]; explicit?: boolean; backoff?: boolean; scope?: Prisma.Sql;
} = {}): Prisma.Sql {
  const idFilter = opts.partyIds?.length ? Prisma.sql`AND li.party_id = ANY(${opts.partyIds}::uuid[])` : Prisma.empty;
  const passGate = opts.explicit
    ? Prisma.empty
    : Prisma.sql`AND (pp.pass_at IS NULL OR coalesce(li.updated_at, li.created_at) > pp.pass_at)`;
  const backoff = opts.explicit || opts.backoff === false
    ? Prisma.empty
    : Prisma.sql`AND (pp.party_id IS NULL OR (pp.attempts < ${MAX_PHOTO_ATTEMPTS}
        AND (pp.last_error_at IS NULL OR pp.last_error_at < now() - interval '1 hour')))`;
  return Prisma.sql`
    FROM (SELECT DISTINCT li.party_id
          FROM pizza_line_items li
          JOIN payout_documents d ON d.id = li.document_id
          JOIN parties p ON p.id = li.party_id
          LEFT JOIN pizza_photo_pass pp ON pp.party_id = li.party_id
          WHERE ${NEEDS_SIZE} ${idFilter} ${passGate} ${backoff} ${opts.scope ?? Prisma.empty}) c
    WHERE (
      EXISTS (SELECT 1 FROM payout_documents pd WHERE pd.party_id = c.party_id AND pd.kind = 'pizza'
              AND pd.mime_type = ANY(${PHOTO_MIMES}::text[]))
      OR EXISTS (SELECT 1 FROM photos ph WHERE ph.party_id = c.party_id AND ph.status = 'approved'
                 AND ph.deleted_at IS NULL AND ph.mime_type = ANY(${PHOTO_MIMES}::text[])))`;
}

async function recordPhotoError(partyId: string): Promise<void> {
  try {
    await prisma.pizzaPhotoPass.upsert({
      where: { partyId },
      create: { partyId, attempts: 1, lastErrorAt: new Date() },
      update: { attempts: { increment: 1 }, lastErrorAt: new Date(), updatedAt: new Date() },
    });
  } catch (e) {
    console.error('[pizza-index] could not record photo pass error', partyId, e);
  }
}

export async function runPhotoPass(opts: { limit?: number; partyIds?: string[]; dryRun?: boolean } = {}): Promise<PhotoPassResult> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  // Explicit partyIds re-run parties regardless of earlier passes or back-off.
  const explicit = !!opts.partyIds?.length;
  const base = photoCandidatesSql({ partyIds: opts.partyIds, explicit, backoff: false });
  const where = photoCandidatesSql({ partyIds: opts.partyIds, explicit });
  const [{ n: baseN }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${base}`);
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n ${where}`);
  const picked = await prisma.$queryRaw<{ party_id: string }[]>(Prisma.sql`
    SELECT c.party_id ${where} ORDER BY c.party_id LIMIT ${limit}`);
  const models = await getLlmModels();
  const result: PhotoPassResult = {
    dryRun: !!opts.dryRun, model: models.visionPrimary, candidates: n, processed: 0,
    remaining: Math.max(n - picked.length, 0), linesInserted: 0, linesUpdated: 0, errors: [],
    partyIds: picked.map((p) => p.party_id), skippedBackoff: Math.max(baseN - n, 0),
  };
  if (opts.dryRun || picked.length === 0) return result;

  const partyIds = picked.map((p) => p.party_id);
  const [payout, gallery, parties] = await Promise.all([
    payoutPizzaPhotos(partyIds, MAX_PHOTOS_PER_PARTY),
    galleryPhotos(partyIds, MAX_PHOTOS_PER_PARTY),
    prisma.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, country: true, city: true } }),
  ]);
  const partyById = new Map(parties.map((p) => [p.id, p]));

  for (const partyId of partyIds) {
    try {
      const todo = await prisma.$queryRaw<Array<{ id: string; raw_name: string; qty: number; unit_price_list: number; unit_price_usd: number; currency: string; merchant: string | null }>>(Prisma.sql`
        SELECT li.id, li.raw_name, li.qty::float8 AS qty, li.unit_price_list::float8 AS unit_price_list,
               li.unit_price_usd::float8 AS unit_price_usd, li.currency, li.merchant
        FROM pizza_line_items li JOIN payout_documents d ON d.id = li.document_id
        WHERE li.party_id = ${partyId}::uuid AND ${NEEDS_SIZE}
        ORDER BY li.document_id, li.line_index LIMIT ${MAX_LINES_PER_PARTY}`);
      const refs = await prisma.$queryRaw<Array<{ raw_name: string; diameter_cm: number; unit_price_list: number }>>(Prisma.sql`
        SELECT li.raw_name, li.diameter_cm::float8 AS diameter_cm, li.unit_price_list::float8 AS unit_price_list
        FROM pizza_line_items li
        WHERE li.party_id = ${partyId}::uuid AND li.shape = 'round' AND li.diameter_cm IS NOT NULL AND NOT li.excluded
          AND (li.verified_at IS NOT NULL OR li.size_confidence >= 0.8)
        LIMIT ${MAX_REFERENCE_LINES}`);
      const photoUrls = pickPhotos(payout.get(partyId) ?? [], gallery.get(partyId) ?? []);
      const images: Array<{ url: string; dataUrl: string }> = [];
      for (const url of photoUrls) {
        try {
          images.push({ url, dataUrl: await imageUrlToBase64DataUrl(url) });
        } catch (e) {
          console.warn('[pizza-index] photo pass: skipping unreadable photo', url, e instanceof Error ? e.message : e);
        }
      }
      if (todo.length === 0 || images.length === 0) {
        if (todo.length > 0) throw new Error('No readable photos');
        await prisma.pizzaPhotoPass.upsert({
          where: { partyId },
          create: { partyId, passAt: new Date(), photoUrls: [] },
          update: { passAt: new Date(), attempts: 0, lastErrorAt: null, updatedAt: new Date() },
        });
        result.processed += 1;
        continue;
      }
      const party = partyById.get(partyId);
      const resp = await getOpenAI().chat.completions.create({
        model: models.visionPrimary,
        temperature: 0,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PHOTO_PASS_SYSTEM },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  country: party?.country ?? null, city: party?.city ?? null,
                  merchant: todo.find((t) => t.merchant)?.merchant ?? null,
                  unsizedLines: todo.map((t, i) => ({
                    i, name: t.raw_name, qty: t.qty, unitPrice: t.unit_price_list, currency: t.currency,
                    unitPriceUsd: Math.round(t.unit_price_usd * 100) / 100,
                  })),
                  knownSizes: refs.map((r) => ({ name: r.raw_name, diameterCm: r.diameter_cm, unitPrice: r.unit_price_list })),
                  photoCount: images.length,
                }),
              },
              ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: img.dataUrl, detail: 'high' as const } })),
            ],
          },
        ],
      });
      const sentUrls = images.map((img) => img.url);
      const lines = parsePhotoPassResponse(resp.choices[0]?.message?.content, new Set(todo.map((_, i) => i)), images.length)
        .filter((l) => priceIsPlausible(l, todo[l.i].unit_price_usd));
      const now = new Date();
      await prisma.$transaction([
        // verifiedAt: null guards against a reviewer verifying the line mid-pass.
        ...lines.map((l) => prisma.pizzaLineItem.updateMany({
          where: { id: todo[l.i].id, verifiedAt: null },
          data: { photoEstimate: toPhotoEstimate(l, sentUrls, models.visionPrimary, now) as unknown as Prisma.InputJsonValue },
        })),
        prisma.pizzaPhotoPass.upsert({
          where: { partyId },
          create: { partyId, passAt: now, photoUrls: sentUrls },
          update: { passAt: now, photoUrls: sentUrls, attempts: 0, lastErrorAt: null, updatedAt: now },
        }),
      ]);
      result.processed += 1;
      result.linesUpdated += lines.length;
    } catch (err) {
      // `documentId` keeps the PassResult error shape the Ops log already prints.
      result.errors.push({ documentId: partyId, error: err instanceof Error ? err.message : String(err) });
      await recordPhotoError(partyId);
    }
  }
  return result;
}
