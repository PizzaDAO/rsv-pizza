/**
 * sfincione-40417: doc-level helpers shared by the LLM text pass and the
 * vision pass (read payout docs, re-allocate receipt discounts).
 * Read-only on payout tables.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  allocateDiscounts,
  resolveDocFx,
  type DiscountLine,
  type LineWrite,
  type OcrItemLike,
} from './pizzaLineSync.service.js';

export interface DocRow {
  id: string;
  partyId: string;
  country: string | null;
  city: string | null;
  url: string;
  mimeType: string;
  items: OcrItemLike[];
  merchant: string | null;
  fx: { currency: string; fxRate: number } | null;
}

interface RawDocRow {
  id: string;
  party_id: string;
  country: string | null;
  city: string | null;
  url: string;
  mime_type: string;
  ocr_line_items: unknown;
  merchant: string | null;
  original_currency: string | null;
  exchange_rate: number | null;
  ocr_currency: string | null;
  payout_currency: string | null;
  payout_rate: number | null;
}

/** Load the doc facts (items, merchant, FX, party) the passes need, by id. */
export async function loadDocRows(ids: string[]): Promise<DocRow[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<RawDocRow[]>(Prisma.sql`
    SELECT d.id, d.party_id, p.country, p.city, d.url, d.mime_type, d.ocr_line_items,
           coalesce(d.ocr_raw->'ocr'->>'merchant', d.ocr_raw->>'merchant') AS merchant,
           d.original_currency, d.exchange_rate::float8 AS exchange_rate, d.ocr_currency,
           po.original_currency AS payout_currency, po.exchange_rate::float8 AS payout_rate
    FROM payout_documents d
    JOIN parties p ON p.id = d.party_id
    LEFT JOIN payouts po ON po.id = d.payout_id
    WHERE d.id = ANY(${ids}::uuid[])`);
  return rows.map((c) => ({
    id: c.id,
    partyId: c.party_id,
    country: c.country,
    city: c.city,
    url: c.url,
    mimeType: c.mime_type,
    items: Array.isArray(c.ocr_line_items) ? (c.ocr_line_items as OcrItemLike[]) : [],
    merchant: c.merchant,
    fx: resolveDocFx({
      originalCurrency: c.original_currency,
      exchangeRate: c.exchange_rate,
      ocrCurrency: c.ocr_currency,
      payoutCurrency: c.payout_currency,
      payoutRate: c.payout_rate,
    }),
  }));
}

/** Recompute net prices for a doc's lines from its stored receipt discounts. */
export async function reallocateDocDiscounts(documentId: string): Promise<void> {
  const sync = await prisma.pizzaLineSync.findUnique({ where: { documentId } });
  const discounts: DiscountLine[] = Array.isArray(sync?.discounts)
    ? (sync!.discounts as unknown as DiscountLine[]).filter((d) => d && Number(d.amount) > 0)
    : [];
  // sfincione-40417: the synthetic lump-sum line never takes a discount share.
  const rows = await prisma.pizzaLineItem.findMany({ where: { documentId, sourceCategory: { not: 'lump_sum' } } });
  if (rows.length === 0) return;
  const pseudo = rows.map((r) => ({
    id: r.id,
    excluded: r.excluded,
    qty: Number(r.qty),
    unitPriceList: Number(r.unitPriceList),
    unitPriceNet: null as number | null,
    discountAmount: null as number | null,
    discountLabel: null as string | null,
  }));
  allocateDiscounts(pseudo as unknown as LineWrite[], discounts);
  await prisma.$transaction(
    pseudo.map((p) =>
      prisma.pizzaLineItem.update({
        where: { id: p.id },
        data: { unitPriceNet: p.unitPriceNet, discountAmount: p.discountAmount, discountLabel: p.discountLabel },
      }),
    ),
  );
}
