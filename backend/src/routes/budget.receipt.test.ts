import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database.js', () => ({ prisma: {} }));

const { assertBudgetReceiptRef } = await import('./budget.routes.js');

const PARTY = '0b6f3c2e-1d2a-4c5b-9e8f-7a6b5c4d3e2f';
const OTHER = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('budget-receipts-private: receiptUrl write validation', () => {
  it('accepts own-party private paths, legacy/public URLs and empty values', () => {
    expect(() => assertBudgetReceiptRef(`receipts/${PARTY}/1-abc.pdf`, PARTY)).not.toThrow();
    expect(() => assertBudgetReceiptRef('https://example.com/receipt.pdf', PARTY)).not.toThrow();
    expect(() => assertBudgetReceiptRef(
      `https://testproject.supabase.co/storage/v1/object/public/event-images/receipts/${PARTY}/1.jpg`, PARTY,
    )).not.toThrow();
    expect(() => assertBudgetReceiptRef(undefined, PARTY)).not.toThrow();
    expect(() => assertBudgetReceiptRef(null, PARTY)).not.toThrow();
    expect(() => assertBudgetReceiptRef('', PARTY)).not.toThrow();
  });

  it('rejects another party\'s path, malformed receipts/ paths and payout receipt paths', () => {
    expect(() => assertBudgetReceiptRef(`receipts/${OTHER}/1-abc.pdf`, PARTY)).toThrow();
    expect(() => assertBudgetReceiptRef(`receipts/${PARTY}/../${OTHER}/x.pdf`, PARTY)).toThrow();
    expect(() => assertBudgetReceiptRef('receipts/whatever.pdf', PARTY)).toThrow();
    expect(() => assertBudgetReceiptRef(`payouts/${PARTY}/g/receipt/1.jpg`, PARTY)).toThrow();
    expect(() => assertBudgetReceiptRef(42, PARTY)).toThrow();
  });
});
