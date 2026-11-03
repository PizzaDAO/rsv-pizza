/**
 * basil-14648: payout_documents rows with source != 'upload' are DRAFTS written by the pizza
 * ordering webhook (no file, no amount). They must never satisfy a "has a receipt" gate, add to a
 * payout sum, or feed OCR / analytics. Every receipt-counting query goes through these helpers.
 */
export const UPLOADED_RECEIPT = { kind: 'receipt', source: 'upload' } as const;

export const isUploadedReceipt = (d: { kind: string; source?: string | null }) =>
  d.kind === 'receipt' && (d.source ?? 'upload') === 'upload';

/** Raw-SQL twin; `alias` is the payout_documents alias in the query. */
export const uploadedSourceSql = (alias: string) => `${alias}.source = 'upload'`;
